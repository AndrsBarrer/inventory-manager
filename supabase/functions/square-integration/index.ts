import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SquareLocation {
  id: string
  name: string
  address?: {
    address_line_1?: string
    locality?: string
    administrative_district_level_1?: string
  }
  status: string
}

interface SquareInventoryItem {
  catalog_object_id: string
  quantity: string
  location_id: string
}

interface SquareCatalogItem {
  id: string
  item_data?: {
    name: string
    category_id?: string
    variations?: Array<{
      id: string
      item_variation_data?: {
        name?: string
        price_money?: {
          amount: number
          currency: string
        }
      }
    }>
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { action, locationId } = await req.json()
    const squareAccessToken = Deno.env.get('SQUARE_ACCESS_TOKEN')
    
    if (!squareAccessToken) {
      throw new Error('Square Access Token not configured')
    }

    // Determine if this is sandbox or production based on token
    const isSandbox = squareAccessToken.startsWith('EAAA')
    const squareApiBase = isSandbox ? 'https://connect.squareupsandbox.com/v2' : 'https://connect.squareup.com/v2'
    const headers = {
      'Authorization': `Bearer ${squareAccessToken}`,
      'Content-Type': 'application/json',
    }

    console.log(`Square API action: ${action}`)

    switch (action) {
      case 'get-locations': {
        const response = await fetch(`${squareApiBase}/locations`, { headers })
        
        if (!response.ok) {
          throw new Error(`Square API error: ${response.status} ${response.statusText}`)
        }
        
        const data = await response.json()
        console.log('Fetched locations:', data.locations?.length || 0)
        
        const locations = data.locations?.map((loc: SquareLocation) => ({
          id: loc.id,
          name: loc.name,
          address: loc.address ? 
            `${loc.address.address_line_1 || ''}, ${loc.address.locality || ''}, ${loc.address.administrative_district_level_1 || ''}`.trim().replace(/^,\s*|,\s*$/g, '') : 
            'Address not available',
          status: loc.status === 'ACTIVE' ? 'active' : 'inactive',
          squareLocationId: loc.id,
          lastSync: new Date().toISOString()
        })) || []

        return new Response(
          JSON.stringify({ locations }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      case 'get-inventory': {
        if (!locationId) {
          throw new Error('Location ID required for inventory fetch')
        }

        // First get catalog items
        const catalogResponse = await fetch(`${squareApiBase}/catalog/list?types=ITEM`, { headers })
        
        if (!catalogResponse.ok) {
          throw new Error(`Square Catalog API error: ${catalogResponse.status}`)
        }
        
        const catalogData = await catalogResponse.json()
        console.log('Fetched catalog items:', catalogData.objects?.length || 0)

        // Then get inventory for the location
        const inventoryResponse = await fetch(`${squareApiBase}/inventory/counts/batch-retrieve`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            location_ids: [locationId],
            catalog_object_ids: catalogData.objects?.map((item: SquareCatalogItem) => item.id) || []
          })
        })

        if (!inventoryResponse.ok) {
          throw new Error(`Square Inventory API error: ${inventoryResponse.status}`)
        }

        const inventoryData = await inventoryResponse.json()
        console.log('Fetched inventory counts:', inventoryData.counts?.length || 0)

        // Combine catalog and inventory data
        const products = catalogData.objects?.map((item: SquareCatalogItem) => {
          const inventoryCount = inventoryData.counts?.find((count: SquareInventoryItem) => 
            count.catalog_object_id === item.id && count.location_id === locationId
          )

          const variation = item.item_data?.variations?.[0]
          const price = variation?.item_variation_data?.price_money?.amount || 0

          return {
            id: item.id,
            name: item.item_data?.name || 'Unknown Item',
            category: 'General', // Square categories would need separate API call
            currentStock: parseInt(inventoryCount?.quantity || '0'),
            reorderPoint: 5, // Default reorder point
            lastOrdered: null,
            supplier: 'Square POS',
            cost: price / 100, // Convert cents to dollars
            price: price / 100,
            lastSync: new Date().toISOString()
          }
        }).filter(product => product.name !== 'Unknown Item') || []

        console.log(`Processed ${products.length} products with inventory`)
        
        return new Response(
          JSON.stringify({ products }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      case 'get-sales': {
        if (!locationId) {
          throw new Error('Location ID required for sales fetch')
        }

        // Get orders from the last 30 days
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

        const ordersResponse = await fetch(`${squareApiBase}/orders/search`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            location_ids: [locationId],
            query: {
              filter: {
                date_time_filter: {
                  created_at: {
                    start_at: thirtyDaysAgo.toISOString()
                  }
                },
                state_filter: {
                  states: ['COMPLETED']
                }
              }
            }
          })
        })

        if (!ordersResponse.ok) {
          throw new Error(`Square Orders API error: ${ordersResponse.status}`)
        }

        const ordersData = await ordersResponse.json()
        console.log('Fetched orders:', ordersData.orders?.length || 0)

        const salesRecords = ordersData.orders?.flatMap((order: any) => 
          order.line_items?.map((lineItem: any) => ({
            productName: lineItem.name || 'Unknown Product',
            quantitySold: parseInt(lineItem.quantity || '1'),
            saleDate: order.created_at,
            revenue: (lineItem.total_money?.amount || 0) / 100,
            location: locationId
          })) || []
        ) || []

        return new Response(
          JSON.stringify({ salesRecords }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      default:
        throw new Error(`Unknown action: ${action}`)
    }

  } catch (error) {
    console.error('Square integration error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})