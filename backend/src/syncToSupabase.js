// square-sync.js
import fetch from 'node-fetch'
import {supabase} from './supabaseClient.js'
import url from 'url'

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchWithRetry(url, options, retries = 3, backoff = 500) {
    try {
        const res = await fetch(url, options)
        if (!res.ok) {
            if (res.status >= 500 && retries > 0) {
                console.warn(`Server error ${res.status}, retrying in ${backoff}ms...`)
                await delay(backoff)
                return fetchWithRetry(url, options, retries - 1, backoff * 2)
            }
            // allow caller to inspect body for 4xx errors
            return res
        }
        return res
    } catch (error) {
        if (retries > 0) {
            console.warn(`Fetch error, retrying in ${backoff}ms...`, error)
            await delay(backoff)
            return fetchWithRetry(url, options, retries - 1, backoff * 2)
        }
        throw error
    }
}

// === New helper to fetch inventory counts concurrently ===
async function fetchInventoryCountsBatch(variationIds, options) {
    const chunkSize = 100;
    const delayBetweenBatches = 300; // ms delay after each batch fetch
    const maxConcurrentBatches = 3;  // how many batches to fetch in parallel

    // Split variationIds into chunks of 100
    const chunks = [];
    for (let i = 0; i < variationIds.length; i += chunkSize) {
        chunks.push(variationIds.slice(i, i + chunkSize));
    }

    const results = [];
    let batchIndex = 0;

    async function worker() {
        while (batchIndex < chunks.length) {
            const currentIndex = batchIndex++;
            const batchIds = chunks[currentIndex];
            try {
                const res = await fetchWithRetry('https://connect.squareup.com/v2/inventory/batch-retrieve-counts', {
                    method: 'POST',
                    headers: options.headers,
                    body: JSON.stringify({catalog_object_ids: batchIds}),
                });
                if (!res.ok) {
                    const text = await res.text();
                    throw new Error(`Failed to fetch inventory batch: ${res.status} - ${text}`);
                }
                const data = await res.json();
                if (data.counts) results.push(...data.counts);
                console.log(`Fetched inventory batch ${currentIndex + 1}/${chunks.length}`);
            } catch (err) {
                console.error(`Batch ${currentIndex + 1} failed:`, err);
            }
            await delay(delayBetweenBatches);
        }
    }

    // Start workers
    const workers = [];
    for (let i = 0; i < Math.min(maxConcurrentBatches, chunks.length); i++) {
        workers.push(worker());
    }

    await Promise.all(workers);

    return results;
}

async function fetchRecentSales(options, locationIds = []) {
    if (!Array.isArray(locationIds) || locationIds.length === 0) {
        throw new Error('fetchRecentSales requires an array of locationIds (max 10).');
    }
    // Square limits to 10 location IDs per request
    const locs = locationIds.slice(0, 10);

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(now.getDate() - 14);

    const startISO = startDate.toISOString();
    const endISO = now.toISOString();

    const sales = [];
    let cursor = null;
    let page = 0;
    const maxPages = 50; // safety to avoid infinite loops

    do {
        const body = {
            return_entries: false,
            limit: 1000,
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
            throw new Error(`Failed to fetch sales: ${res.status} - ${text}`);
        }

        const data = await res.json();
        if (data.orders && data.orders.length) {
            sales.push(...data.orders);
            console.log(`Fetched ${data.orders.length} orders (page ${page + 1})`);
        } else {
            console.log(`No orders returned on page ${page + 1}`);
        }

        cursor = data.cursor || null;
        page += 1;
    } while (cursor && page < maxPages);

    if (page >= maxPages) {
        console.warn('fetchRecentSales stopped after maxPages; there may be more results.');
    }

    return sales;
}

// -------------------- Catalog mapping helpers --------------------

