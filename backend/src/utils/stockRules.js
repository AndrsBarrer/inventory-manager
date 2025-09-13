// // utils/stockRules.js

// const CATEGORY_RULES = [
//   {
//     category: "Beer",
//     keywords: ["ipa", "lager", "ale", "stout", "pilsner", "beer"],
//   },
//   {
//     category: "Wine",
//     keywords: [
//       "cabernet",
//       "pinot",
//       "merlot",
//       "zinfandel",
//       "wine",
//       "chardonnay",
//       "sauvignon",
//     ],
//   },
//   {
//     category: "Liquor",
//     keywords: [
//       "vodka",
//       "whiskey",
//       "tequila",
//       "rum",
//       "gin",
//       "bourbon",
//       "scotch",
//       "brandy",
//     ],
//   },
//   {
//     category: "Seltzer",
//     keywords: ["seltzer", "white claw", "truly", "hard seltzer"],
//   },
//   {
//     category: "Ready-to-drink",
//     keywords: [
//       "twisted tea",
//       "high noon",
//       "cutwater",
//       "cocktail",
//       "on the rocks",
//     ],
//   },
//   {
//     category: "Tobacco",
//     keywords: ["cigar", "backwood", "grabba", "tobacco", "leaf"],
//   },
//   {
//     category: "Nicotine",
//     keywords: ["juul", "zyn", "lucy", "velo", "on!", "oeo", "pouch"],
//   },
// ];

// function normalize(s) {
//   return (s || "").trim().toLowerCase();
// }

// function getCategoryFromName(name) {
//   if (!name) return null;
//   const nameLower = normalize(name);
//   for (const rule of CATEGORY_RULES) {
//     if (rule.keywords.some((keyword) => nameLower.includes(keyword))) {
//       return rule.category;
//     }
//   }
//   return null;
// }

// function getMinimumStockByCategory(category, avgDailySales = 0) {
//   switch (category) {
//     case "beer":
//     case "seltzer":
//       return Math.ceil(avgDailySales * 7 + 2); // 1-week + safety
//     case "liquor":
//       return 2;
//     case "ready-to-drink":
//       return Math.ceil(avgDailySales * 5 + 2);
//     case "tobacco":
//       return 10;
//     case "nicotine":
//       return 20;
//     default:
//       return 2; // fallback
//   }
// }

// /**
//  * Business rules: units per case
//  */
// function getUnitsPerCaseFromName(itemName = "", category = "") {
//   const name = normalize(itemName);

//   const cigaretteBrands = [
//     "marlboro",
//     "newport",
//     "camel",
//     "pall mall",
//     "kool",
//     "parliament",
//     "american spirit",
//     "lucky strike",
//     "winston",
//     "salem",
//     "doral",
//     "basic",
//     "virginia slims",
//     "misty",
//     "eagle 20s",
//     "l&m",
//     "merit",
//     "montego",
//   ];
//   if (cigaretteBrands.some((b) => name.includes(b))) return 10; // cartons = 10 packs

//   const nicotinePouchBrands = ["lucy", "zyn", "oeo", "on!"];
//   if (nicotinePouchBrands.some((b) => name.includes(b))) return 5;

//   if (name.includes("backwood") && name.includes("5 pk")) return 8;
//   if (name.includes("grabba leaf") && name.includes("small")) return 25;

//   // Specific overrides
//   if (name.includes("jose cuervo") && name.includes("200")) return 48;
//   if (name.includes("juul menthol")) return 8;
//   if (name.includes("juul virginia tobacco")) return 8;
//   if (name.includes("juul device")) return 8;
//   if (name.includes("dunhill")) return 10;
//   if (name.includes("bugler pouches")) return 6;
//   if (name.includes("norwegian shag")) return 5;
//   if (name.includes("flum") || name.includes("flume")) return 10;
//   if (name.includes("grizzly")) return 5;
//   if (name.includes("velo")) return 5;
//   if (name.includes("capri")) return 10;

