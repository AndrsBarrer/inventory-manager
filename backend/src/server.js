// server.js

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { spawn } from "child_process";
import path from "path";

// Supabase client (server-only)
import { supabase } from "./supabaseClient.js";

import {
  normalize,
  getCategoryFromName,
  getInventoryRules,
} from "./utils/stockRules.js";
const LEAD_TIME_DAYS = 3;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: [
      "http://localhost:5173", // Vite dev
      "http://localhost:8080", // the origin from your error
      process.env.FRONTEND_URL, // e.g. https://my-app.netlify.app
    ].filter(Boolean),
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  })
);

app.use(bodyParser.json());

let syncInProgress = false; // global flag

// --- Manual sync endpoint ---
app.post("/api/sync", (req, res) => {
  if (syncInProgress) {
    return res
      .status(429)
      .json({ message: "A sync is already in progress. Please wait." });
  }

  try {
    const { type = "full" } = req.body; // default = full sync
    const scriptPath = path.resolve(process.cwd(), "src", "syncToSupabase.js");

    console.log(`Spawning sync script (${type}) at:`, scriptPath);

    syncInProgress = true; // lock

    // Pass the type to the child process
    const syncProcess = spawn(process.execPath, [scriptPath, type], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    syncProcess.stdout.on("data", (data) => {
      process.stdout.write(`[sync stdout] ${data}`);
    });
    syncProcess.stderr.on("data", (data) => {
      process.stderr.write(`[sync stderr] ${data}`);
    });

    syncProcess.on("close", (code) => {
      console.log(`Sync process exited with code ${code}`);
      syncInProgress = false;

      if (code === 0) {
        return res.status(200).json({ message: `Sync (${type}) completed` });
      } else {
        return res
          .status(500)
          .json({ message: `Sync process exited with code ${code}` });
      }
    });
  } catch (err) {
    console.error("Sync spawn error:", err);
    syncInProgress = false;
    return res.status(500).json({ message: "Sync spawn error" });
  }
});

const fetchAllLocations = async () => {
  const { data: locationsData, error: locationsError } = await supabase
    .from("locations")
    .select("id, name");
  if (locationsError) throw locationsError;

  return locationsData;
};

// Fetches all products in batches
export const fetchAllProducts = async () => {
  let allProducts = [];
  let page = 0;
  const productPageSize = 1000;
  let hasMoreProducts = true;

  while (hasMoreProducts) {
    const { data, error } = await supabase
      .from("products")
      .select("id, name, sku, category, square_id")
      .eq("is_deleted", false)
      .range(page * productPageSize, (page + 1) * productPageSize - 1)
      .order("id");

    if (error) throw error;
    allProducts = allProducts.concat(data || []);
    hasMoreProducts = (data || []).length === productPageSize;
    page++;
  }
  return allProducts;
};

const fetchAllVariations = async () => {
  let allVariations = [];
  let variationPage = 0;
  const variationPageSize = 1000;
  let hasMoreVariations = true;

  // A variation has a product_id that is the id of a product, that is how the category can be gotten, just reference the parent product
  while (hasMoreVariations) {
    const { data, error } = await supabase
      .from("product_variations")
      .select("id, product_id, square_variation_id, name, sku, price")
      .eq("is_deleted", false)
      .range(
        variationPage * variationPageSize,
        (variationPage + 1) * variationPageSize - 1
      )
      .order("id");

    if (error) throw error;
    allVariations = allVariations.concat(data || []);
    hasMoreVariations = (data || []).length === variationPageSize;
    variationPage++;
  }
  return allVariations;
};

const normalizeCategory = (s) => (s || "").toString().trim().toLowerCase();

const fetchAllInventory = async () => {
  let allInventory = [];
  let inventoryPage = 0;
  const inventoryPageSize = 1000;
  let hasMoreInventory = true;

  while (hasMoreInventory) {
    const { data, error } = await supabase
      .from("inventory")
      .select("location_id, product_id, variation_id, quantity")
      .range(
        inventoryPage * inventoryPageSize,
        (inventoryPage + 1) * inventoryPageSize - 1
      )
      .order("id");

    if (error) throw error;
    allInventory = allInventory.concat(data || []);
    hasMoreInventory = (data || []).length === inventoryPageSize;
    inventoryPage++;
  }
  return allInventory;
};

const WINDOW_DAYS = 14;
const fetchRecentSales = async () => {
  const since = new Date(
    Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  let allSales = [];
  let salesPage = 0;
  const salesPageSize = 1000;
  let hasMoreSales = true;

  while (hasMoreSales) {
    const { data, error } = await supabase
      .from("sales")
      .select("location_id, product_id, variation_id, quantity, sale_date")
      .gte("sale_date", since)
      .range(salesPage * salesPageSize, (salesPage + 1) * salesPageSize - 1)
      .order("sale_date", { ascending: false });

    if (error) throw error;
    allSales = allSales.concat(data || []);
    hasMoreSales = (data || []).length === salesPageSize;
    salesPage++;
  }
  return allSales;
};

app.get("/api/low-stock", async (req, res) => {
  try {
    const entireProcess = Date.now();
    console.log(">>> [/api/low-stock] START");

    const [locationsData, allProducts, allVariations, allInventory, allSales] =
      await Promise.all([
        fetchAllLocations(),
        fetchAllProducts(),
        fetchAllVariations(),
        fetchAllInventory(),
        fetchRecentSales(),
      ]);

    console.log(
      `>>> [/api/low-stock] Fetched ${locationsData.length} locations.`
    );
    console.log(`>>> [/api/low-stock] Fetched ${allProducts.length} products.`);
    console.log(
      `>>> [/api/low-stock] Fetched ${allVariations.length} variations.`
    );
    console.log(
      `>>> [/api/low-stock] Fetched ${allInventory.length} inventory records.`
    );
    console.log(
      `>>> [/api/low-stock] Fetched ${allSales.length} sales records.`
    );

    const productMap = new Map(allProducts.map((p) => [p.id, p]));
    const variationMap = new Map();
    allVariations.forEach((variation) => {
      const product = productMap.get(variation.product_id);
      if (product) {
        variationMap.set(variation.id, {
          ...variation,
          product: product,
        });
      }
    });

    const salesAgg = new Map();
    allSales.forEach((s) => {
      const itemId = s.variation_id || s.product_id;
      const key = `${itemId}::${s.location_id}`;
      salesAgg.set(key, (salesAgg.get(key) || 0) + (s.quantity || 0));
    });

    const salesMap = new Map();
    salesAgg.forEach((quantity, key) => {
      const [item_id, location_id] = key.split("::");
      salesMap.set(key, {
        item_id,
        location_id,
        sales: quantity,
        salesPerDay: quantity / WINDOW_DAYS,
      });
    });

    const finalResponse = locationsData.map((location) => {
      const locationInventory = allInventory.filter(
        (item) => item.location_id === location.id
      );
      const productGroups = new Map();

      locationInventory.forEach((inventoryItem) => {
        const productId = inventoryItem.product_id;
        if (!productGroups.has(productId)) {
          const product = productMap.get(productId);
          if (!product) return; // Skip if product doesn't exist
          productGroups.set(productId, {
            product: product,
            variations: [],
          });
        }

        const variation = inventoryItem.variation_id
          ? variationMap.get(inventoryItem.variation_id)
          : null;
        const relevantProduct = variation?.product || productMap.get(productId);
        if (!relevantProduct) return; // Skip if neither product nor variation exists

        const itemName = variation?.name || relevantProduct?.name;
        const productCategory = getCategoryFromName(
          relevantProduct.name || relevantProduct.category
        );

        const salesKey = inventoryItem.variation_id
          ? `${inventoryItem.variation_id}::${location.id}`
          : `${inventoryItem.product_id}::${location.id}`;
        const sale = salesMap.get(salesKey);
        const dailySales = sale?.salesPerDay || 0;

        // --- Use the new getInventoryRules function ---
        const { unitsPerCase, minStockUnits } = getInventoryRules({
          normalizedName: normalize(itemName),
          normalizedCategory: productCategory,
          avgDailySales: dailySales,
          leadTimeDays: LEAD_TIME_DAYS,
        });

        // --- Calculate final minimum stock and suggested order ---
        const minimumStock = minStockUnits;
        const isLowStock = (inventoryItem.quantity || 0) < minimumStock;
        let suggestedOrderUnits = Math.max(
          minimumStock - (inventoryItem.quantity || 0),
          0
        );

        if (suggestedOrderUnits > 0 && unitsPerCase > 1) {
          suggestedOrderUnits =
            Math.ceil(suggestedOrderUnits / unitsPerCase) * unitsPerCase;
        }

        // Debug logging remains useful here
        if (itemName === "American Spirit Blue") {
          console.log("Location:", location.name);
          console.log(
            "Calculated Data:",
            "Inventory:",
            inventoryItem.quantity,
            "Sales:",
            sale?.sales,
            "Daily Sales:",
            dailySales,
            "Minimum Stock:",
            minimumStock,
            "Units Per Case:",
            unitsPerCase,
            "Suggested Order:",
            suggestedOrderUnits
          );
        }

        const finalId = inventoryItem.variation_id || inventoryItem.product_id;
        const variationData = {
          id: finalId,
          variation_id: inventoryItem.variation_id,
          variation_name: variation?.name,
          variation_sku: variation?.sku,
          variation_price: variation?.price,
          category: productCategory,
          sales: sale?.sales || 0,
          salesPerDay: dailySales,
          inventory: inventoryItem.quantity,
          minimumStock,
          unitsPerCase,
          low_stock: isLowStock,
          suggested_order: suggestedOrderUnits,
        };

        productGroups.get(productId).variations.push(variationData);
      });

      const products = Array.from(productGroups.values()).map((group) => {
        const product = group.product;
        const variations = group.variations;

        // Category: always normalize directly from DB (ignore variation “guesses”)
        const productCategory = product?.category
          ? normalizeCategory(product.category)
          : "uncategorized";

        const totalSales = variations.reduce(
          (sum, v) => sum + (v.sales || 0),
          0
        );
        const totalInventory = variations.reduce(
          (sum, v) => sum + (v.inventory || 0),
          0
        );
        const totalSuggestedOrder = variations.reduce(
          (sum, v) => sum + (v.suggested_order || 0),
          0
        );
        const hasLowStock = variations.some((v) => v.low_stock);

        return {
          id: product?.id,
          name: product?.name,
          sku: product?.sku || null,
          category: productCategory, // normalized consistently
          sales: totalSales,
          salesPerDay: totalSales / WINDOW_DAYS,
          inventory: totalInventory,
          low_stock: hasLowStock,
          suggested_order: totalSuggestedOrder,
          variations: variations,
        };
      });

      return { id: location.id, name: location.name, products };
    });

    console.log(
      `>>> [/api/low - stock] END in ${(Date.now() - entireProcess) / 1000}s`
    );
    // console.log(finalResponse); // optionally comment out if large
    res.json({ locations: finalResponse });
  } catch (err) {
    console.error(">>> [/api/low-stock] Error fetching low-stock items:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// app.get("/api/low-stock", async (req, res) => {
//   try {
//     const entireProcess = Date.now();
//     console.log(">>> [/api/low-stock] START");

//     // --- Fetch all locations ---
//     const locationsData = await fetchAllLocations();
//     console.log(
//       `>>> [/api/low-stock] Fetched ${locationsData.length} locations`
//     );

//     // --- Fetch all products ---
//     const allProducts = await fetchAllProducts();
//     console.log(`>>> [/api/low-stock] Fetched ${allProducts.length} products.`);
//     /*
//         {
//             id: "04a35539-c932-4bca-b57f-10ef4699d3fb",
//             name: "Sapporo 22oz",
//             sku: null,
//             category: "Imported Beer",
//             square_id: "OQZDQZLC4BML34QGJH6NH4H3",
//         }
//         */

//     // --- Fetch all variations in batches ---
//     const allVariations = await fetchAllVariations();
//     /*
//         {
//             id: "093eded6-6118-495d-9244-303535b6f602",
//             product_id: "590e60be-13b1-4d63-ab0a-670e677f92bf",
//             square_variation_id: "GMYA36PWLBUWQ2ZBMRVSDEGU",
//             name: "Regular",
//             sku: "026400700081",
//             price: 2.99,
//         }
//         */
//     console.log(
//       `>>> [/api/low-stock] Fetched ${allVariations.length} variations.`
//     );

//     // Build lookup maps, using the id of the product as the index, and then the whole product
//     const productMap = new Map(allProducts.map((p) => [p.id, p]));
//     /* in the product_variation table, id here, is the product_id in the table
//         [
//         "09c85161-df12-4277-b1f6-17abcbabfaa5",
//             {
//                 id: "09c85161-df12-4277-b1f6-17abcbabfaa5",
//                 name: "Organic Valley, Reduced Fat 2% Ultra Pasteurized Milk, Organic, Local",
//                 sku: null,
//                 category: null,
//                 square_id: "4UCNFZNXHYR3CA77ZCYSTOK5",
//             },
//         ]
//         */

//     const variationMap = new Map();

//     allVariations.forEach((variation) => {
//       // Get the parent product of the variation, by using the lookup map
//       const product = productMap.get(variation.product_id);

//       // Now use the variation id to set the rest of the data to the variation data + parent data
//       variationMap.set(variation.id, {
//         ...variation,
//         product: product,
//       });
//     });

//     // --- Fetch inventory ---
//     const allInventory = await fetchAllInventory();
//     /*
//         {
//             location_id: "9e1989e6-1f02-4d40-ae1a-1d0614070274",
//             product_id: "0d6836e5-5b08-4ccb-af6b-6a0ab2c74243",
//             variation_id: null,
//             quantity: 0,
//         }
//         */
//     console.log(
//       `>>> [/api/low-stock] Fetched ${allInventory.length} inventory records.`
//     );

//     // --- Fetch recent sales ---
//     const allSales = await fetchRecentSales();
//     /*
//         {
//             location_id: "070620de-e568-4c41-b3b7-c19774434d57",
//             product_id: "cc3f6e36-53ef-4e09-8163-e8fb0ab600e1",
//             variation_id: "75b75659-4938-445f-9d40-e4d27ee6906b",
//             quantity: 2,
//             sale_date: "2025-08-31T03:52:53.035+00:00",
//         }
//         so here, the product is La Crema Sonoma Coast Chardonney White Wine
//         This information is gotten from the products table by using the product_id as "id" in the table
//         Using variation_id as "id" in the product_variations table will get us the name of the variation "Regular".
//         Sales for this product and its specific variation should still be aggregated though.
//         */
//     console.log(
//       `>>> [/api/low-stock] Fetched ${allSales.length} sales records.`
//     );

//     // --- Aggregate sales by variation/product and location ---
//     const salesAgg = new Map();
//     allSales.forEach((s) => {
//       // Prefer variation_id, fallback to product_id
//       const itemId = s.variation_id || s.product_id;
//       const key = `${itemId}::${s.location_id}`;
//       salesAgg.set(key, (salesAgg.get(key) || 0) + (s.quantity || 0)); // fast way of getting and modifying value from hashmap
//     });

//     const salesMap = new Map(
//       Array.from(salesAgg.entries()).map(([key, quantity]) => {
//         const [item_id, location_id] = key.split("::");
//         return [
//           key,
//           {
//             item_id,
//             location_id,
//             sales: quantity,
//             salesPerDay: quantity / WINDOW_DAYS,
//           },
//         ];
//       })
//     );

//     console.log(salesMap);
//     /*
//         key: item_id::location_id
//         {
//             [
//                 "38bb7c2d-a2ff-4899-9bd3-204f08e1b551:: 9e1989e6-1f02-4d40-ae1a-1d0614070274",
//                 {
//                     item_id: "38bb7c2d-a2ff-4899-9bd3-204f08e1b551",
//                     location_id: " 9e1989e6-1f02-4d40-ae1a-1d0614070274",
//                     sales: 26,
//                     salesPerDay: 1.8571428571428572,
//                 },
//             ]
//         }
//         */
//     const normalizeCategory = (s) => (s || "").toString().trim().toLowerCase();

//     const finalResponse = locationsData.map((location) => {
//       const locationInventory = allInventory.filter(
//         (item) => item.location_id === location.id
//       ); // correct

//       const productGroups = new Map();

//       locationInventory.forEach((inventoryItem) => {
//         const productId = inventoryItem.product_id;

//         //          {
//         //     location_id: "9e1989e6-1f02-4d40-ae1a-1d0614070274",
//         //     product_id: "0d6836e5-5b08-4ccb-af6b-6a0ab2c74243",
//         //     variation_id: null,
//         //     quantity: 0,
//         // }
//         if (!productGroups.has(productId)) {
//           const product = productMap.get(productId);

//           productGroups.set(productId, {
//             product: product,
//             variations: [],
//           });
//         }

//         const variation = inventoryItem.variation_id
//           ? variationMap.get(inventoryItem.variation_id)
//           : null;

//         // Like was mentioned before, the variation is the first key and the product key is the fallback
//         // Construct the sales key
//         const salesKey = inventoryItem.variation_id
//           ? `${inventoryItem.variation_id}::${location.id}`
//           : `${inventoryItem.product_id}::${location.id}`;

//         // Use the constructed sales key to get the sales for this specific item
//         const sale = salesMap.get(salesKey);

//         // Either we have the variation of the parent product if no variation was previously found
//         // This should have the relevant product info (like category) since it was added to the variation
//         const relevantProduct = variation?.product || productMap.get(productId);

//         // Always pull category directly from product table, normalize it
//         const productCategory = relevantProduct?.category
//           ? normalizeCategory(relevantProduct.category)
//           : "uncategorized";

//         const itemName = variation?.name || relevantProduct?.name;
//         const unitsPerCase = getUnitsPerCaseFromName(itemName, productCategory);

//         // -----------------------------------------------------------------------
//         // START OF UPDATED LOGIC TO HANDLE LEAD TIME
//         // -----------------------------------------------------------------------
//         const LEAD_TIME_DAYS = 3;
//         const dailySales = sale?.salesPerDay || 0;

//         // Use the predefined or category-based minimum stock as a starting point.
//         const preExistingMinimumStock =
//           getMinimumStockFromName(itemName, dailySales) ||
//           getMinimumStockByCategory(productCategory, dailySales) ||
//           0;

//         // Calculate the stock needed to cover sales during the lead time.
//         const leadTimeStock = dailySales * LEAD_TIME_DAYS;

//         // The new, adjusted minimum stock is the sum of the preexisting rule and the lead time stock.
//         // We use Math.ceil to round up to a whole unit.
//         const minimumStock = Math.ceil(
//           preExistingMinimumStock.minimumStock + leadTimeStock
//         );
//         /*
//         ok so this is good and all, but the problem here is with cigs and things that are generally in cases, since minimum stock is weird since they come in cases,
//         so there needs to be a better way to calculate this, possibly in the business rules,
//         by saying that if is this specific category, then return the item type (case, packs, etc), and how many minimum are in
//         those packs.
//         that way proper calculations can be done according to the product
//         you are CLOSE,
//         just need to fix this...

//         ALSO

//         use the categories now to ensure that Cigs stuff is calculated with the category, not with a hardcoded name
//         for the product.
//         make sure all of them use this, to ensure better consistency.
//         double check the daily sales, they dont line up

//         */

//         // -----------------------------------------------------------------------
//         // END OF UPDATED LOGIC
//         // -----------------------------------------------------------------------

//         // Check if the current inventory is below the new minimum stock.
//         const isLowStock = (inventoryItem.quantity || 0) < minimumStock;

//         let suggestedOrderUnits = Math.max(
//           minimumStock - (inventoryItem.quantity || 0),
//           0
//         );
//         if (suggestedOrderUnits > 0 && unitsPerCase > 1) {
//           suggestedOrderUnits =
//             Math.ceil(suggestedOrderUnits / unitsPerCase) * unitsPerCase;
//         }

//         const finalId = inventoryItem.variation_id || inventoryItem.product_id;
//         // Check for 'American Spirit Blue' and log the data
//         if (itemName === "American Spirit Blue") {
//           console.log("Location:", location.name);
//           console.log(
//             "Calculated Data:",
//             finalId,
//             inventoryItem.quantity,
//             sale?.sales,
//             dailySales,
//             minimumStock,
//             unitsPerCase
//           );
//         }

//         const variationData = {
//           id: finalId,
//           variation_id: inventoryItem.variation_id,
//           variation_name: variation?.name,
//           variation_sku: variation?.sku,
//           variation_price: variation?.price,
//           category: productCategory,
//           sales: sale?.sales || 0,
//           salesPerDay: dailySales,
//           inventory: inventoryItem.quantity,
//           minimumStock, // This is now the updated value
//           unitsPerCase,
//           low_stock: isLowStock, // This now uses the updated value
//           suggested_order: suggestedOrderUnits,
//         };

//         productGroups.get(productId).variations.push(variationData);
//       });

//       const products = Array.from(productGroups.values()).map((group) => {
//         const product = group.product;
//         const variations = group.variations;

//         // Category: always normalize directly from DB (ignore variation “guesses”)
//         const productCategory = product?.category
//           ? normalizeCategory(product.category)
//           : "uncategorized";

//         const totalSales = variations.reduce(
//           (sum, v) => sum + (v.sales || 0),
//           0
//         );
//         const totalInventory = variations.reduce(
//           (sum, v) => sum + (v.inventory || 0),
//           0
//         );
//         const totalSuggestedOrder = variations.reduce(
//           (sum, v) => sum + (v.suggested_order || 0),
//           0
//         );
//         const hasLowStock = variations.some((v) => v.low_stock);

//         return {
//           id: product?.id,
//           name: product?.name,
//           sku: product?.sku || null,
//           category: productCategory, // normalized consistently
//           sales: totalSales,
//           salesPerDay: totalSales / WINDOW_DAYS,
//           inventory: totalInventory,
//           low_stock: hasLowStock,
//           suggested_order: totalSuggestedOrder,
//           variations: variations,
//         };
//       });

//       return { id: location.id, name: location.name, products };
//     });

//     console.log(
//       `>>> [/api/low - stock] END in ${(Date.now() - entireProcess) / 1000}s`
//     );
//     // console.log(finalResponse); // optionally comment out if large
//     res.json({ locations: finalResponse });
//   } catch (err) {
//     console.error(">>> [/api/low-stock] Error fetching low-stock items:", err);
//     res.status(500).json({ error: err.message || "Internal server error" });
//   }
// });

// --- Endpoint to fetch all products, with optional filtering ---
app.get("/api/products", async (req, res) => {
  try {
    const { locationId } = req.query; // optional filter by location

    // 1️⃣ Fetch locations
    const { data: locationsData, error: locationsError } = await supabase
      .from("locations")
      .select("id, name");
    if (locationsError) throw locationsError;

    // 2️⃣ Fetch products with inventory
    const { data: productsData, error: productsError } = await supabase
      .from("products")
      .select("id, name, category, inventory:inventory(quantity, location_id)");
    if (productsError) throw productsError;

    // 3️⃣ Build full product list, attach inventory info and location name
    const allProducts = [];
    (productsData || []).forEach((p) => {
      if (p.name === "Regular") return; // skip "Regular"

      const inventoryRows =
        Array.isArray(p.inventory) && p.inventory.length > 0
          ? p.inventory
          : [{ quantity: 0, location_id: null }];

      inventoryRows.forEach((inv) => {
        const locId = inv.location_id || null;
        const locName = locationsData?.find((l) => l.id === locId)?.name;

        // Optional filter by location
        if (locationId && locId !== locationId) return;

        allProducts.push({
          productId: p.id,
          name: p.name,
          category: p.category,
          locationId: locId,
          locationName: locName,
          currentStock: inv.quantity || 0,
        });
      });
    });

    res.json({ locations: locationsData, products: allProducts });
  } catch (err) {
    console.error("Error fetching all products:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server listening on port ${PORT} `);
});