// Build quick lookup maps from all catalog objects
function buildCatalogMaps(allObjects) {
    const itemById = new Map();
    const variationById = new Map();
    const variationGtin = new Map(); // variationId -> upc/gtin if present
    const variationToItem = new Map(); // variationId -> parent item id
    const itemNameById = new Map();

    for (const obj of allObjects) {
        if (!obj || !obj.type) continue;
        if (obj.type === 'ITEM') {
            const name = obj.item_data?.name || null;
            itemById.set(obj.id, obj);
            itemNameById.set(obj.id, name);
        } else if (obj.type === 'ITEM_VARIATION') {
            variationById.set(obj.id, obj);
            const v = obj.item_variation_data || {};
            if (v.upc) variationGtin.set(obj.id, v.upc);
            if (v.item_id) variationToItem.set(obj.id, v.item_id);
        }
    }

    return {itemById, variationById, variationGtin, variationToItem, itemNameById};
}

async function fetchMappingsInBatches(squareIds) {
    const chunkSize = 200;
    const results = [];

    console.log(`[fetchMappingsInBatches] Resolving ${squareIds.length} squareIds in chunks of ${chunkSize}`);

    for (let i = 0; i < squareIds.length; i += chunkSize) {
        const chunk = squareIds.slice(i, i + chunkSize);
        try {
            const {data: batchData = [], error} = await supabase
                .from('square_catalog_mapping')
                .select('square_id, product_id')
                .in('square_id', chunk);

            if (error) {
                console.error(`[fetchMappingsInBatches] Error on batch ${i / chunkSize + 1}:`, {
                    chunkSize: chunk.length,
                    error
                });
                throw error;
            }
            console.log(`[fetchMappingsInBatches] Batch ${i / chunkSize + 1} succeeded (${chunk.length} ids)`);
            results.push(...batchData);
        } catch (err) {
            console.error(`[fetchMappingsInBatches] Unexpected failure on batch ${i / chunkSize + 1}:`, err);
            throw err;
        }
    }

    return results;
}

async function fetchProductsInBatches(squareIds) {
    const chunkSize = 200;
    const results = [];

    console.log(`[fetchProductsInBatches] Resolving ${squareIds.length} product ids in chunks of ${chunkSize}`);

    for (let i = 0; i < squareIds.length; i += chunkSize) {
        const chunk = squareIds.slice(i, i + chunkSize);
        try {
            const {data = [], error} = await supabase
                .from('products')
                .select('id, square_id, gtin')
                .in('square_id', chunk);

            if (error) {
                console.error(`[fetchProductsInBatches] Error on batch ${i / chunkSize + 1}:`, {
                    chunkSize: chunk.length,
                    error
                });
                throw error;
            }
            console.log(`[fetchProductsInBatches] Batch ${i / chunkSize + 1} succeeded (${chunk.length} ids)`);
            results.push(...data);
        } catch (err) {
            console.error(`[fetchProductsInBatches] Unexpected failure on batch ${i / chunkSize + 1}:`, err);
            throw err;
        }
    }

    return results;
}

