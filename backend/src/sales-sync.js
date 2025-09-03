// sales-sync.js
import {supabase} from './supabaseClient.js'
// Drop-in implementation to sync Square orders -> local `sales` table
// Requires: `supabase` client in scope, Node fetch available, and SQUARE_ACCESS_TOKEN in env.

const DEFAULT_PAGE_SIZE = 1000; // for DB paging
const SALES_UPSERT_BATCH = 200; // DB upsert batch size
const SQUARE_PAGE_LIMIT = 100;  // page size for Square orders (safe)

/**
 * Lightweight fetchWithRetry used for Square API calls.
 * If you already have a fetchWithRetry, replace calls with it.
 */
async function fetchWithRetry(url, opts = {}, retries = 3, backoff = 300) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, opts);
            // treat 429 as retryable
            if (res.status === 429 && attempt < retries) {
                const wait = backoff * Math.pow(2, attempt);
                await new Promise(r => setTimeout(r, wait));
                continue;
            }
            return res;
        } catch (err) {
            if (attempt === retries) throw err;
            const wait = backoff * Math.pow(2, attempt);
            await new Promise(r => setTimeout(r, wait));
        }
    }
}

// ---------------------------------------------------------------
// DB paging helpers to build maps
// ---------------------------------------------------------------

async function fetchProductsMap() {
    const products = [];
    let page = 0;
    while (true) {
        const from = page * DEFAULT_PAGE_SIZE;
        const to = (page + 1) * DEFAULT_PAGE_SIZE - 1;
        const {data, error} = await supabase
            .from('products')
            .select('id, square_id')
            .range(from, to)
            .order('id', {ascending: true});

        if (error) throw error;
        if (!data || data.length === 0) break;
        products.push(...data);
        if (data.length < DEFAULT_PAGE_SIZE) break;
        page++;
    }

    const map = {};
    products.forEach(p => {
        if (p.square_id && p.id) map[p.square_id] = p.id;
    });
    console.log(`[fetchProductsMap] mapped ${Object.keys(map).length} products`);
    return map;
}

async function fetchVariationsMap() {
    // Expect product_variations table contains: id (uuid), product_id (uuid), square_variation_id (text)
    const variations = [];
    let page = 0;
    while (true) {
        const from = page * DEFAULT_PAGE_SIZE;
        const to = (page + 1) * DEFAULT_PAGE_SIZE - 1;
        const {data, error} = await supabase
            .from('product_variations')
            .select('id, product_id, square_variation_id')
            .range(from, to)
            .order('id', {ascending: true});

        if (error) throw error;
        if (!data || data.length === 0) break;
        variations.push(...data);
        if (data.length < DEFAULT_PAGE_SIZE) break;
        page++;
    }

    const map = {};
    variations.forEach(v => {
        if (v.square_variation_id && v.id && v.product_id) {
            // map square variation id -> object { id: variation_uuid, product_id: uuid }
            map[v.square_variation_id] = {id: v.id, product_id: v.product_id};
        }
    });
    console.log(`[fetchVariationsMap] mapped ${Object.keys(map).length} variations`);
    return map;
}

async function fetchLocationsMap() {
    const locs = [];
    let page = 0;
    while (true) {
        const from = page * DEFAULT_PAGE_SIZE;
        const to = (page + 1) * DEFAULT_PAGE_SIZE - 1;
        const {data, error} = await supabase
            .from('locations')
            .select('id, square_id')
            .range(from, to)
            .order('id', {ascending: true});

        if (error) throw error;
        if (!data || data.length === 0) break;
        locs.push(...data);
        if (data.length < DEFAULT_PAGE_SIZE) break;
        page++;
    }

    const map = {};
    locs.forEach(l => {
        if (l.square_id && l.id) map[l.square_id] = l.id;
    });
    console.log(`[fetchLocationsMap] mapped ${Object.keys(map).length} locations`);
    return map;
}

