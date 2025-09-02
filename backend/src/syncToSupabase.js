// syncToSupabase.js
import fetch from 'node-fetch'
import {supabase} from './supabaseClient.js'
import url from 'url'

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

import {fetchAllProducts} from './server.js';
import {salesSync} from './sales-sync.js';

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

async function fetchProductsInBatchesWithSquareIds(squareIds) {
    const chunkSize = 200;
    const results = [];

    console.log(`[fetchProductsInBatchesWithSquareIds] Resolving ${squareIds.length} product ids in chunks of ${chunkSize}`);

    for (let i = 0; i < squareIds.length; i += chunkSize) {
        const chunk = squareIds.slice(i, i + chunkSize);
        try {
            const {data = [], error} = await supabase
                .from('products')
                .select('id, square_id, gtin')
                .in('square_id', chunk);

            if (error) {
                console.error(`[fetchProductsInBatchesWithSquareIds] Error on batch ${i / chunkSize + 1}:`, {
                    chunkSize: chunk.length,
                    error
                });
                throw error;
            }
            console.log(`[fetchProductsInBatchesWithSquareIds] Batch ${i / chunkSize + 1} succeeded (${chunk.length} ids)`);
            results.push(...data);
        } catch (err) {
            console.error(`[fetchProductsInBatchesWithSquareIds] Unexpected failure on batch ${i / chunkSize + 1}:`, err);
            throw err;
        }
    }

    return results;
}

