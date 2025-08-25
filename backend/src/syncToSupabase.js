import fetch from 'node-fetch'
import { supabase } from './supabaseClient.js'
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
            throw new Error(`Request failed with status ${res.status}`)
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
                    body: JSON.stringify({ catalog_object_ids: batchIds }),
                });
                if (!res.ok) throw new Error(`Failed to fetch inventory batch: ${res.status}`);
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
    for (let i = 0; i < maxConcurrentBatches; i++) {
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
            // include cursor in body when paginating
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
            // include body text from Square to help debugging (400 responses include details)
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

// --- PRODUCTS (ITEM objects) ---
async function upsertProducts(items) {
    if (!items || items.length === 0) {
        console.log('No items to upsert.');
        return;
    }

    const chunkSize = 100;

    for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize).map(item => {
            const { id: square_id, item_data } = item;
            if (!item_data) return null;

            const name = item_data.name || null;
            const sku = null; // <- don’t borrow from first variation
            const description = item_data.description || null;
            const price = null; // price belongs to variations
            const category = item_data.category_id || null; // <- correct path

            return { square_id, name, sku, description, price, category };
        }).filter(Boolean);

        if (chunk.length === 0) continue;

        let retries = 3, backoff = 500;
        while (retries > 0) {
            const { error } = await supabase
                .from('products')
                .upsert(chunk, { onConflict: 'square_id' });

            if (!error) {
                console.log(`Upserted chunk of ${chunk.length} ITEM products`);
                break;
            } else {
                console.error('Error upserting products chunk:', error);
                retries--;
                if (retries === 0) {
                    console.error('Max retries reached, skipping this chunk');
                    break;
                }
                console.log(`Retrying in ${backoff}ms... (${retries} retries left)`);
                await delay(backoff);
                backoff *= 2;
            }
        }
        await delay(200);
    }
}

async function upsertVariations(variations, itemNameById = new Map()) {
    if (!variations || variations.length === 0) {
        console.log('No variations to upsert.');
        return;
    }

    const chunkSize = 100;
    for (let i = 0; i < variations.length; i += chunkSize) {
        const chunk = variations.slice(i, i + chunkSize).map(v => {
            const { id: square_id, item_variation_data } = v;
            if (!item_variation_data) return null;

            const parentId = item_variation_data.item_id || null;
            const parentName = parentId ? itemNameById.get(parentId) : null;

            const variationName = item_variation_data.name || 'Unknown Variation';
            // 👇 This is the key fix for the "Regular" problem
            const name = parentName ? `${parentName} - ${variationName}` : variationName;

            const sku = item_variation_data.sku || null;

            let price = null;
            if (item_variation_data.price_money && typeof item_variation_data.price_money.amount === 'number') {
                price = item_variation_data.price_money.amount / 100;
            }

            return { square_id, name, sku, description: null, price, category: null };
        }).filter(Boolean);

        if (chunk.length === 0) continue;

        let retries = 3, backoff = 500;
        while (retries > 0) {
            const { error } = await supabase
                .from('products')
                .upsert(chunk, { onConflict: 'square_id' });

            if (!error) {
                console.log(`Upserted chunk of ${chunk.length} VARIATIONS`);
                break;
            } else {
                console.error('Error upserting variations chunk:', error);
                retries--;
                if (retries === 0) {
                    console.error('Max retries reached, skipping this chunk');
                    break;
                }
                console.log(`Retrying in ${backoff}ms... (${retries} retries left)`);
                await delay(backoff);
                backoff *= 2;
            }
        }
        await delay(200);
    }
}