// ---------------------------------------------------------------
// Fetch recent orders from Square and flatten to line-item rows
// ---------------------------------------------------------------
async function fetchRecentSalesFromSquare(options, squareLocationIds = [], days = 14) {
    if (!Array.isArray(squareLocationIds) || squareLocationIds.length === 0) {
        throw new Error('fetchRecentSalesFromSquare requires an array of location IDs');
    }

    const BATCH_LOCATIONS = 10; // Square accepts max 10 location ids per request
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - days);
    const startISO = start.toISOString();
    const endISO = now.toISOString();

    const lineItems = [];

    for (let i = 0; i < squareLocationIds.length; i += BATCH_LOCATIONS) {
        const locs = squareLocationIds.slice(i, i + BATCH_LOCATIONS);
        let cursor = null;
        let page = 0;

        do {
            const body = {
                return_entries: false,
                limit: SQUARE_PAGE_LIMIT,
                location_ids: locs,
                query: {
                    filter: {
                        date_time_filter: {
                            closed_at: {
                                start_at: startISO,
                                end_at: endISO
                            }
                        },
                        state_filter: {
                            states: ['COMPLETED']
                        }
                    },
                    sort: {
                        sort_field: 'CLOSED_AT',
                        sort_order: 'DESC'
                    }
                },
                cursor: cursor || undefined
            };

            const res = await fetchWithRetry('https://connect.squareup.com/v2/orders/search', {
                method: 'POST',
                headers: {
                    ...options.headers,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const text = await res.text();
                throw new Error(`Square orders/search failed: ${res.status} - ${text}`);
            }

            const data = await res.json();
            const orders = Array.isArray(data.orders) ? data.orders : [];

            if (orders.length) {
                console.log(`[fetchRecentSalesFromSquare] fetched ${orders.length} orders, page ${page + 1})`);
                for (const order of orders) {
                    const orderId = order.id || null;
                    const closedAt = order.closed_at || order.created_at || null;
                    const location_id = order.location_id || null;

                    const items = Array.isArray(order.line_items) ? order.line_items : [];
                    for (const li of items) {
                        const lineUid = li.uid || null;
                        // Square uses catalog_object_id for both items and variations
                        const catalogObjectId = li.catalog_object_id || null;
                        const qty = li.quantity ? Number(li.quantity) : 1;
                        const totalCents = (li.total_money && typeof li.total_money.amount === 'number') ? li.total_money.amount
                            : (li.gross_sales_money?.amount ?? null);

                        lineItems.push({
                            order_id: orderId,
                            line_item_uid: lineUid,
                            location_id,              // Square location id (will map later)
                            catalog_object_id: catalogObjectId,
                            quantity: qty,
                            sale_date: closedAt,
                            total_money_cents: typeof totalCents === 'number' ? totalCents : null,
                            // optional: expose li for debugging
                            __raw_line_item: li
                        });
                    }
                }
            } else {
                console.log(`[fetchRecentSalesFromSquare] no orders on page ${page + 1} for locations ${locs.join(', ')}`);
            }

            cursor = data.cursor || null;
            page++;
        } while (cursor);
    }

    console.log(`[fetchRecentSalesFromSquare] total line items fetched: ${lineItems.length}`);
    return lineItems;
}

// ---------------------------------------------------------------
// Map line-item rows to DB-ready sales rows using the maps
// ---------------------------------------------------------------
/**
 * fetchAndMapRecentSales(options, squareLocationIds, { skipUnmapped: boolean })
 *
 * skipUnmapped default: true -> skip line items that don't map to a local product/variation.
 * If skipUnmapped=false, inserts rows with product_id = null.
 */
async function fetchAndMapRecentSales(options, squareLocationIds = [], opts = {skipUnmapped: true}) {
    const lineItems = await fetchRecentSalesFromSquare(options, squareLocationIds);

    const [productMap, variationMap, locationMap] = await Promise.all([
        fetchProductsMap(),
        fetchVariationsMap(),
        fetchLocationsMap()
    ]);

    const rows = [];
    const skipped = [];

    for (const li of lineItems) {
        const orderId = li.order_id;
        const lineUid = li.line_item_uid || 'noluid';
        const squareSaleId = `${orderId}::${lineUid}`; // unique per order line

        const sqLocationId = li.location_id || null;
        const localLocationId = locationMap[sqLocationId] || null;

        const catalogId = li.catalog_object_id || null;

        let product_id = null;
        let variation_id = null;

        // Prefer variation mapping first (most specific)
        if (catalogId && variationMap[catalogId]) {
            variation_id = variationMap[catalogId].id;        // uuid of product_variations
            product_id = variationMap[catalogId].product_id; // uuid of parent product
        } else if (catalogId && productMap[catalogId]) {
            product_id = productMap[catalogId]; // catalog points to an item (no variation)
            variation_id = null;
        } else {
            // no mapping found
            if (opts.skipUnmapped) {
                skipped.push({catalogId, orderId, lineUid});
                continue;
            } else {
                product_id = null;
                variation_id = null;
            }
        }

        const qty = Number(li.quantity || 0);
        const cents = typeof li.total_money_cents === 'number' ? li.total_money_cents : null;
        const total_amount = cents !== null ? (cents / 100) : null;
        const unit_price = (cents !== null && qty > 0) ? (cents / qty / 100) : null;

        rows.push({
            square_id: squareSaleId,
            location_id: localLocationId,
            product_id,
            quantity: qty,
            sale_date: li.sale_date || null,
            square_updated_at: null,
            synced_at: new Date().toISOString(),
            variation_id,
            unit_price,
            total_amount,
            order_id: orderId
        });
    }

    if (skipped.length) {
        console.warn(`[fetchAndMapRecentSales] skipped ${skipped.length} line-items with unmapped catalog IDs (example):`, skipped.slice(0, 5));
    }

    console.log(`[fetchAndMapRecentSales] mapped ${rows.length} sales rows (skipped ${skipped.length})`);
    return rows;
}

// ---------------------------------------------------------------
// Upsert sales rows in batches
// ---------------------------------------------------------------
async function upsertSales(rows = []) {
    if (!Array.isArray(rows) || rows.length === 0) {
        console.log('upsertSales: no rows to upsert');
        return;
    }

    for (let i = 0; i < rows.length; i += SALES_UPSERT_BATCH) {
        const batch = rows.slice(i, i + SALES_UPSERT_BATCH);
        const {error} = await supabase
            .from('sales')
            .upsert(batch, {onConflict: 'square_id', ignoreDuplicates: false});

        if (error) {
            console.error(`upsertSales: error on batch ${Math.floor(i / SALES_UPSERT_BATCH) + 1}`, error);
            throw error;
        } else {
            console.log(`upsertSales: upserted batch ${Math.floor(i / SALES_UPSERT_BATCH) + 1} (${batch.length} rows)`);
        }
    }
}

// ---------------------------------------------------------------
// Top-level sync function wiring
// ---------------------------------------------------------------
export async function salesSync({skipUnmapped = true, lookbackDays = 14} = {}) {
    console.log('Starting salesSync...');
    const options = {
        headers: {
            'Square-Version': '2023-08-16',
            'Authorization': `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        }
    };

    // fetch Square locations via API (to know which IDs to query)
    const locRes = await fetchWithRetry('https://connect.squareup.com/v2/locations', {headers: options.headers});
    if (!locRes.ok) {
        const text = await locRes.text().catch(() => '');
        throw new Error(`Failed to fetch Square locations: ${locRes.status} - ${text}`);
    }
    const locData = await locRes.json();
    const squareLocationIds = (locData.locations || []).map(l => l.id).filter(Boolean);

    if (!squareLocationIds.length) {
        console.warn('salesSync: no Square locations found, aborting.');
        return;
    }

    // fetch, map, and upsert
    const mappedRows = await fetchAndMapRecentSales(options, squareLocationIds, {skipUnmapped});

    if (mappedRows.length === 0) {
        console.log('salesSync: no mapped rows to upsert (all rows may have been skipped).');
        return;
    }

    await upsertSales(mappedRows);
    console.log('Finished salesSync.');
}

// Export functions if using as a module
export default {
    salesSync,
    fetchAndMapRecentSales,
    fetchRecentSalesFromSquare,
    fetchProductsMap,
    fetchVariationsMap,
    fetchLocationsMap,
    upsertSales
};