async function resolveProductIdsForSquareIds(squareIds) {
    console.log(`[resolveProductIdsForSquareIds] Called with ${squareIds?.length || 0} ids`);

    const uniqueIds = [...new Set((squareIds || []).filter(Boolean))];
    if (uniqueIds.length === 0) {
        console.log(`[resolveProductIdsForSquareIds] No valid ids, returning empty Map`);
        return new Map();
    }

    console.log(`[resolveProductIdsForSquareIds] ${uniqueIds.length} unique ids after deduplication`);

    // 1) Query existing mappings
    let mappings;
    try {
        mappings = await fetchMappingsInBatches(uniqueIds);
        console.log(`[resolveProductIdsForSquareIds] Found ${mappings.length} existing mappings`);
    } catch (err) {
        console.error('[resolveProductIdsForSquareIds] Failed during fetchMappingsInBatches', err);
        throw err;
    }

    const result = new Map(mappings.map(m => [m.square_id, m.product_id]));
    const unresolved = uniqueIds.filter(id => !result.has(id));
    console.log(`[resolveProductIdsForSquareIds] ${unresolved.length} unresolved after mapping lookup`);

    if (unresolved.length === 0) return result;

    // 2) Lookup in products table
    let directProducts;
    try {
        directProducts = await fetchProductsInBatches(unresolved);
        console.log(`[resolveProductIdsForSquareIds] Found ${directProducts.length} direct products in products table`);
    } catch (err) {
        console.error('[resolveProductIdsForSquareIds] Failed during fetchProductsInBatches', err);
        throw err;
    }

    for (const p of directProducts || []) {
        if (p && p.square_id) {
            result.set(p.square_id, p.id);
            const idx = unresolved.indexOf(p.square_id);
            if (idx >= 0) unresolved.splice(idx, 1);
        }
    }

    console.log(`[resolveProductIdsForSquareIds] ${unresolved.length} still unresolved after product lookup`);

    // 3) Insert fallback rows if still unresolved
    if (unresolved.length > 0) {
        const newProducts = unresolved.map(sqId => ({
            square_id: sqId,
            name: `Imported ${sqId}`,
            gtin: null
        }));

        console.log(`[resolveProductIdsForSquareIds] Inserting ${newProducts.length} fallback products`);

        const {data: inserted = [], error: insertErr} = await supabase
            .from('products')
            .insert(newProducts, {returning: 'representation'});

        if (insertErr) {
            console.error('[resolveProductIdsForSquareIds] Error inserting fallback products:', insertErr);
            console.log('[resolveProductIdsForSquareIds] Retrying fetch for unresolved ids...');

            try {
                const retryProducts = await fetchProductsInBatches(unresolved);
                console.log(`[resolveProductIdsForSquareIds] Retry fetched ${retryProducts.length} products`);
                for (const p of retryProducts || []) {
                    result.set(p.square_id, p.id);
                }
            } catch (retryErr) {
                console.error('[resolveProductIdsForSquareIds] Retry fetch also failed:', retryErr);
                throw insertErr;
            }
        } else {
            console.log(`[resolveProductIdsForSquareIds] Successfully inserted ${inserted.length} fallback products`);
            for (const p of inserted || []) {
                result.set(p.square_id, p.id);
            }
        }
    }

    // 4) Upsert mappings
    const mappingRows = [];
    for (const id of uniqueIds) {
        if (result.has(id)) {
            mappingRows.push({square_id: id, product_id: result.get(id)});
        }
    }

    if (mappingRows.length) {
        console.log(`[resolveProductIdsForSquareIds] Upserting ${mappingRows.length} mapping rows`);
        const {error: mapUpsertErr} = await supabase
            .from('square_catalog_mapping')
            .upsert(mappingRows, {onConflict: 'square_id'});
        if (mapUpsertErr) {
            console.error('[resolveProductIdsForSquareIds] Error upserting mapping rows:', mapUpsertErr);
            throw mapUpsertErr;
        }
    }

    console.log(`[resolveProductIdsForSquareIds] Completed. Total resolved: ${result.size}`);
    return result;
}


// -------------------- Product/mapping sync (GTIN-first) --------------------

