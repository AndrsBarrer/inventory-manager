import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SQUARE_ACCESS_TOKEN = Deno.env.get('SQUARE_ACCESS_TOKEN');
const SQUARE_BASE_URL = 'https://connect.squareup.com/v2';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Request method:', req.method);
    console.log('Request URL:', req.url);
    
    // Get the request body
    const requestBody = await req.json();
    console.log('Request body:', requestBody);
    
    const { action, locationId } = requestBody;
    console.log('Action:', action);
    console.log('Location ID:', locationId);

    if (!SQUARE_ACCESS_TOKEN) {
      console.error('Square access token not configured');
      throw new Error('Square access token not configured');
    }

    console.log('Square token exists:', !!SQUARE_ACCESS_TOKEN);

    const headers = {
      'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': '2023-10-18'
    };

    switch (action) {
      case 'locations':
        console.log('Making Square API call for locations');
        const locationsResponse = await fetch(`${SQUARE_BASE_URL}/locations`, { 
          headers,
          method: 'GET'
        });
        
        console.log('Square API response status:', locationsResponse.status);
        
        if (!locationsResponse.ok) {
          const errorText = await locationsResponse.text();
          console.error('Square API error:', errorText);
          throw new Error(`Square API error: ${locationsResponse.status} - ${errorText}`);
        }
        
        const locationsData = await locationsResponse.json();
        console.log('Square locations data:', locationsData);
        
        const locations = locationsData.locations?.map((loc: any) => ({
          id: loc.id,
          name: loc.name,
          address: loc.address ? `${loc.address.address_line_1}, ${loc.address.locality}` : 'No address',
          status: loc.status === 'ACTIVE' ? 'active' : 'inactive',
          squareLocationId: loc.id
        })) || [];

        console.log('Processed locations:', locations);

        return new Response(JSON.stringify({ locations }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case 'inventory':
        if (!locationId) {
          throw new Error('Location ID required for inventory sync');
        }

        const inventoryResponse = await fetch(`${SQUARE_BASE_URL}/inventory/counts/batch-retrieve`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            location_ids: [locationId],
            states: ['IN_STOCK']
          })
        });
        
        const inventoryData = await inventoryResponse.json();
        console.log('Square inventory response counts:', inventoryData.counts?.length);

        // Get ALL catalog objects to build comprehensive mapping
        const catalogResponse = await fetch(`${SQUARE_BASE_URL}/catalog/list`, { headers });
        const catalogData = await catalogResponse.json();
        console.log('Catalog response objects count:', catalogData.objects?.length);
        
        // Enhanced debugging: show full structure of first few catalog objects
        if (catalogData.objects?.length > 0) {
          console.log('Full catalog object structure sample:', JSON.stringify(catalogData.objects.slice(0, 3), null, 2));
        }
        
        const itemMap = new Map();
        const variationToItemMap = new Map();
        
        if (catalogData.objects) {
          // Map all catalog objects (both items and variations) directly
          catalogData.objects.forEach((obj: any, index: number) => {
            let itemName = null;
            let categoryInfo = null;
            
            if (obj.type === 'ITEM' && obj.item_data) {
              // Extract item name
              itemName = obj.item_data.name;
              
              // Extract category information
              if (obj.item_data.category_id) {
                categoryInfo = obj.item_data.category_id;
              }
              
              if (itemName) {
                itemMap.set(obj.id, { name: itemName, category: categoryInfo });
                if (index < 10) {
                  console.log(`Mapped ITEM ${obj.id} to "${itemName}" (category: ${categoryInfo})`);
                }
              }
            }
            
            if (obj.type === 'ITEM_VARIATION' && obj.item_variation_data) {
              // For variations, first check if we have the parent item
              const itemId = obj.item_variation_data.item_id;
              const parentItem = itemMap.get(itemId);
              
              if (parentItem) {
                let finalName = parentItem.name;
                const variationName = obj.item_variation_data.name;
                
                // Only append variation name if it's meaningful
                if (variationName && variationName !== 'Regular' && variationName !== '' && variationName !== parentItem.name && variationName.length < 50) {
                  finalName = `${parentItem.name} - ${variationName}`;
                }
                
                variationToItemMap.set(obj.id, { name: finalName, category: parentItem.category });
                if (index < 10) {
                  console.log(`Mapped VARIATION ${obj.id} to "${finalName}" (category: ${parentItem.category})`);
                }
              } else {
                // If no parent item found, try to extract name directly from variation
                const variationName = obj.item_variation_data.name;
                if (variationName && variationName !== 'Regular' && variationName !== '') {
                  variationToItemMap.set(obj.id, { name: variationName, category: null });
                  if (index < 10) {
                    console.log(`Mapped VARIATION ${obj.id} to "${variationName}" (no parent item found)`);
                  }
                }
              }
            }
          });
        }
        
        console.log('Item map size:', itemMap.size);
        console.log('Variation map size:', variationToItemMap.size);

        // Helper function to guess category from item name
        const guessCategory = (name: string): 'beer' | 'wine' | 'cigarettes' => {
          const lowerName = name.toLowerCase();
          if (lowerName.includes('wine') || lowerName.includes('chardonnay') || lowerName.includes('cabernet') || 
              lowerName.includes('merlot') || lowerName.includes('pinot') || lowerName.includes('sauvignon')) {
            return 'wine';
          }
          if (lowerName.includes('marlboro') || lowerName.includes('newport') || lowerName.includes('camel') ||
              lowerName.includes('cigarette') || lowerName.includes('king')) {
            return 'cigarettes';
          }
          return 'beer'; // Default to beer for beverages
        };

        // Debug: Show a few inventory count objects
        if (inventoryData.counts?.length > 0) {
          console.log('Sample inventory counts:', JSON.stringify(inventoryData.counts.slice(0, 3), null, 2));
        }

        const inventory = inventoryData.counts?.map((count: any, index: number) => {
          // Try variation mapping first, then item mapping
          let itemInfo = variationToItemMap.get(count.catalog_object_id) || 
                        itemMap.get(count.catalog_object_id);
          
          const stockCount = parseInt(count.quantity) || 0;
          
          if (index < 10) {
            console.log(`Processing count ${index}: ${count.catalog_object_id} -> "${itemInfo?.name || 'NOT FOUND'}" (stock: ${stockCount})`);
          }
          
          // If no mapping found, use fallback format
          if (!itemInfo) {
            itemInfo = { 
              name: `Item-${count.catalog_object_id}`, 
              category: null 
            };
            if (index < 5) {
              console.log(`NO MAPPING FOUND for ${count.catalog_object_id}, using fallback: ${itemInfo.name}`);
            }
          }
          
          // Use the mapped category if available, otherwise guess from name
          const finalCategory = itemInfo.category ? 
            guessCategory(itemInfo.name) : // Still guess from name since category_id isn't human readable
            guessCategory(itemInfo.name);
          
          return {
            itemName: itemInfo.name,
            currentStock: stockCount,
            category: finalCategory
          };
        }).filter(item => item !== null) || [];

        console.log(`Final inventory array length: ${inventory.length}`);
        
        // Log the first 10 actual inventory items being returned
        console.log('FIRST 10 INVENTORY ITEMS BEING RETURNED:', JSON.stringify(inventory.slice(0, 10), null, 2));
        
        // Count how many have real names vs fallback names
        const realNames = inventory.filter(item => !item.itemName.startsWith('Item-')).length;
        const fallbackNames = inventory.filter(item => item.itemName.startsWith('Item-')).length;
        console.log(`Real names: ${realNames}, Fallback names: ${fallbackNames}`);

        return new Response(JSON.stringify({ inventory }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      case 'sales':
        if (!locationId) {
          throw new Error('Location ID required for sales sync');
        }

        // Get sales data from the last 30 days
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);

        const salesResponse = await fetch(`${SQUARE_BASE_URL}/orders/search`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            location_ids: [locationId],
            query: {
              filter: {
                date_time_filter: {
                  created_at: {
                    start_at: startDate.toISOString(),
                    end_at: endDate.toISOString()
                  }
                },
                state_filter: {
                  states: ['COMPLETED']
                }
              }
            }
          })
        });

        const salesData = await salesResponse.json();
        console.log('Square sales response:', salesData);

        // Get catalog items to map item names for sales - reuse the same catalog data
        const salesCatalogResponse = await fetch(`${SQUARE_BASE_URL}/catalog/list`, { headers });
        const salesCatalogData = await salesCatalogResponse.json();
        
        const salesItemMap = new Map();
        const salesVariationMap = new Map();
        
        if (salesCatalogData.objects) {
          // Map items
          salesCatalogData.objects.forEach((obj: any) => {
            if (obj.type === 'ITEM' && obj.item_data?.name) {
              salesItemMap.set(obj.id, obj.item_data.name);
            }
          });
          
          // Map variations to items
          salesCatalogData.objects.forEach((obj: any) => {
            if (obj.type === 'ITEM_VARIATION' && obj.item_variation_data) {
              const itemId = obj.item_variation_data.item_id;
              const itemName = salesItemMap.get(itemId);
              if (itemName) {
                const variationName = obj.item_variation_data.name ? 
                  `${itemName} ${obj.item_variation_data.name}`.trim() : itemName;
                salesVariationMap.set(obj.id, variationName);
              }
            }
          });
        }

        const sales: any[] = [];
        
        salesData.orders?.forEach((order: any) => {
          order.line_items?.forEach((lineItem: any) => {
            if (lineItem.catalog_object_id) {
              const itemName = salesVariationMap.get(lineItem.catalog_object_id) || 
                              salesItemMap.get(lineItem.catalog_object_id) || 
                              lineItem.name || 
                              'Unknown Item';
              sales.push({
                datetime: order.created_at,
                itemName,
                quantitySold: parseInt(lineItem.quantity) || 1
              });
            }
          });
        });

        return new Response(JSON.stringify({ sales }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      default:
        throw new Error('Invalid action parameter');
    }
  } catch (error) {
    console.error('Square sync error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});