async function resolveProductIdsForSquareIds(squareIds) {
    console.log(`[] Called with ${squareIds?.length || 0} ids`);

    const uniqueIds = [...new Set((squareIds || []).filter(Boolean))];
    if (uniqueIds.length === 0) {
        console.log(`[] No valid ids, returning empty Map`);
        return new Map();
    }

    console.log(`[] ${uniqueIds.length} unique ids after deduplication`);

    // 1) Query existing mappings
    let mappings;
    try {
        mappings = await fetchMappingsInBatches(uniqueIds);
        console.log(`[] Found ${mappings.length} existing mappings`);
    } catch (err) {
        console.error('[] Failed during fetchMappingsInBatches', err);
        throw err;
    }

    const result = new Map(mappings.map(m => [m.square_id, m.product_id]));
    const unresolved = uniqueIds.filter(id => !result.has(id));
    console.log(`[] ${unresolved.length} unresolved after mapping lookup`);

    if (unresolved.length === 0) return result;

    // 2) Lookup in products table
    let directProducts;
    try {
        directProducts = await fetchProductsInBatchesWithSquareIds(unresolved);
        console.log(`[] Found ${directProducts.length} direct products in products table`);
    } catch (err) {
        console.error('[] Failed during fetchProductsInBatchesWithSquareIds', err);
        throw err;
    }

    for (const p of directProducts || []) {
        if (p && p.square_id) {
            result.set(p.square_id, p.id);
            const idx = unresolved.indexOf(p.square_id);
            if (idx >= 0) unresolved.splice(idx, 1);
        }
    }

    console.log(`[] ${unresolved.length} still unresolved after product lookup`);

    // 3) Insert fallback rows if still unresolved
    if (unresolved.length > 0) {
        const newProducts = unresolved.map(sqId => ({
            square_id: sqId,
            name: `Imported ${sqId}`,
            gtin: null
        }));

        console.log(`[] Inserting ${newProducts.length} fallback products`);

        const {data: inserted = [], error: insertErr} = await supabase
            .from('products')
            .insert(newProducts, {returning: 'representation'});

        if (insertErr) {
            console.error('[] Error inserting fallback products:', insertErr);
            console.log('[] Retrying fetch for unresolved ids...');

            try {
                const retryProducts = await fetchProductsInBatchesWithSquareIds(unresolved);
                console.log(`[] Retry fetched ${retryProducts.length} products`);
                for (const p of retryProducts || []) {
                    result.set(p.square_id, p.id);
                }
            } catch (retryErr) {
                console.error('[] Retry fetch also failed:', retryErr);
                throw insertErr;
            }
        } else {
            //console.log(`[] Successfully inserted ${inserted.length} fallback products`);
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
        console.log(`[] Upserting ${mappingRows.length} mapping rows`);
        const {error: mapUpsertErr} = await supabase
            .from('square_catalog_mapping')
            .upsert(mappingRows, {onConflict: 'square_id'});
        if (mapUpsertErr) {
            console.error('[] Error upserting mapping rows:', mapUpsertErr);
            throw mapUpsertErr;
        }
    }

    console.log(`[] Completed. Total resolved: ${result.size}`);
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

function buildCatalogMaps(allObjects) {
    const categoryNameById = {};

    allObjects.forEach(obj => {
        if (obj.type === 'CATEGORY' && obj.category_data) {
            // Extract the name from the object, use it to index the object
            categoryNameById[obj.id] = obj.category_data.name || 'Unknown';
        }
    });

    return {categoryNameById};
}

async function productSync() {
    const baseUrl = 'https://connect.squareup.com/v2/catalog/list?types=ITEM,ITEM_VARIATION,CATEGORY';
    const options = {
        headers: {
            'Square-Version': '2023-08-16',
            'Authorization': `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
    };

    let allObjects = [];
    let cursor = null;

    // Fetch all catalog objects
    do {
        const res = await fetchWithRetry(`${baseUrl}${cursor ? `&cursor=${cursor}` : ''}`, options);
        if (!res.ok) throw new Error(`Failed to fetch catalog list: ${res.status}`);
        const data = await res.json();
        allObjects = allObjects.concat(data.objects || []);
        cursor = data.cursor || null;
    } while (cursor);

    const items = allObjects.filter(obj => obj.type === 'ITEM');
    /*
    {
        type: "ITEM",
        id: "BHJ27JXVN7BIRNQTKKTV7XG6",
        updated_at: "2025-08-07T05:22:19.879Z",
        created_at: "2021-06-18T05:14:38.369Z",
        version: 1754544139879,
        is_deleted: false,
        present_at_all_locations: false,
        present_at_location_ids: [
            "3P98D5NV1A3SM",
        ],
        item_data: {
            name: "Clipper Menthol",
            is_taxable: true,
            category_id: "M3FKIKSLUVR35MHUEPTDW3WI",
            variations: [
            {
                type: "ITEM_VARIATION",
                id: "CINXD7HYNAHHUQJ44IHG26V2",
                updated_at: "2025-08-07T05:22:19.879Z",
                created_at: "2022-09-04T18:21:54.166Z",
                version: 1754544139879,
                is_deleted: false,
                present_at_all_locations: false,
                present_at_location_ids: [
                "3P98D5NV1A3SM",
                ],
                item_variation_data: {
                item_id: "BHJ27JXVN7BIRNQTKKTV7XG6",
                name: "",
                sku: "0812615004713",
                ordinal: 1,
                pricing_type: "FIXED_PRICING",
                price_money: {
                    amount: 349,
                    currency: "USD",
                },
                sellable: true,
                stockable: true,
                channels: [
                    "CH_V3xNgKpBeB51Rhciliuf23IlNQlT2nqJMpn7BQlQuYC",
                ],
                },
            },
            ],
            product_type: "REGULAR",
            ecom_available: false,
            ecom_visibility: "UNAVAILABLE",
            channels: [
            "CH_V3xNgKpBeB51Rhciliuf23IlNQlT2nqJMpn7BQlQuYC",
            ],
            is_archived: false,
        },
        }
    */
    const variations = allObjects.filter(obj => obj.type === 'ITEM_VARIATION');
    /*
    {
        type: "ITEM_VARIATION",
        id: "TN63JZV4IHXNQVGAOTX37J2C",
        updated_at: "2025-08-07T05:21:28.134Z",
        created_at: "2022-09-04T18:21:54.166Z",
        version: 1754544088134,
        is_deleted: false,
        present_at_all_locations: false,
        present_at_location_ids: [
            "LQZQSFETPS7Q3",
            "3P98D5NV1A3SM",
        ],
        item_variation_data: {
            item_id: "R5IDKLIHB5E6PLBHYPDGIL3A",
            name: "",
            sku: "6001087364614",
            ordinal: 1,
            pricing_type: "FIXED_PRICING",
            price_money: {
            amount: 499,
            currency: "USD",
            },
            sellable: true,
            stockable: true,
            channels: [
            "CH_V3xNgKpBeB51Rhciliuf23IlNQlT2nqJMpn7BQlQuYC",
            ],
        },
        }
    */
    const categories = allObjects.filter(obj => obj.type === 'CATEGORY');
    /* 
    {
        type: "CATEGORY",
        id: "OTZXNKGPIDSYNWTELIFONW5U",
        updated_at: "2025-08-07T05:19:52.388Z",
        created_at: "2023-04-07T04:01:15.992Z",
        version: 1754543992388,
        is_deleted: false,
        catalog_v1_ids: [
            {
            catalog_v1_id: "J3AX476LD42VHNCTZUOHEY2S",
            location_id: "L7V67GRNNH6XM",
            },
        ],
        present_at_all_locations: true,
        category_data: {
            name: "Mezcal",
            ordinal: 0,
            is_top_level: true,
        },
    }
    */
    console.log(allObjects);

    console.log(`Raw counts from Square API:`);
    console.log(`- Items: ${items.length}`);
    console.log(`- Variations: ${variations.length}`);
    console.log(`- Categories: ${categories.length}`);
    console.log(`- Total objects: ${allObjects.length}`);

    // Build maps for processing
    const {categoryNameById} = buildCatalogMaps(categories);

    // Sync products first
    await syncProducts({items, categoryNameById});

    // Then sync variations (depends on products)
    await syncProductVariations({items, variations});

    console.log("Finished product sync");
}



// async function syncProducts({items, categoryNameById}) {
//     console.log(`Syncing ${items.length} products...`);

//     // Fetch existing products from your DB
//     const existingProducts = await fetchAllProducts();

//     const productsToUpsert = items.map(item => {
//         /*
//         {
//             type: "ITEM",
//             id: "BHJ27JXVN7BIRNQTKKTV7XG6",
//             present_at_location_ids: [
//                 "3P98D5NV1A3SM",
//             ],
//             item_data: {
//                 name: "Clipper Menthol",
//                 is_taxable: true,
//                 category_id: "M3FKIKSLUVR35MHUEPTDW3WI",
//                 variations: [
//                 {
//                     type: "ITEM_VARIATION",
//                     id: "CINXD7HYNAHHUQJ44IHG26V2",
//                     present_at_location_ids: [
//                         "3P98D5NV1A3SM",
//                     ],
//                     item_variation_data: {
//                         item_id: "BHJ27JXVN7BIRNQTKKTV7XG6",
//                         name: "",
//                         sku: "0812615004713",
//                         ordinal: 1,
//                         pricing_type: "FIXED_PRICING",
//                         price_money: {
//                             amount: 349,
//                             currency: "USD",
//                         }
//                     },
//                 }]
//             }   
//             ],
//                 product_type: "REGULAR",
//             },
//         }
//         */
//         const itemData = item.item_data || {};

//         // Get the category name from the map that was built, using the category_id as the index
//         let categoryName = itemData.category_id ? categoryNameById[itemData.category_id] : null;

//         // If category is null, reuse existing product's category by name
//         if (!categoryName) {
//             let existingProduct = existingProducts.find(p => p.name === itemData.name);
//             categoryName = existingProduct?.category || null;
//         }

//         return {
//             square_id: item.id,
//             name: itemData.name || 'Unknown Product',
//             category: categoryName,
//             square_updated_at: item.updated_at ? new Date(item.updated_at).toISOString() : null,
//             synced_at: new Date().toISOString()
//         };
//     });

//     if (productsToUpsert.length === 0) {
//         console.log('No products to sync');
//         return;
//     }

//     // Batch upsert products, limit to 100 at a time so it doesnt crash
//     const batchSize = 100;
//     const page = 0;
//     for (let i = 0; i < productsToUpsert.length; i += batchSize) {

//         console.log(`Upserting page ${page} of product variations.`);

//         const batch = productsToUpsert.slice(i, i + batchSize);

//         const {error} = await supabase
//             .from('products')
//             .upsert(batch, {
//                 onConflict: 'square_id',
//                 ignoreDuplicates: false
//             });

//         if (error) {
//             console.error(`Error upserting products batch ${Math.floor(i / batchSize) + 1}:`, error);
//             throw error;
//         }
//     }

//     console.log(`Successfully synced ${productsToUpsert.length} products`);
// }

async function syncProducts({items, categoryNameById}) {
    console.log(`Syncing ${items.length} products...`);

    // Fetch existing products from your DB
    const existingProducts = await fetchAllProducts();

    // Fetch existing variations to understand the data relationships
    const {data: existingVariations = [], error: varError} = await supabase
        .from('product_variations')
        .select('product_id, square_variation_id');

    if (varError) {
        console.error('Error fetching existing variations:', varError);
        throw varError;
    }

    // Create lookup maps to handle the data integrity issues
    const existingBySquareId = new Map();
    const existingByName = new Map();
    const existingByGtin = new Map();
    const variationToProductMap = new Map();

    // Build variation lookup (variation_id -> product_id)
    existingVariations.forEach(v => {
        if (v.square_variation_id && v.product_id) {
            variationToProductMap.set(v.square_variation_id, v.product_id);
        }
    });

    existingProducts.forEach(p => {
        if (p.square_id) {
            existingBySquareId.set(p.square_id, p);
        }
        if (p.gtin) {
            existingByGtin.set(p.gtin, p);
        }
        // For name-based lookup, prefer products that have categories
        if (p.name) {
            const existing = existingByName.get(p.name);
            if (!existing || (!existing.category && p.category)) {
                existingByName.set(p.name, p);
            }
        }
    });

    const productsToUpsert = items.map(item => {
        const itemData = item.item_data || {};

        // Get the category name from Square
        let categoryName = itemData.category_id ? categoryNameById[itemData.category_id] : null;

        // If category is null from Square, try to preserve existing category data
        if (!categoryName) {
            let existingProduct = null;

            // Strategy 1: Try exact square_id match
            existingProduct = existingBySquareId.get(item.id);

            // Strategy 2: If this item ID appears as a variation_id, get the actual product
            if (!existingProduct) {
                const productId = variationToProductMap.get(item.id);
                if (productId) {
                    existingProduct = existingProducts.find(p => p.id === productId);
                    console.log(`Found product via variation mapping: ${item.id} -> ${productId} (${existingProduct?.name})`);
                }
            }

            // Strategy 3: Try to match by name and look for the best candidate
            if (!existingProduct) {
                const nameMatches = existingProducts.filter(p => p.name === itemData.name);
                if (nameMatches.length === 1) {
                    existingProduct = nameMatches[0];
                } else if (nameMatches.length > 1) {
                    // Multiple matches - prefer one with category, then most recent sync
                    existingProduct = nameMatches.reduce((best, current) => {
                        if (!best) return current;
                        if (current.category && !best.category) return current;
                        if (!current.category && best.category) return best;
                        // Both have category or both don't - pick most recently synced
                        return (current.synced_at || '') > (best.synced_at || '') ? current : best;
                    }, null);
                    console.log(`Multiple products found for "${itemData.name}", selected: ${existingProduct?.square_id} (category: ${existingProduct?.category})`);
                }
            }

            // Use existing category if found
            if (existingProduct && existingProduct.category) {
                categoryName = existingProduct.category;
                console.log(`Preserving category "${categoryName}" for "${itemData.name}" (Square ID: ${item.id})`);
            }
        }

        return {
            square_id: item.id,
            name: itemData.name || 'Unknown Product',
            category: categoryName,
            square_updated_at: item.updated_at ? new Date(item.updated_at).toISOString() : null,
            synced_at: new Date().toISOString()
        };
    });

    if (productsToUpsert.length === 0) {
        console.log('No products to sync');
        return;
    }

    // Batch upsert products, limit to 100 at a time so it doesnt crash
    const batchSize = 100;
    for (let i = 0; i < productsToUpsert.length; i += batchSize) {
        console.log(`Upserting batch ${Math.floor(i / batchSize) + 1} of products.`);

        const batch = productsToUpsert.slice(i, i + batchSize);

        const {error} = await supabase
            .from('products')
            .upsert(batch, {
                onConflict: 'square_id',
                ignoreDuplicates: false
            });

        if (error) {
            console.error(`Error upserting products batch ${Math.floor(i / batchSize) + 1}:`, error);
            throw error;
        }
    }

    console.log(`Successfully synced ${productsToUpsert.length} products`);
}


async function syncProductVariations({items, variations}) {
    console.log(`Starting with ${variations.length} variations...`);

    const products = await fetchAllProducts();
    /*
    {
        id: "0003068e-1c3a-420f-858f-2b75d786b93f",
        name: "Trojan-ENZ Spermicide 3ct",
        sku: null,
        category: null,
        square_id: "4HM7TCHVAMQWDN3DM4ZN5CKE",
    }
    */
    const productIdMap = {};
    products.forEach(p => {
        if (p.square_id && p.id) {
            productIdMap[p.square_id] = p.id;
        }
    });

    /* sample of an item in items
    {
        type: "ITEM",
        id: "BHJ27JXVN7BIRNQTKKTV7XG6",
        updated_at: "2025-08-07T05:22:19.879Z",
        created_at: "2021-06-18T05:14:38.369Z",
        version: 1754544139879,
        is_deleted: false,
        present_at_all_locations: false,
        present_at_location_ids: [
            "3P98D5NV1A3SM",
        ],
        item_data: {
            name: "Clipper Menthol",
            is_taxable: true,
            category_id: "M3FKIKSLUVR35MHUEPTDW3WI",
            variations: [
            {
                type: "ITEM_VARIATION",
                id: "CINXD7HYNAHHUQJ44IHG26V2",
                updated_at: "2025-08-07T05:22:19.879Z",
                created_at: "2022-09-04T18:21:54.166Z",
                version: 1754544139879,
                is_deleted: false,
                present_at_all_locations: false,
                present_at_location_ids: [
                "3P98D5NV1A3SM",
                ],
                item_variation_data: {
                item_id: "BHJ27JXVN7BIRNQTKKTV7XG6",
                name: "",
                sku: "0812615004713",
                ordinal: 1,
                pricing_type: "FIXED_PRICING",
                price_money: {
                    amount: 349,
                    currency: "USD",
                },
                sellable: true,
                stockable: true,
                channels: [
                    "CH_V3xNgKpBeB51Rhciliuf23IlNQlT2nqJMpn7BQlQuYC",
                ],
                },
            },
            ],
            product_type: "REGULAR",
            ecom_available: false,
            ecom_visibility: "UNAVAILABLE",
            channels: [
            "CH_V3xNgKpBeB51Rhciliuf23IlNQlT2nqJMpn7BQlQuYC",
            ],
            is_archived: false,
        },
        }
    */

    /* sample of an item variation inside of variations
    {
        type: "ITEM_VARIATION",
        id: "TN63JZV4IHXNQVGAOTX37J2C",
        updated_at: "2025-08-07T05:21:28.134Z",
        created_at: "2022-09-04T18:21:54.166Z",
        version: 1754544088134,
        is_deleted: false,
        present_at_all_locations: false,
        present_at_location_ids: [
            "LQZQSFETPS7Q3",
            "3P98D5NV1A3SM",
        ],
        item_variation_data: {
            item_id: "R5IDKLIHB5E6PLBHYPDGIL3A",
            name: "",
            sku: "6001087364614",
            ordinal: 1,
            pricing_type: "FIXED_PRICING",
            price_money: {
                amount: 499,
                currency: "USD",
            },
            sellable: true,
            stockable: true,
            channels: [
            "CH_V3xNgKpBeB51Rhciliuf23IlNQlT2nqJMpn7BQlQuYC",
            ],
        },
        }
    */
    const variationsToUpsert = variations
        .filter(variation => {
            // Only include variations whose parent item exists in our products table
            const parentItemId = variation.item_variation_data?.item_id;
            return parentItemId && productIdMap[parentItemId]; // checks mapping exists

        })
        .map(variation => {
            const variationData = variation.item_variation_data || {};
            const parentItemId = variationData.item_id;

            return {
                product_id: productIdMap[parentItemId],
                square_variation_id: variation.id,
                name: variationData.name || null,
                sku: variationData.sku || null,
                price: variationData.price_money ?
                    (variationData.price_money.amount / 100).toString() : null, // Convert cents to dollars
                square_version: variation.version,
                is_deleted: variation.is_deleted || false
            };
        });

    if (variationsToUpsert.length === 0) {
        console.log('No variations to sync');
        return;
    }

    // Batch upsert variations
    const batchSize = 100;
    for (let i = 0; i < variationsToUpsert.length; i += batchSize) {
        const batch = variationsToUpsert.slice(i, i + batchSize);

        const {error} = await supabase
            .from('product_variations')
            .upsert(batch, {
                onConflict: 'square_variation_id',
                ignoreDuplicates: false
            });

        if (error) {
            console.error(`Error upserting variations batch ${Math.floor(i / batchSize) + 1}:`, error);
            throw error;
        }
    }

    console.log(`Successfully synced ${variationsToUpsert.length} variations`);
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

//--------------------------------------------------------------------------------------------------------------------------
// async function fetchRecentSales(options, locationIds = []) {
//     if (!Array.isArray(locationIds) || locationIds.length === 0) {
//         throw new Error('fetchRecentSales requires an array of locationIds (max 10).');
//     }
//     // Square limits to 10 location IDs per request
//     const locs = locationIds.slice(0, 10);

//     const now = new Date();
//     const startDate = new Date(now);
//     startDate.setDate(now.getDate() - 14);

//     const startISO = startDate.toISOString();
//     const endISO = now.toISOString();

//     const sales = [];
//     let cursor = null;
//     let page = 0;
//     const maxPages = 50; // safety to avoid infinite loops

//     do {
//         const body = {
//             return_entries: false,
//             limit: 1000,
//             location_ids: locs,
//             query: {
//                 filter: {
//                     date_time_filter: {
//                         closed_at: {
//                             start_at: startISO,
//                             end_at: endISO
//                         }
//                     },
//                     state_filter: {
//                         states: ['COMPLETED']
//                     }
//                 },
//                 sort: {
//                     sort_field: 'CLOSED_AT',
//                     sort_order: 'DESC'
//                 }
//             },
//             cursor: cursor || undefined
//         };

//         const res = await fetchWithRetry('https://connect.squareup.com/v2/orders/search', {
//             method: 'POST',
//             headers: {
//                 ...options.headers,
//                 'Content-Type': 'application/json'
//             },
//             body: JSON.stringify(body)
//         });

//         if (!res.ok) {
//             const text = await res.text();
//             throw new Error(`Failed to fetch sales: ${res.status} - ${text}`);
//         }

//         const data = await res.json();
//         if (data.orders && data.orders.length) {
//             sales.wpush(...data.orders);

//             /*
//             data.orders[i]:
//             {
//                 id: "dG0TYOYvmOZPZaQb47MiBeysJmWZY",
//                 location_id: "3P98D5NV1A3SM",
//                 line_items: [
//                     {
//                     uid: "4e51d827-26c5-45a2-be18-2538cf242b1f",
//                     catalog_object_id: "TX4N67R6VIYPU6W24CP4BEZS", (in my db this is square_id in products table)
//                     catalog_version: 1754957952819,
//                     quantity: "2",
//                     name: "American Spirit Black",
//                     variation_name: "Regular",
//                     base_price_money: {
//                         amount: 1649,
//                         currency: "USD",
//                     },
//                     gross_sales_money: {
//                         amount: 3298,
//                         currency: "USD",
//                     },
//                     total_tax_money: {
//                         amount: 0,
//                         currency: "USD",
//                     },
//                     total_discount_money: {
//                         amount: 0,
//                         currency: "USD",
//                     },
//                     total_money: {
//                         amount: 3298,
//                         currency: "USD",
//                     },
//                     variation_total_price_money: {
//                         amount: 3298,
//                         currency: "USD",
//                     },
//                     item_type: "ITEM",
//                     total_service_charge_money: {
//                         amount: 0,
//                         currency: "USD",
//                     },
//                     },
//                     {
//                     uid: "516f7505-93e3-4a6a-8d01-6e7b0ab29f4a",
//                     catalog_object_id: "B7AGZ3B6NHW44J2XWLVP6GOY",
//                     catalog_version: 1754544424803,
//                     quantity: "2",
//                     name: "Bic small",
//                     variation_name: "",
//                     base_price_money: {
//                         amount: 249,
//                         currency: "USD",
//                     },
//                     gross_sales_money: {
//                         amount: 498,
//                         currency: "USD",
//                     },
//                     total_tax_money: {
//                         amount: 0,
//                         currency: "USD",
//                     },
//                     total_discount_money: {
//                         amount: 0,
//                         currency: "USD",
//                     },
//                     total_money: {
//                         amount: 498,
//                         currency: "USD",
//                     },
//                     variation_total_price_money: {
//                         amount: 498,
//                         currency: "USD",
//                     },
//                     item_type: "ITEM",
//                     total_service_charge_money: {
//                         amount: 0,
//                         currency: "USD",
//                     },
//                     },
//                 ],
//                 created_at: "2025-08-19T21:15:46.809Z",
//                 updated_at: "2025-08-19T21:15:49.000Z",
//                 state: "COMPLETED",
//                 version: 5,
//                 total_tax_money: {
//                     amount: 0,
//                     currency: "USD",
//                 },
//                 total_discount_money: {
//                     amount: 0,
//                     currency: "USD",
//                 },
//                 total_tip_money: {
//                     amount: 0,
//                     currency: "USD",
//                 },
//                 total_money: {
//                     amount: 3796,
//                     currency: "USD",
//                 },
//                 closed_at: "2025-08-19T21:15:47.697Z",
//                 tenders: [
//                     {
//                     id: "bfTNi37FZuX6mzLceD28IaQqDiVZY",
//                     location_id: "3P98D5NV1A3SM",
//                     transaction_id: "dG0TYOYvmOZPZaQb47MiBeysJmWZY",
//                     created_at: "2025-08-19T21:15:47Z",
//                     amount_money: {
//                         amount: 3796,
//                         currency: "USD",
//                     },
//                     type: "CASH",
//                     cash_details: {
//                         buyer_tendered_money: {
//                         amount: 3796,
//                         currency: "USD",
//                         },
//                         change_back_money: {
//                         amount: 0,
//                         currency: "USD",
//                         },
//                     },
//                     payment_id: "bfTNi37FZuX6mzLceD28IaQqDiVZY",
//                     },
//                 ],
//                 total_service_charge_money: {
//                     amount: 0,
//                     currency: "USD",
//                 },
//                 net_amounts: {
//                     total_money: {
//                     amount: 3796,
//                     currency: "USD",
//                     },
//                     tax_money: {
//                     amount: 0,
//                     currency: "USD",
//                     },
//                     discount_money: {
//                     amount: 0,
//                     currency: "USD",
//                     },
//                     tip_money: {
//                     amount: 0,
//                     currency: "USD",
//                     },
//                     service_charge_money: {
//                     amount: 0,
//                     currency: "USD",
//                     },
//                 },
//                 source: {
//                 },
//                 net_amount_due_money: {
//                     amount: 0,
//                     currency: "USD",
//                 },
//                 }

//             */
//             console.log(`Fetched ${data.orders.length} orders (page ${page + 1})`);
//         } else {
//             console.log(`No orders returned on page ${page + 1}`);
//         }

//         cursor = data.cursor || null;
//         page += 1;
//     } while (cursor && page < maxPages);

//     if (page >= maxPages) {
//         console.warn('fetchRecentSales stopped after maxPages; there may be more results.');
//     }

//     return sales;
// }

// Upsert sales
// async function upsertSales(orders) {
//     if (!orders || orders.length === 0) {
//         console.log('No sales to upsert.');
//         return;
//     }

//     const variationSquareIds = [];
//     const locationSquareIds = [];

//     for (const order of orders) {
//         if (order.location_id) locationSquareIds.push(order.location_id);
//         for (const lineItem of (order.line_items || [])) {
//             if (lineItem.catalog_object_id) {
//                 variationSquareIds.push(lineItem.catalog_object_id);
//             }
//         }
//     }

//     // Resolve product IDs for the catalog object ids
//     const productMap = await resolveProductIdsForSquareIds([...new Set(variationSquareIds)]);
//     if (!productMap || productMap.size === 0) {
//         console.warn('No product mappings resolved for sales; skipping.');
//         return;
//     }

//     const {data: foundLocations, error: locError} = await supabase
//         .from('locations')
//         .select('id, square_id')
//         .in('square_id', [...new Set(locationSquareIds)]);

//     if (locError) throw locError;
//     const foundLocationMap = new Map((foundLocations || []).map(l => [l.square_id, l.id]));

//     const rows = [];
//     for (const order of orders) {
//         const saleDate = order.closed_at || order.created_at || null;
//         const locLocalId = foundLocationMap.get(order.location_id);

//         for (const lineItem of (order.line_items || [])) {
//             const prodLocalId = productMap.get(lineItem.catalog_object_id);
//             if (!locLocalId || !prodLocalId) {
//                 if (!prodLocalId) console.warn(`No canonical product for catalog id ${lineItem.catalog_object_id}; skipping sale row.`);
//                 continue;
//             }

//             rows.push({
//                 square_id: `${order.id}-${lineItem.uid || lineItem.catalog_object_id}`,
//                 location_id: locLocalId,
//                 product_id: prodLocalId,
//                 quantity: parseInt(lineItem.quantity, 10) || 0,
//                 sale_date: saleDate
//             });
//         }
//     }

//     if (rows.length === 0) {
//         console.log('No valid sales rows to upsert.');
//         return;
//     }

//     const {error} = await supabase
//         .from('sales')
//         .upsert(rows, {onConflict: 'square_id'});
//     if (error) console.error('Error upserting sales:', error);
//     else console.log(`Upserted ${rows.length} sales rows`);
// }

// async function salesSync() {
//     console.log("Starting sales sync...")
//     const options = {
//         headers: {
//             'Square-Version': '2023-08-16',
//             'Authorization': `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
//             'Content-Type': 'application/json',
//         },
//     }

//     const locRes = await fetchWithRetry('https://connect.squareup.com/v2/locations', options)
//     if (!locRes.ok) throw new Error(`Failed to fetch locations: ${locRes.status}`)
//     const locData = await locRes.json()
//     const locationIds = locData.locations.map(l => l.id).filter(Boolean)

//     if (!locationIds.length) {
//         console.warn("No locations found; skipping sales sync.")
//         return
//     }

//     const recentSales = await fetchRecentSales(options, locationIds)
//     await upsertSales(recentSales)

//     console.log("Finished sales sync")
// }

//--------------------------------------------------------------------------------------------------------------------------
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
    console.log('Starting fullSync: fetching all catalog objects from Square...');

    await productSync();

    await locationSync();

    await salesSync();

    await inventorySync();

    console.log('Full sync completed successfully.');
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
    upsertInventoryCounts,
    upsertLocations,
    fullSync,
    productSync,
    locationSync,
    inventorySync,
    resolveProductIdsForSquareIds,
    syncProductsAndMappings,
    buildCatalogMaps,
    fetchInventoryCountsBatch
}