// Create or ensure canonical products for GTINs and create mapping rows for all variations/items
async function syncProductsAndMappings({variations = [], items = [], variationGtin = new Map(), itemNameById = new Map()}) {
    // 1) Group variation square IDs by GTIN
    const gtinToSquareIds = new Map();
    for (const v of variations) {
        if (!v || !v.id) continue;
        const vid = v.id;
        const gtin = variationGtin.get(vid) || null;
        if (gtin) {
            const arr = gtinToSquareIds.get(gtin) || [];
            arr.push(vid);
            gtinToSquareIds.set(gtin, arr);
        }
    }

    // 2) Prepare canonical products
    const productsToUpsert = [];

    // a) GTIN-based products
    for (const [gtin, sqIds] of gtinToSquareIds.entries()) {
        const sampleSquareId = sqIds[0];
        const sampleVariation = variations.find(v => v.id === sampleSquareId);
        let candidateName = null;
        if (sampleVariation) {
            const parentId = sampleVariation.item_variation_data?.item_id;
            candidateName = parentId ? itemNameById.get(parentId) : null;
            if (!candidateName) candidateName = sampleVariation.item_variation_data?.name || null;
        }
        productsToUpsert.push({
            square_id: sampleSquareId,
            gtin: gtin,
            name: candidateName || `Product ${gtin}`,
        });
    }

    // b) Items without GTIN (fallback)
    for (const item of items.filter(i => i && i.id)) {
        productsToUpsert.push({
            square_id: item.id,
            gtin: null,
            name: item.item_data?.name || null,
        });
    }

    // 3) Upsert using square_id as the conflict key
    if (productsToUpsert.length) {
        const {data: upserted, error} = await supabase
            .from('products')
            .upsert(productsToUpsert, {onConflict: 'square_id'})
            .select('id, square_id, gtin');

        if (error) {
            console.error('Error upserting canonical products by square_id:', error);
            throw error;
        }
    }

    // 4) Fetch canonical product IDs
    const canonicalProducts = await supabase
        .from('products')
        .select('id, square_id, gtin')
        .in('square_id', productsToUpsert.map(p => p.square_id))
        .then(res => res.data || []);

    const squareIdToProductId = new Map(canonicalProducts.map(p => [p.square_id, p.id]));

    // 5) Build mapping rows for all variations
    const mappingRows = [];

    for (const v of variations) {
        const prodId = squareIdToProductId.get(v.id) || null;
        if (prodId) {
            mappingRows.push({
                square_id: v.id,
                product_id: prodId,
                variation_id: v.id
            });
        }
    }

    // 6) Upsert mapping rows
    if (mappingRows.length) {
        const {error: mapErr} = await supabase
            .from('square_catalog_mapping')
            .upsert(mappingRows, {onConflict: 'square_id'});

        if (mapErr) {
            console.error('Error upserting square_catalog_mapping rows:', mapErr);
            throw mapErr;
        }
    }

    console.log(`syncProductsAndMappings completed: ${productsToUpsert.length} products, ${mappingRows.length} mappings`);
}


// -------------------- Existing upsert helpers (updated) --------------------

// Note: these functions are left for backward compatibility and small use-cases.
// The primary canonical behavior occurs via syncProductsAndMappings in fullSync.

// Upsert locations (unchanged)
async function upsertLocations(locations) {
    if (!locations || locations.length === 0) {
        console.log('No locations to upsert.')
        return
    }

    const toUpsert = locations.map(loc => {
        const {id: square_id, name, address} = loc
        let fullAddress = null
        if (address) {
            fullAddress = [
                address.address_line_1,
                address.address_line_2,
                address.locality,
                address.administrative_district_level_1,
                address.postal_code,
                address.country,
            ].filter(Boolean).join(', ')
        }
        return {square_id, name, address: fullAddress}
    })

    const {error} = await supabase
        .from('locations')
        .upsert(toUpsert, {onConflict: 'square_id'})
    if (error) console.error('Error upserting locations:', error)
    else console.log(`Upserted ${toUpsert.length} location(s)`)
}

// Upsert sales — use resolveProductIdsForSquareIds
async function upsertSales(orders) {
    if (!orders || orders.length === 0) {
        console.log('No sales to upsert.');
        return;
    }

    const variationSquareIds = [];
    const locationSquareIds = [];

    for (const order of orders) {
        if (order.location_id) locationSquareIds.push(order.location_id);
        for (const lineItem of (order.line_items || [])) {
            if (lineItem.catalog_object_id) {
                variationSquareIds.push(lineItem.catalog_object_id);
            }
        }
    }

    // Resolve product IDs for the catalog object ids
    const productMap = await resolveProductIdsForSquareIds([...new Set(variationSquareIds)]);
    if (!productMap || productMap.size === 0) {
        console.warn('No product mappings resolved for sales; skipping.');
        return;
    }

    const {data: foundLocations, error: locError} = await supabase
        .from('locations')
        .select('id, square_id')
        .in('square_id', [...new Set(locationSquareIds)]);

    if (locError) throw locError;
    const foundLocationMap = new Map((foundLocations || []).map(l => [l.square_id, l.id]));

    const rows = [];
    for (const order of orders) {
        const saleDate = order.closed_at || order.created_at || null;
        const locLocalId = foundLocationMap.get(order.location_id);

        for (const lineItem of (order.line_items || [])) {
            const prodLocalId = productMap.get(lineItem.catalog_object_id);
            if (!locLocalId || !prodLocalId) {
                if (!prodLocalId) console.warn(`No canonical product for catalog id ${lineItem.catalog_object_id}; skipping sale row.`);
                continue;
            }

            rows.push({
                square_id: `${order.id}-${lineItem.uid || lineItem.catalog_object_id}`,
                location_id: locLocalId,
                product_id: prodLocalId,
                quantity: parseInt(lineItem.quantity, 10) || 0,
                sale_date: saleDate
            });
        }
    }

    if (rows.length === 0) {
        console.log('No valid sales rows to upsert.');
        return;
    }

    const {error} = await supabase
        .from('sales')
        .upsert(rows, {onConflict: 'square_id'});
    if (error) console.error('Error upserting sales:', error);
    else console.log(`Upserted ${rows.length} sales rows`);
}