// --- LOCATIONS ---
async function upsertLocations(locations) {
    if (!locations || locations.length === 0) {
        console.log('No locations to upsert.')
        return
    }

    const toUpsert = locations.map(loc => {
        const { id: square_id, name, address } = loc
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
        return { square_id, name, address: fullAddress }
    })

    // Upsert in a single batch (it should be small)
    const { error } = await supabase
        .from('locations')
        .upsert(toUpsert, { onConflict: 'square_id' })
    if (error) console.error('Error upserting locations:', error)
    else console.log(`Upserted ${toUpsert.length} location(s)`)
}

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

    const foundProducts = await fetchProductsBySquareIds([...new Set(variationSquareIds)]);
    const foundProductMap = new Map(foundProducts.map(p => [p.square_id, p.id]));

    const { data: foundLocations, error: locError } = await supabase
        .from('locations')
        .select('id, square_id')
        .in('square_id', [...new Set(locationSquareIds)]);
    if (locError) throw locError;

    const foundLocationMap = new Map(foundLocations.map(l => [l.square_id, l.id]));

    const rows = [];
    for (const order of orders) {
        const saleDate = order.closed_at || order.created_at || null;
        const locLocalId = foundLocationMap.get(order.location_id);

        for (const lineItem of (order.line_items || [])) {
            const prodLocalId = foundProductMap.get(lineItem.catalog_object_id);
            if (!locLocalId || !prodLocalId) continue;

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

    const { error } = await supabase
        .from('sales')
        .upsert(rows, { onConflict: 'square_id' });
    if (error) console.error('Error upserting sales:', error);
    else console.log(`Upserted ${rows.length} sales rows`);
}

async function upsertInventoryCounts(counts) {
    console.log(`Starting to upsert ${counts.length} inventory counts...`)
    if (!counts || counts.length === 0) return

    // 1) get unique variation and location ids from payload
    const variationSquareIds = [...new Set(counts.map(c => c.catalog_object_id).filter(Boolean))]
    const locationSquareIds = [...new Set(counts.map(c => c.location_id).filter(Boolean))]

    // 2) fetch local product ids (variations) & locations
    const foundProducts = await fetchProductsBySquareIds(variationSquareIds)
    if (!foundProducts || foundProducts.length === 0) {
        console.warn('No products found for provided variation ids.')
        return
    }
    const foundProductMap = new Map(foundProducts.map(p => [p.square_id, p.id]))

    const { data: foundLocations, error: locError } = await supabase
        .from('locations')
        .select('id, square_id')
        .in('square_id', locationSquareIds.length ? locationSquareIds : ['__none__'])

    if (locError) {
        console.error('Error fetching locations:', locError)
        return
    }
    const foundLocationMap = new Map((foundLocations || []).map(l => [l.square_id, l.id]))

    // 3) Normalize counts: keep only the latest calculated_at per (variation, location, state)
    const latestMap = new Map()
    for (const c of counts) {
        if (!c.catalog_object_id || !c.location_id) continue
        const key = `${c.catalog_object_id}|${c.location_id}|${c.state || ''}`
        const existing = latestMap.get(key)
        const t = c.calculated_at ? new Date(c.calculated_at).getTime() : 0
        if (!existing || (existing._t || 0) < t) {
            latestMap.set(key, { ...c, _t: t })
        }
    }

    // 4) Build upsert rows but ONLY for IN_STOCK (on-hand)
    const upsertRows = []
    for (const val of latestMap.values()) {
        if ((val.state || '').toUpperCase() !== 'IN_STOCK') continue

        const locLocalId = foundLocationMap.get(val.location_id)
        const prodLocalId = foundProductMap.get(val.catalog_object_id)

        if (!locLocalId || !prodLocalId) {
            console.warn(`Missing mapping for variation ${val.catalog_object_id} or location ${val.location_id}; skipping.`)
            continue
        }

        const quantity = Math.max(0, parseInt(val.quantity, 10) || 0)

        // If your DB forces uniqueness on square_id only, consider using combined square id:
        // square_id: `${val.catalog_object_id}-${val.location_id}`
        upsertRows.push({
            square_id: val.catalog_object_id,      // prefer variation id; see note below
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

    // 5) Upsert using composite natural key (location_id + product_id)
    const chunkSize = 100
    for (let i = 0; i < upsertRows.length; i += chunkSize) {
        const chunk = upsertRows.slice(i, i + chunkSize)
        const { error } = await supabase
            .from('inventory')
            .upsert(chunk, { onConflict: 'location_id,product_id' })

        if (error) {
            console.error('Error upserting inventory chunk:', error)
        } else {
            console.log(`Upserted ${chunk.length} inventory rows.`)
        }
        await delay(200)
    }

    console.log('Finished upserting inventory counts (IN_STOCK only).')
}


// --- PRODUCT deletion handler (delete by square_id) ---
async function upsertProductOrDelete(item) {
    if (!item) return
    if (item.is_deleted) {
        const { error } = await supabase.from('products').delete().eq('square_id', item.id)
        if (error) console.error('Error deleting product by square_id:', error)
        else console.log(`Deleted product (square_id=${item.id}) from DB`)
        return
    }
    // If not deleted, upsert: item could be ITEM or ITEM_VARIATION; handle appropriately
    if (item.type === 'ITEM') {
        await upsertProducts([item])
    } else if (item.type === 'ITEM_VARIATION') {
        await upsertVariations([item])
    } else {
        console.log('Unhandled catalog object type in upsertProductOrDelete:', item.type)
    }
}

// --- Fetch single catalog object from Square (unchanged) ---
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

async function fetchProductsBySquareIds(ids) {
    const chunkSize = 100  // or smaller, adjust as needed
    let allProducts = []

    for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize)
        const { data, error } = await supabase
            .from('products')
            .select('id, square_id')
            .in('square_id', chunk)

        if (error) {
            console.error('Error fetching products chunk:', error)
            // handle error or throw
            throw error
        }
        if (data) allProducts = allProducts.concat(data)
    }
    return allProducts
}


// --- PRODUCTS + VARIATIONS ---
async function productSync() {
    console.log("Starting product + variation sync...")
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

    const itemNameById = new Map(items.map(i => [i.id, i.item_data?.name || null]))

    await upsertProducts(items)
    await upsertVariations(variations, itemNameById)

    console.log("Finished product sync")
}

// --- LOCATIONS ---
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

// --- SALES ---
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

// --- INVENTORY ---
async function inventorySync() {
    console.log("Starting inventory sync...")
    const baseUrl = 'https://connect.squareup.com/v2/catalog/list?types=ITEM_VARIATION'
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
        if (!res.ok) throw new Error(`Failed to fetch variations: ${res.status}`)
        const data = await res.json()
        allObjects = allObjects.concat(data.objects || [])
        cursor = data.cursor || null
    } while (cursor)

    const variations = allObjects.filter(obj => obj.type === 'ITEM_VARIATION')
    const variationIds = variations.map(v => v.id)

    const allCounts = await fetchInventoryCountsBatch(variationIds, options)
    await upsertInventoryCounts(allCounts)

    console.log("Finished inventory sync")
}


// --- FULL SYNC flow (items + variations + inventory + locations) ---
async function fullSync() {
    console.log('Fetching all catalog objects from Square...')
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

    // Build parent name map (item_id -> item name)
    const itemNameById = new Map(
        items.map(i => [i.id, i.item_data?.name || null])
    );

    // Upsert items and variations
    await upsertProducts(items);
    await upsertVariations(variations, itemNameById); // <-- pass the map


    // === Locations Sync ===
    console.log('Fetching locations...')
    const locRes = await fetchWithRetry('https://connect.squareup.com/v2/locations', options)
    if (!locRes.ok) throw new Error(`Failed to fetch locations: ${locRes.status}`)
    const locData = await locRes.json()
    const locations = locData.locations || []
    await upsertLocations(locations)

    // Build location id array to pass to fetchRecentSales (Square location ids)
    const locationIds = locations.map(l => l.id).filter(Boolean)
    if (locationIds.length === 0) {
        console.warn('No locations returned from Square; skipping recent sales sync.')
    } else {
        // === Sales Sync (last 2 weeks) ===
        console.log('Fetching sales for the last 2 weeks for locations:', locationIds)
        const recentSales = await fetchRecentSales(options, locationIds)
        await upsertSales(recentSales)
    }

    // === Inventory Sync ===
    console.log('Fetching inventory counts in parallel batches...')
    const variationIds = variations.map(v => v.id)
    const allCounts = await fetchInventoryCountsBatch(variationIds, options)
    await upsertInventoryCounts(allCounts)

    console.log('Full sync completed successfully.')
}

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
    upsertProducts,
    upsertVariations,
    upsertInventoryCounts,
    upsertLocations,
    upsertProductOrDelete,
    fetchCatalogObject,
    fullSync,
    productSync,
    locationSync,
    salesSync,
    inventorySync
}