//   // Beer / seltzer packs
//   if (
//     name.includes("12 pack") ||
//     name.includes("12pk") ||
//     name.includes("12 pk")
//   )
//     return 12;
//   if (name.includes("8 pack") || name.includes("8pk")) return 8;
//   if (name.includes("6 pack") || name.includes("6pk")) return 6;
//   if (name.includes("4 pack") || name.includes("4pk")) return 4;
//   if (name.includes("18 pack") || name.includes("18pk")) return 18;
//   if (name.includes("24 pack") || name.includes("24pk")) return 24;

//   // Volume-based bottles
//   if (name.includes("1.75") || name.includes("1750")) return 6;
//   if (name.includes("750")) return 12;
//   if (name.includes("375")) return 24;
//   if (name.includes("200")) return 24;
//   if (name.includes("50ml") || name.includes("50 ml")) return 120;

//   return 12; // fallback default
// }

// /**
//  * Minimum stock rules
//  */
// function getMinimumStockFromName(itemName = "", avgDailySales = 0) {
//   const name = normalize(itemName);

//   const stockRules = {
//     "marlboro lights": { minimumStock: 100, daysOfSupply: 14 },
//     "jameson 200ml": { minimumStock: 15, daysOfSupply: 7 },
//     "jameson 375ml": { minimumStock: 15, daysOfSupply: 7 },
//     "chateau d'esclans 'whispering angel' rose": {
//       minimumStock: 6,
//       daysOfSupply: 7,
//     },
//     "chateau souverain wine cabernet sauvignon": {
//       minimumStock: 5,
//       daysOfSupply: 7,
//     },
//     "underwood pinot noir 750ml": { minimumStock: 10, daysOfSupply: 7 },
//     "hess select chardonnay wine": { minimumStock: 7, daysOfSupply: 7 },
//     "smirnoff 200ml": { minimumStock: 16, daysOfSupply: 7 },
//     "justin sauvignon blanc white wine": { minimumStock: 10, daysOfSupply: 7 },
//     "apothic red blend": { minimumStock: 5, daysOfSupply: 7 },
//     "pacifico 12 pk bottles": { minimumStock: 2, daysOfSupply: 7 },
//   };

//   if (stockRules[name]) return stockRules[name];

//   const isChardonnay = name.includes("chardonnay");
//   const isSauvignon = name.includes("sauvignon blanc");
//   if ((isChardonnay || isSauvignon) && !stockRules[name]) {
//     return { minimumStock: 7, daysOfSupply: 7 };
//   }

//   const weeklyAverage = avgDailySales * 7;
//   const isHighSelling = weeklyAverage >= 4;
//   return {
//     minimumStock: isHighSelling ? 4 : 0,
//     daysOfSupply: 7,
//   };
// }

// export {
//   CATEGORY_RULES,
//   normalize,
//   getCategoryFromName,
//   getMinimumStockByCategory,
//   getUnitsPerCaseFromName,
//   getMinimumStockFromName,
// };

// utils/stockRules.js

const CATEGORY_RULES = [
  {
    category: "Beer",
    keywords: ["ipa", "lager", "ale", "stout", "pilsner", "beer"],
  },
  {
    category: "Wine",
    keywords: [
      "cabernet",
      "pinot",
      "merlot",
      "zinfandel",
      "wine",
      "chardonnay",
      "sauvignon",
    ],
  },
  {
    category: "Liquor",
    keywords: [
      "vodka",
      "whiskey",
      "tequila",
      "rum",
      "gin",
      "bourbon",
      "scotch",
      "brandy",
    ],
  },
  {
    category: "Seltzer",
    keywords: ["seltzer", "white claw", "truly", "hard seltzer"],
  },
  {
    category: "Ready-to-drink",
    keywords: ["twisted tea", "high noon", "cutwater", "cocktail"],
  },
  {
    category: "Tobacco",
    keywords: ["cigar", "backwood", "grabba", "tobacco", "leaf"],
  },
  {
    category: "Nicotine",
    keywords: ["juul", "zyn", "lucy", "velo", "on!", "pouch"],
  },
];

