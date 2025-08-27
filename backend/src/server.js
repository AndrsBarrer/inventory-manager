// server.js

import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import {spawn} from 'child_process'
import path from 'path'

// Supabase client (server-only)
import {supabase} from './supabaseClient.js'

// ✅ Import sync helper functions
import {
    upsertProductOrDelete,
    upsertInventoryCounts,
    upsertLocations,
    fetchCatalogObject
} from './syncToSupabase.js'

import {
    getCategoryFromName,
    getMinimumStockByCategory,
    getMinimumStockFromName,
    getUnitsPerCaseFromName
} from './utils/stockRules.js'

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors({
    origin: [
        'http://localhost:5173',              // Vite dev
        'http://localhost:8080',   // the origin from your error
        process.env.FRONTEND_URL              // e.g. https://my-app.netlify.app
    ].filter(Boolean),
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
}))

app.use(bodyParser.json())

let syncInProgress = false; // global flag

// --- Manual sync endpoint ---
app.post('/api/sync', (req, res) => {
    if (syncInProgress) {
        return res.status(429).json({message: 'A sync is already in progress. Please wait.'});
    }

    try {
        const {type = 'full'} = req.body; // default = full sync
        const scriptPath = path.resolve(process.cwd(), 'src', 'syncToSupabase.js');

        console.log(`Spawning sync script (${type}) at:`, scriptPath);

        syncInProgress = true; // lock

        // Pass the type to the child process
        const syncProcess = spawn(process.execPath, [scriptPath, type], {
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        syncProcess.stdout.on('data', (data) => {
            process.stdout.write(`[sync stdout] ${data}`);
        });
        syncProcess.stderr.on('data', (data) => {
            process.stderr.write(`[sync stderr] ${data}`);
        });

        syncProcess.on('close', (code) => {
            console.log(`Sync process exited with code ${code}`);
            syncInProgress = false;

            if (code === 0) {
                return res.status(200).json({message: `Sync (${type}) completed`});
            } else {
                return res.status(500).json({message: `Sync process exited with code ${code}`});
            }
        });
    } catch (err) {
        console.error('Sync spawn error:', err);
        syncInProgress = false;
        return res.status(500).json({message: 'Sync spawn error'});
    }
});

// --- Low-stock endpoint (fixed & integrated snippet) ---
app.get('/api/low-stock', async (req, res) => {
    try {
        let start = Date.now();
        let entireProcess = Date.now();

        console.log('>>> /api/low-stock START')

        start = Date.now();
        // --- Fetch all locations ---
        const {data: locationsData, error: locationsError} = await supabase
            .from('locations')
            .select('id, name'); // each location has id, name, square_id (these are the important fields)
        if (locationsError) throw locationsError;
        // console.log('locations count:', (locationsData || []).length);
        // console.log('locations sample:', (locationsData || []).slice(0, 3));

        console.log(`>>> /api/low-stock fetched locations in ${Date.now() - start} ms`)

        let allProducts = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;

        start = Date.now();
        while (hasMore) {
            const {data, error} = await supabase
                .from('products')
                .select('id, name, sku') // every product has an id, name, sku
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) throw error;

            allProducts = allProducts.concat(data || []);
            hasMore = (data || []).length === pageSize;
            page++;
        }

        const productsData = allProducts;
        console.log(`>>> /api/low-stock fetched products in ${Date.now() - start} ms`)

        let inventoryRows = [];
        let invFrom = 0;
        const invChunk = 1000;
        let invDone = false;

        start = Date.now();
        while (!invDone) {
            const {data: invChunkData, error: invChunkError} = await supabase
                .from('inventory')
                .select('location_id, product_id,  quantity', {count: 'exact'})
                .range(invFrom, invFrom + invChunk - 1);

            if (invChunkError) {
                console.error('Error fetching inventory chunk:', {from: invFrom, chunkSize: invChunk, error: invChunkError});
                // bail out (so the endpoint still responds) — or you can throw to fail fast
                break;
            }

            if (!invChunkData || invChunkData.length === 0) {
                invDone = true;
                break;
            }

            inventoryRows.push(...invChunkData);
            invFrom += invChunk;

            if (invChunkData.length < invChunk) invDone = true;
        }

        console.log(`>>> /api/low-stock fetched inventory in ${Date.now() - start} ms`)

        // Creates a map of inventory where key is product_id, and value is array of objects with location_id and quantity
        const inventoryMap = new Map();
        (inventoryRows || []).forEach(r => {
            if (!r || r.product_id === null || r.product_id === undefined) return;
            const pid = String(r.product_id).trim().toLowerCase();

            if (!inventoryMap.has(pid)) inventoryMap.set(pid, []);
            inventoryMap.get(pid).push({
                location_id: r.location_id ? String(r.location_id).trim().toLowerCase() : null,
                quantity: (r.quantity === null || r.quantity === undefined) ? null : Number(r.quantity)
            });
        });


        // --- Fetch recent sales in chunks ---
        const WINDOW_DAYS = 14;
        const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

        let allSales = [];
        let from = 0;
        const chunkSize = 1000;
        let done = false;

        start = Date.now();
        while (!done) {
            const {data, error} = await supabase
                .from('sales')
                .select('location_id, product_id, quantity, sale_date', {count: 'exact'})
                .gte('sale_date', since)
                .range(from, from + chunkSize - 1);

            if (error) {
                console.error('Error fetching sales chunk:', error);
                break;
            }

            if (!data || data.length === 0) {
                done = true;
                break;
            }

            allSales.push(...data);
            from += chunkSize;

            if (data.length < chunkSize) done = true;
        }

        console.log(`>>> /api/low-stock fetched sales in ${Date.now() - start} ms`)

        // --- Aggregate sales ---
        const salesAgg = new Map();
        allSales.forEach(s => {
            const key = `${s.product_id}::${s.location_id || 'all'}`;
            salesAgg.set(key, (salesAgg.get(key) || 0) + (s.quantity || 0));
        });

        // --- Convert aggregated Map to JSON array ---
        const salesJson = Array.from(salesAgg.entries()).map(([key, quantity]) => {
            const [product_id, location_id] = key.split('::');
            return {
                product_id,
                location_id,
                sales: quantity,
                salesPerDay: quantity / WINDOW_DAYS // average daily sales over WINDOW_DAYS
            };
        });

        // console.log('aggregated sales JSON:', salesJson.slice(0, 20)); // sample

        const productMap = new Map(productsData.map(prod => [prod.id, prod]));
        const salesMap = new Map(salesJson.map(sale => [`${sale.product_id}::${sale.location_id}`, sale]));

        start = Date.now();
        // Build final locations array with nested products
        const finalLocations = locationsData.map(location => {
            // Filter inventory items that belong to this location
            const locationInventory = inventoryRows.filter(item => item.location_id === location.id);

            // Map inventory items to products
            const products = locationInventory.map(inventoryItem => {
                const product = productMap.get(inventoryItem.product_id);
                const sale = salesMap.get(`${inventoryItem.product_id}::${inventoryItem.location_id}`);

                const productCategory = getCategoryFromName(product.name);

                // Business rules
                const unitsPerCase = getUnitsPerCaseFromName(product.name, productCategory);
                const minStockRule = getMinimumStockFromName(product.name, sale?.salesPerDay);
                const categoryMinStock = getMinimumStockByCategory(productCategory, sale?.salesPerDay);

                // Use product-specific min stock if defined, otherwise fallback to category-level
                const minimumStock = minStockRule?.minimumStock || categoryMinStock;

                // Suggested order = how many units to reach minimum stock, rounded to case size
                let suggestedOrderUnits = Math.max(minimumStock - (inventoryItem.quantity || 0), 0);
                if (suggestedOrderUnits > 0 && unitsPerCase > 1) {
                    suggestedOrderUnits = Math.ceil(suggestedOrderUnits / unitsPerCase) * unitsPerCase;
                }

                return {
                    id: inventoryItem.product_id,
                    name: product?.name,
                    sku: product?.sku || null,
                    category: productCategory,
                    sales: sale?.sales || 0,
                    salesPerDay: sale?.salesPerDay || 0,
                    inventory: inventoryItem.quantity,
                    minimumStock,
                    unitsPerCase,
                    low_stock: inventoryItem.quantity < minimumStock,
                    suggested_order: suggestedOrderUnits
                };
            });

            return {
                id: location.id,
                name: location.name,
                products
            };
        });
        console.log(`>>> /api/low-stock built final response in ${Date.now() - start} ms`)
        console.log(`>>> /api/low-stock END in ${(Date.now() - entireProcess) / 1000}s`)

        // Respond
        res.json({locations: finalLocations});
        return;

    } catch (err) {
        console.error('Error fetching low-stock items:', err)
        res.status(500).json({error: err.message || 'Internal server error'})
    }
})

// --- Low-stock endpoint (joined inventory + product -> locations JSON) ---
app.get('/api/low-stock', async (req, res) => {
    try {
        console.log('>>> /api/low-stock START')

        // optional: filter by a single location to reduce traffic
        const {locationId} = req.query;

        // 1) fetch locations (we still need names)
        const {data: locationsData, error: locationsError} = await supabase
            .from('locations')
            .select('id, name');
        if (locationsError) throw locationsError;

        // build a location map so we always return all locations (even if no products)
        const locationMap = new Map();
        for (const loc of locationsData || []) {
            locationMap.set(String(loc.id), {id: loc.id, name: loc.name, products: []});
        }

        // 2) fetch inventory rows with embedded product info (one DB call)
        //    This relies on the FK relationship inventory.product_id -> products.id
        //    PostgREST (Supabase) will return product as an object if you select it like below.
        let inventoryQuery = supabase
            .from('inventory')
            .select(`
        product_id,
        location_id,
        quantity,
        product:products(id, name, sku, category)
      `);

        if (locationId) inventoryQuery = inventoryQuery.eq('location_id', locationId);

        const {data: invRows = [], error: invError} = await inventoryQuery;
        if (invError) throw invError;

        console.log(`>>> /api/low-stock fetched ${invRows.length} inventory rows`);

        // 3) fetch recent sales for WINDOW_DAYS and aggregate (same approach you had)
        const WINDOW_DAYS = 14;
        const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

        let salesQuery = supabase
            .from('sales')
            .select('product_id, location_id, quantity')
            .gte('sale_date', since);

        if (locationId) salesQuery = salesQuery.eq('location_id', locationId);

        const {data: recentSales = [], error: salesError} = await salesQuery;
        if (salesError) throw salesError;

        // aggregate sales: key = `${product_id}::${location_id || 'all'}`
        const salesAgg = new Map();
        for (const s of recentSales) {
            const key = `${s.product_id}::${s.location_id || 'all'}`;
            salesAgg.set(key, (salesAgg.get(key) || 0) + (s.quantity || 0));
        }

        // helper: get aggregated sale for product/location
        const getSale = (productId, locId) => {
            const keyLoc = `${productId}::${locId}`;
            const keyAll = `${productId}::all`;
            const qty = salesAgg.get(keyLoc) ?? salesAgg.get(keyAll) ?? 0;
            return {
                sales: qty,
                salesPerDay: qty / WINDOW_DAYS
            };
        };

        // 4) For each inventory row, compose a product object and push into the relevant location
        for (const row of invRows) {
            // if product was not embedded (shouldn't happen if FK exists), skip
            const product = row.product || null;
            if (!product) {
                console.warn('Inventory row missing joined product:', row);
                continue;
            }

            const locId = row.location_id ? String(row.location_id) : null;
            const locEntry = locationMap.get(String(locId)) || null;

            // If the inventory row references a location that's not in locations table, create a placeholder
            if (!locEntry) {
                // optionally create a placeholder location entry
                locationMap.set(String(locId), {
                    id: row.location_id,
                    name: '(unknown location)',
                    products: []
                });
            }

            const sale = getSale(row.product_id, row.location_id);

            const productCategory = getCategoryFromName(product.name);
            const unitsPerCase = getUnitsPerCaseFromName(product.name, productCategory);
            const minStockRule = getMinimumStockFromName(product.name, sale.salesPerDay);
            const categoryMinStock = getMinimumStockByCategory(productCategory, sale.salesPerDay);
            const minimumStock = (minStockRule && minStockRule.minimumStock) || categoryMinStock || 0;

            const currentQty = (row.quantity === null || row.quantity === undefined) ? 0 : Number(row.quantity);
            let suggestedOrderUnits = Math.max(minimumStock - currentQty, 0);
            if (suggestedOrderUnits > 0 && unitsPerCase > 1) {
                suggestedOrderUnits = Math.ceil(suggestedOrderUnits / unitsPerCase) * unitsPerCase;
            }

            const productObj = {
                id: row.product_id,
                name: product.name,
                sku: product.sku || null,
                category: product.category || productCategory,
                sales: sale.sales || 0,
                salesPerDay: sale.salesPerDay || 0,
                inventory: currentQty,
                minimumStock,
                unitsPerCase,
                low_stock: currentQty < minimumStock,
                suggested_order: suggestedOrderUnits
            };

            // push product into location entry
            const target = locationMap.get(String(locId));
            target.products.push(productObj);
        }

        // 5) final array: make sure to include all locations even if they have no products
        const finalLocations = Array.from(locationMap.values());

        console.log('>>> /api/low-stock END');

        return res.json({locations: finalLocations});
    } catch (err) {
        console.error('Error building low-stock JSON:', err);
        return res.status(500).json({error: err.message || 'Internal server error'});
    }
});


// --- Endpoint to fetch all products, with optional filtering ---
app.get('/api/products', async (req, res) => {
    try {
        const {locationId} = req.query; // optional filter by location

        // 1️⃣ Fetch locations
        const {data: locationsData, error: locationsError} = await supabase
            .from('locations')
            .select('id, name');
        if (locationsError) throw locationsError;

        // 2️⃣ Fetch products with inventory
        const {data: productsData, error: productsError} = await supabase
            .from('products')
            .select('id, name, category, inventory:inventory(quantity, location_id)');
        if (productsError) throw productsError;

        // 3️⃣ Build full product list, attach inventory info and location name
        const allProducts = [];
        (productsData || []).forEach(p => {
            if (p.name === 'Regular') return; // skip "Regular"

            const inventoryRows = Array.isArray(p.inventory) && p.inventory.length > 0
                ? p.inventory
                : [{quantity: 0, location_id: null}];

            inventoryRows.forEach(inv => {
                const locId = inv.location_id || null;
                const locName = locationsData?.find(l => l.id === locId)?.name;

                // Optional filter by location
                if (locationId && locId !== locationId) return;

                allProducts.push({
                    productId: p.id,
                    name: p.name,
                    category: p.category,
                    locationId: locId,
                    locationName: locName,
                    currentStock: inv.quantity || 0
                });
            });
        });

        res.json({locations: locationsData, products: allProducts});
    } catch (err) {
        console.error('Error fetching all products:', err);
        res.status(500).json({error: err.message || 'Internal server error'});
    }
});



app.listen(PORT, () => {
    console.log(`Backend server listening on port ${PORT}`)
})
