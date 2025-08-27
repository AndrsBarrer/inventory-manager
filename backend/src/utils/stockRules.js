// utils/stockRules.js

const CATEGORY_RULES = [
    {category: 'beer', keywords: ['ipa', 'lager', 'ale', 'stout', 'pilsner', 'beer']},
    {category: 'wine', keywords: ['cabernet', 'pinot', 'merlot', 'zinfandel', 'wine', 'chardonnay', 'sauvignon']},
    {category: 'liquor', keywords: ['vodka', 'whiskey', 'tequila', 'rum', 'gin', 'bourbon', 'scotch', 'brandy']},
    {category: 'seltzer', keywords: ['seltzer', 'white claw', 'truly', 'hard seltzer']},
    {category: 'ready-to-drink', keywords: ['twisted tea', 'high noon', 'cutwater', 'cocktail', 'on the rocks']},
    {category: 'tobacco', keywords: ['cigar', 'backwood', 'grabba', 'tobacco', 'leaf']},
    {category: 'nicotine', keywords: ['juul', 'zyn', 'lucy', 'velo', 'on!', 'oeo', 'pouch']},
];

function normalize(s) {
    return (s || '').trim().toLowerCase();
}

function getCategoryFromName(name) {
    if (!name) return null;
    const nameLower = normalize(name);
    for (const rule of CATEGORY_RULES) {
        if (rule.keywords.some(keyword => nameLower.includes(keyword))) {
            return rule.category;
        }
    }
    return null;
}

function getMinimumStockByCategory(category, avgDailySales = 0) {
    switch (category) {
        case 'beer':
        case 'seltzer':
            return Math.ceil(avgDailySales * 7 + 2); // 1-week + safety
        case 'liquor':
            return 2;
        case 'ready-to-drink':
            return Math.ceil(avgDailySales * 5 + 2);
        case 'tobacco':
            return 10;
        case 'nicotine':
            return 20;
        default:
            return 2; // fallback
    }
}

/**
 * Business rules: units per case
 */
function getUnitsPerCaseFromName(itemName = '', category = '') {
    const name = normalize(itemName);

    const cigaretteBrands = [
        'marlboro', 'newport', 'camel', 'pall mall', 'kool', 'parliament',
        'american spirit', 'lucky strike', 'winston', 'salem', 'doral',
        'basic', 'virginia slims', 'misty', 'eagle 20s', 'l&m', 'merit', 'montego'
    ];
    if (cigaretteBrands.some(b => name.includes(b))) return 10; // cartons = 10 packs

    const nicotinePouchBrands = ['lucy', 'zyn', 'oeo', 'on!'];
    if (nicotinePouchBrands.some(b => name.includes(b))) return 5;

    if (name.includes('backwood') && name.includes('5 pk')) return 8;
    if (name.includes('grabba leaf') && name.includes('small')) return 25;

    // Specific overrides
    if (name.includes('jose cuervo') && name.includes('200')) return 48;
    if (name.includes('juul menthol')) return 8;
    if (name.includes('juul virginia tobacco')) return 8;
    if (name.includes('juul device')) return 8;
    if (name.includes('dunhill')) return 10;
    if (name.includes('bugler pouches')) return 6;
    if (name.includes('norwegian shag')) return 5;
    if (name.includes('flum') || name.includes('flume')) return 10;
    if (name.includes('grizzly')) return 5;
    if (name.includes('velo')) return 5;
    if (name.includes('capri')) return 10;

    // Beer / seltzer packs
    if (name.includes('12 pack') || name.includes('12pk') || name.includes('12 pk')) return 12;
    if (name.includes('8 pack') || name.includes('8pk')) return 8;
    if (name.includes('6 pack') || name.includes('6pk')) return 6;
    if (name.includes('4 pack') || name.includes('4pk')) return 4;
    if (name.includes('18 pack') || name.includes('18pk')) return 18;
    if (name.includes('24 pack') || name.includes('24pk')) return 24;

    // Volume-based bottles
    if (name.includes('1.75') || name.includes('1750')) return 6;
    if (name.includes('750')) return 12;
    if (name.includes('375')) return 24;
    if (name.includes('200')) return 24;
    if (name.includes('50ml') || name.includes('50 ml')) return 120;

    return 12; // fallback default
}

/**
 * Minimum stock rules
 */
function getMinimumStockFromName(itemName = '', avgDailySales = 0) {
    const name = normalize(itemName);

    const stockRules = {
        'marlboro lights': {minimumStock: 100, daysOfSupply: 14},
        'jameson 200ml': {minimumStock: 15, daysOfSupply: 7},
        'jameson 375ml': {minimumStock: 15, daysOfSupply: 7},
        "chateau d'esclans 'whispering angel' rose": {minimumStock: 6, daysOfSupply: 7},
        'chateau souverain wine cabernet sauvignon': {minimumStock: 5, daysOfSupply: 7},
        'underwood pinot noir 750ml': {minimumStock: 10, daysOfSupply: 7},
        'hess select chardonnay wine': {minimumStock: 7, daysOfSupply: 7},
        'smirnoff 200ml': {minimumStock: 16, daysOfSupply: 7},
        'justin sauvignon blanc white wine': {minimumStock: 10, daysOfSupply: 7},
        'apothic red blend': {minimumStock: 5, daysOfSupply: 7},
        'pacifico 12 pk bottles': {minimumStock: 2, daysOfSupply: 7}
    };

    if (stockRules[name]) return stockRules[name];

    const isChardonnay = name.includes('chardonnay');
    const isSauvignon = name.includes('sauvignon blanc');
    if ((isChardonnay || isSauvignon) && !stockRules[name]) {
        return {minimumStock: 7, daysOfSupply: 7};
    }

    const weeklyAverage = avgDailySales * 7;
    const isHighSelling = weeklyAverage >= 4;
    return {
        minimumStock: isHighSelling ? 4 : 0,
        daysOfSupply: 7
    };
}

export {
    CATEGORY_RULES,
    normalize,
    getCategoryFromName,
    getMinimumStockByCategory,
    getUnitsPerCaseFromName,
    getMinimumStockFromName
};