// Upsert inventory counts (modified to use resolveProductIdsForSquareIds)
async function upsertInventoryCounts(counts) {
    console.log(`Starting to upsert ${counts.length} inventory counts...`)
    if (!counts || counts.length === 0) return

    // 1) get unique variation and location ids from payload
    const variationSquareIds = [...new Set(counts.map(c => c.catalog_object_id).filter(Boolean))]
    const locationSquareIds = [...new Set(counts.map(c => c.location_id).filter(Boolean))]

    // 2) Resolve canonical product ids for variations
    const productMap = await resolveProductIdsForSquareIds(variationSquareIds);
    if (!productMap || productMap.size === 0) {
        console.warn('No products resolved for provided variation ids.')
        return
    }

    // 3) fetch local locations
    const {data: foundLocations = [], error: locError} = await supabase
        .from('locations')
        .select('id, square_id')
        .in('square_id', locationSquareIds.length ? locationSquareIds : ['__none__'])

    if (locError) {
        console.error('Error fetching locations:', locError)
        return
    }
    const foundLocationMap = new Map((foundLocations || []).map(l => [l.square_id, l.id]))

    // 4) Normalize counts: keep only the latest calculated_at per (variation, location, state)
    const latestMap = new Map()
    for (const c of counts) {
        if (!c.catalog_object_id || !c.location_id) continue
        const key = `${c.catalog_object_id}|${c.location_id}|${c.state || ''}`
        const existing = latestMap.get(key)
        const t = c.calculated_at ? new Date(c.calculated_at).getTime() : 0
        if (!existing || (existing._t || 0) < t) {
            latestMap.set(key, {...c, _t: t})
        }
    }

    // 5) Build upsert rows but ONLY for IN_STOCK (on-hand)
    const upsertRows = []
    for (const val of latestMap.values()) {
        if ((val.state || '').toUpperCase() !== 'IN_STOCK') continue

        const locLocalId = foundLocationMap.get(val.location_id)
        const prodLocalId = productMap.get(val.catalog_object_id)

        if (!locLocalId || !prodLocalId) {
            console.warn(`Missing mapping for variation ${val.catalog_object_id} or location ${val.location_id}; skipping.`)
            continue
        }

        const quantity = Math.max(0, parseInt(val.quantity, 10) || 0)

        // Use composite natural key via upsert on (product_id, location_id)
        upsertRows.push({
            square_id: `${val.catalog_object_id}-${val.location_id}`, // keep variant-specific key
            location_id: locLocalId,
            product_id: prodLocalId,
            quantity,
            square_updated_at: val.calculated_at ? new Date(val.calculated_at).toISOString() : null
        })
    }

    if (upsertRows.length === 0) {
        console.log('No IN_STOCK rows to upsert.')
        return
    }

    // 6) Upsert using composite natural key (location_id + product_id)
    const chunkSize = 100
    for (let i = 0; i < upsertRows.length; i += chunkSize) {
        const chunk = upsertRows.slice(i, i + chunkSize)
        const {error} = await supabase
            .from('inventory')
            .upsert(chunk, {onConflict: 'location_id,product_id'})

        if (error) {
            console.error('Error upserting inventory chunk:', error)
        } else {
            console.log(`Upserted ${chunk.length} inventory rows.`)
        }
        await delay(200)
    }

    console.log('Finished upserting inventory counts (IN_STOCK only).')
}