const PRODUCT_RULES = {
  // Specific Product Overrides
  "american spirit blue": {
    unitsPerCase: 10,
    minStockUnits: 15,
    daysOfSupply: 7,
  },
  "marlboro lights": { unitsPerCase: 10, minStockUnits: 100, daysOfSupply: 14 },
  "jameson 200ml": { unitsPerCase: 48, minStockUnits: 15, daysOfSupply: 7 },
  "jameson 375ml": { unitsPerCase: 24, minStockUnits: 15, daysOfSupply: 7 },
  "jose cuervo 200": { unitsPerCase: 48, minStockUnits: 10, daysOfSupply: 7 },
  "juul menthol": { unitsPerCase: 8, minStockUnits: 10, daysOfSupply: 7 },
  "juul virginia tobacco": {
    unitsPerCase: 8,
    minStockUnits: 10,
    daysOfSupply: 7,
  },
  "juul device": { unitsPerCase: 8, minStockUnits: 5, daysOfSupply: 7 },
  "bugler pouches": { unitsPerCase: 6, minStockUnits: 12, daysOfSupply: 7 },

  // Keywords in name (order matters for specificity)
  pack: { unitsPerCase: 6 }, // Generic pack size
  "12 pack": { unitsPerCase: 12 },
  "6 pack": { unitsPerCase: 6 },
  "18 pack": { unitsPerCase: 18 },
  "24 pack": { unitsPerCase: 24 },
  750: { unitsPerCase: 12 }, // Wine/Liquor bottles
  1750: { unitsPerCase: 6 },
};

// --- Helper Functions ---

function normalize(s) {
  return (s || "").trim().toLowerCase();
}

function getCategoryFromName(name) {
  if (!name) return "uncategorized";
  const nameLower = normalize(name);
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => nameLower.includes(keyword))) {
      return normalize(rule.category);
    }
  }
  return "uncategorized";
}

function getInventoryRules({
  normalizedName,
  normalizedCategory,
  avgDailySales,
  leadTimeDays,
}) {
  // 1. Check for specific product name overrides
  if (PRODUCT_RULES[normalizedName]) {
    return {
      ...PRODUCT_RULES[normalizedName],
      isDynamic: false,
    };
  }

  // 2. Check for keyword-based overrides
  for (const keyword in PRODUCT_RULES) {
    if (normalizedName.includes(keyword)) {
      return {
        ...PRODUCT_RULES[keyword],
        isDynamic: false,
      };
    }
  }

  // 3. Fallback to category-based dynamic rules
  switch (normalizedCategory) {
    case "beer":
    case "seltzer":
      const minStockBeer = Math.ceil(avgDailySales * leadTimeDays + 2);
      return {
        unitsPerCase: 12,
        minStockUnits: minStockBeer,
        daysOfSupply: 7,
        isDynamic: true,
      };
    case "liquor":
      const minStockLiquor = Math.ceil(avgDailySales * leadTimeDays + 2);
      return {
        unitsPerCase: 12,
        minStockUnits: minStockLiquor,
        daysOfSupply: 7,
        isDynamic: true,
      };
    case "ready-to-drink":
      const minStockRTD = Math.ceil(avgDailySales * leadTimeDays + 2);
      return {
        unitsPerCase: 12,
        minStockUnits: minStockRTD,
        daysOfSupply: 7,
        isDynamic: true,
      };
    case "tobacco":
    case "nicotine":
      const minStockCigs = Math.max(
        10,
        Math.ceil(avgDailySales * leadTimeDays + 5)
      );
      return {
        unitsPerCase: 10,
        minStockUnits: minStockCigs,
        daysOfSupply: 7,
        isDynamic: true,
      };
    default:
      const minStockDefault = Math.ceil(avgDailySales * leadTimeDays + 2);
      return {
        unitsPerCase: 12,
        minStockUnits: minStockDefault,
        daysOfSupply: 7,
        isDynamic: true,
      };
  }
}

export { normalize, getCategoryFromName, getInventoryRules };
