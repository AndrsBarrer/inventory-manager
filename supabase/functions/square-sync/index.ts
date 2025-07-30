import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SQUARE_ACCESS_TOKEN = Deno.env.get('SQUARE_ACCESS_TOKEN');
const SQUARE_BASE_URL = SQUARE_ACCESS_TOKEN?.startsWith('EAAAL') 
  ? 'https://connect.squareupsandbox.com/v2' 
  : 'https://connect.squareup.com/v2';

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
        console.log('Square inventory response:', inventoryData);

        // Get catalog items to map item names
        const catalogResponse = await fetch(`${SQUARE_BASE_URL}/catalog/list?types=ITEM`, { headers });
        const catalogData = await catalogResponse.json();
        
        const itemMap = new Map();
        catalogData.objects?.forEach((item: any) => {
          if (item.type === 'ITEM') {
            itemMap.set(item.id, item.item_data?.name || 'Unknown Item');
          }
        });

        const inventory = inventoryData.counts?.map((count: any) => {
          const itemName = itemMap.get(count.catalog_object_id) || 'Unknown Item';
          return {
            itemName,
            currentStock: parseInt(count.quantity) || 0,
            category: 'beer' as const // Default category, can be enhanced later
          };
        }) || [];

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

        const sales: any[] = [];
        
        salesData.orders?.forEach((order: any) => {
          order.line_items?.forEach((lineItem: any) => {
            if (lineItem.catalog_object_id) {
              const itemName = itemMap.get(lineItem.catalog_object_id) || 'Unknown Item';
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