// -------------------- Product change / deletion handler --------------------

// When a catalog object is deleted in Square, remove only the mapping (do not delete canonical product)
async function upsertProductOrDelete(item) {
    if (!item) return
    if (item.is_deleted) {
        const {error} = await supabase
            .from('square_catalog_mapping')
            .delete()
            .eq('square_id', item.id)
        if (error) console.error('Error deleting mapping for deleted catalog object:', error)
        else console.log(`Removed mapping for deleted catalog object ${item.id}`)
        return
    }
    // If not deleted, ignore: fullSync handles upserting mapping & products
    console.log('Received non-deleted item change; fullSync flow will reconcile this object on next run.')
}

// -------------------- Fetch single catalog object --------------------
async function fetchCatalogObject(objectId) {
    const url = `https://connect.squareup.com/v2/catalog/object/${objectId}`
    const options = {
        headers: {
            'Square-Version': '2023-08-16',
            'Authorization': `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
    }

    try {
        const res = await fetchWithRetry(url, options)
        if (!res.ok) {
            console.error('Failed to fetch catalog object:', await res.text())
            return null
        }
        const data = await res.json()
        return data.object
    } catch (error) {
        console.error('Error fetching catalog object with retry:', error)
        return null
    }
}

async function productSync() {
    console.log("Starting product + variation sync (GTIN-first)...")
    const baseUrl = 'https://connect.squareup.com/v2/catalog/list?types=ITEM,ITEM_VARIATION,CATEGORY'
    const options = {
        headers: {
            'Square-Version': '2023-08-16',
            'Authorization': `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
    }

    let allObjects = []
    let cursor = null

    do {
        const res = await fetchWithRetry(`${baseUrl}${cursor ? `&cursor=${cursor}` : ''}`, options)
        if (!res.ok) throw new Error(`Failed to fetch catalog list: ${res.status}`)
        const data = await res.json()
        allObjects = allObjects.concat(data.objects || [])
        cursor = data.cursor || null
    } while (cursor)

    const items = allObjects.filter(obj => obj.type === 'ITEM')
    const variations = allObjects.filter(obj => obj.type === 'ITEM_VARIATION')

    const {variationGtin, itemNameById} = buildCatalogMaps(allObjects)
    await syncProductsAndMappings({variations, items, variationGtin, itemNameById})

    console.log("Finished product sync")
}

async function locationSync() {
    console.log("Starting locations sync...")
    const options = {
        headers: {
            'Square-Version': '2023-08-16',
            'Authorization': `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
    }

    const locRes = await fetchWithRetry('https://connect.squareup.com/v2/locations', options)
    if (!locRes.ok) throw new Error(`Failed to fetch locations: ${locRes.status}`)
    const locData = await locRes.json()
    const locations = locData.locations || []
    await upsertLocations(locations)

    console.log("Finished locations sync")
}

async function salesSync() {
    console.log("Starting sales sync...")
    const options = {
        headers: {
            'Square-Version': '2023-08-16',
            'Authorization': `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
    }

    const locRes = await fetchWithRetry('https://connect.squareup.com/v2/locations', options)
    if (!locRes.ok) throw new Error(`Failed to fetch locations: ${locRes.status}`)
    const locData = await locRes.json()
    const locationIds = locData.locations.map(l => l.id).filter(Boolean)

    if (!locationIds.length) {
        console.warn("No locations found; skipping sales sync.")
        return
    }

    const recentSales = await fetchRecentSales(options, locationIds)
    await upsertSales(recentSales)

    console.log("Finished sales sync")
}

async function inventorySync() {
    console.log("Starting inventory sync (GTIN-aware)...")
    const baseUrl = 'https://connect.squareup.com/v2/catalog/list?types=ITEM_VARIATION'
    const options = {
        headers: {
            'Square-Version': '2023-08-16',
            'Authorization': `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
    }

    // Fetch variations
    let allObjects = []
    let cursor = null
    do {
        const res = await fetchWithRetry(`${baseUrl}${cursor ? `&cursor=${cursor}` : ''}`, options)
        if (!res.ok) throw new Error(`Failed to fetch variations: ${res.status}`)
        const data = await res.json()
        allObjects = allObjects.concat(data.objects || [])
        cursor = data.cursor || null
    } while (cursor)

    const variations = allObjects.filter(obj => obj.type === 'ITEM_VARIATION')
    const variationIds = variations.map(v => v.id)

    // Fetch counts in batches
    const allCounts = await fetchInventoryCountsBatch(variationIds, options)
    await upsertInventoryCounts(allCounts)

    console.log("Finished inventory sync")
}

async function fullSync() {
    console.log('Starting fullSync: fetching all catalog objects from Square...')
    const baseUrl = 'https://connect.squareup.com/v2/catalog/list?types=ITEM,ITEM_VARIATION,CATEGORY'
    const options = {
        headers: {
            'Square-Version': '2023-08-16',
            'Authorization': `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
    }

    let allObjects = []
    let cursor = null

    do {
        const res = await fetchWithRetry(`${baseUrl}${cursor ? `&cursor=${cursor}` : ''}`, options)
        if (!res.ok) throw new Error(`Failed to fetch catalog list: ${res.status}`)
        const data = await res.json()
        allObjects = allObjects.concat(data.objects || [])
        cursor = data.cursor || null
    } while (cursor)

    console.log(`Fetched ${allObjects.length} catalog objects`)

    // Separate types
    const items = allObjects.filter(obj => obj.type === 'ITEM');
    const variations = allObjects.filter(obj => obj.type === 'ITEM_VARIATION');

    // Build maps and upsert canonical products + mappings (GTIN-first)
    const {variationGtin, itemNameById} = buildCatalogMaps(allObjects);
    await syncProductsAndMappings({variations, items, variationGtin, itemNameById});

    // Locations
    console.log('Fetching locations...')
    const locRes = await fetchWithRetry('https://connect.squareup.com/v2/locations', options)
    if (!locRes.ok) throw new Error(`Failed to fetch locations: ${locRes.status}`)
    const locData = await locRes.json()
    const locations = locData.locations || []
    await upsertLocations(locations)

    // Sales (last 2 weeks)
    const locationIds = locations.map(l => l.id).filter(Boolean)
    if (locationIds.length === 0) {
        console.warn('No locations returned from Square; skipping recent sales sync.')
    } else {
        console.log('Fetching sales for the last 2 weeks for locations:', locationIds)
        const recentSales = await fetchRecentSales(options, locationIds)
        await upsertSales(recentSales)
    }

    // Inventory counts
    console.log('Fetching inventory counts in parallel batches...')
    const variationIds = variations.map(v => v.id)
    const allCounts = await fetchInventoryCountsBatch(variationIds, options)
    await upsertInventoryCounts(allCounts)

    console.log('Full sync completed successfully.')
}

// CLI entrypoint
if (process.argv[1] === __filename) {
    ; (async () => {
        try {
            const type = process.argv[2] || "full"
            console.log(`Starting ${type} sync...`)

            switch (type) {
                case "full":
                    await fullSync()
                    break
                case "products":
                    await productSync()
                    break
                case "locations":
                    await locationSync()
                    break
                case "sales":
                    await salesSync()
                    break
                case "inventory":
                    await inventorySync()
                    break
                default:
                    throw new Error(`Unknown sync type: ${type}`)
            }

            console.log(`${type} sync completed successfully.`)
            process.exit(0)
        } catch (error) {
            console.error("Sync failed:", error)
            process.exit(1)
        }
    })()
}

export {
    fetchWithRetry,
    // upsertProducts,         // retained for compatibility (not used in GTIN-first flow)
    // upsertVariations,       // retained for compatibility (not used in GTIN-first flow)
    upsertInventoryCounts,
    upsertLocations,
    upsertProductOrDelete,
    fetchCatalogObject,
    fullSync,
    productSync,
    locationSync,
    salesSync,
    inventorySync,
    resolveProductIdsForSquareIds,
    syncProductsAndMappings,
    buildCatalogMaps,
    fetchInventoryCountsBatch
}
