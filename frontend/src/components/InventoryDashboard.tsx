import React, { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { AlertTriangle, RefreshCw } from 'lucide-react'

export interface Product {
  id: string
  name: string | null
  sku?: string | null
  category?: string | null
  sales: number
  salesPerDay: number
  inventory: number
  low_stock: boolean
  suggested_order: number
  minimumStock?: number
  unitsPerCase?: number
}

export const InventoryDashboard: React.FC = () => {
  const [lowStockItems, setLowStockItems] = useState<Product[]>([])
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([])
  const [loadingLow, setLoadingLow] = useState(false)
  const [activeLocation, setActiveLocation] = useState<string>('all')
  const [syncing, setSyncing] = useState(false)

  const manualSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/sync`, { method: 'POST' })
      const data = await res.json()
      console.log('Manual sync result:', data)
      await fetchLowStock()
    } catch (err) {
      console.error('Error during manual sync:', err)
    } finally {
      setSyncing(false)
    }
  }

  const fetchLowStock = async () => {
    setLoadingLow(true)
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/low-stock`)
      const data = await res.json()

      const apiLocations = data.locations || []

      const allLowStockProducts = apiLocations.flatMap((loc: any) =>
        (loc.products || []).map((prod: any) => ({
          ...prod,
          locationId: loc.id,
          locationName: loc.name
        }))
      )
        .filter((p: any) => p.low_stock)
        .filter((p: any) =>
          p.name &&
          !['regular', 'unknown variation'].includes(p.name.trim().toLowerCase())
        )

      setLowStockItems(allLowStockProducts)
      setLocations(apiLocations.map((l: any) => ({ id: l.id, name: l.name })))
    } catch (err) {
      console.error('Error fetching low-stock items:', err)
    } finally {
      setLoadingLow(false)
    }
  }

  useEffect(() => {
    fetchLowStock()
  }, [])

  const fmtAvg = (v?: number | null) => (v === null || v === undefined ? '—' : Number(v).toFixed(2))

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex justify-between items-center">
          <CardTitle>Inventory Dashboard</CardTitle>
          <div className="flex gap-2">
            <Button onClick={fetchLowStock}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            <Button variant="secondary" onClick={manualSync} disabled={syncing}>
              {syncing ? 'Syncing...' : 'Manual Sync'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Low-stock items are based on 2-week average sales and configured reorder rules.
          </p>
        </CardContent>
      </Card>

      <Tabs value={activeLocation} onValueChange={setActiveLocation}>
        <TabsList>
          <TabsTrigger key="all" value="all">All</TabsTrigger>
          {locations
            .filter(l => ['MAIN ST MARKET', 'Surf Liquor', 'Wolf Liquor'].includes(l.name))
            .map(l => <TabsTrigger key={l.id} value={l.id}>{l.name}</TabsTrigger>)}
        </TabsList>

        <TabsContent value={activeLocation}>
          {loadingLow ? <p>Loading...</p> : (
            (() => {
              const filtered = activeLocation === 'all'
                ? lowStockItems
                : lowStockItems.filter(p => p.locationId === activeLocation)

              // <-- Your requested sorting line (sorts by salesPerDay, highest first)
              const sorted = [...filtered].sort((a, b) => (b.salesPerDay ?? 0) - (a.salesPerDay ?? 0))

              if (sorted.length === 0) return <p>No low stock items.</p>

              return (
                <ul className="space-y-2">
                  {sorted.map(item => {
                    const suggestedUnits = item.suggested_order ?? 0
                    const unitsPerCase = item.unitsPerCase ?? undefined
                    const casesToOrder = unitsPerCase ? Math.ceil(suggestedUnits / unitsPerCase) : null

                    return (
                      <li key={`${item.locationId}::${item.id}::${item.sku}`} className="flex justify-between items-center border p-2 rounded">
                        <div>
                          <p className="font-semibold">{item.name}</p>
                          {item.locationName && <p className="text-xs text-muted-foreground">Location: {item.locationName}</p>}
                          <p className="text-xs text-muted-foreground">Category: {item.category ?? '—'}</p>
                          <p className="text-xs text-muted-foreground">SKU: {item.sku ?? '—'}</p>
                          <p className="text-xs text-muted-foreground">Avg daily sales (14d): {fmtAvg(item.salesPerDay)}</p>
                          {item.unitsPerCase !== undefined && <p className="text-xs text-muted-foreground">Units per case: {item.unitsPerCase}</p>}
                          {item.minimumStock !== undefined && <p className="text-xs text-muted-foreground">Minimum stock: {item.minimumStock}</p>}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {item.low_stock && <AlertTriangle className="text-warning h-5 w-5" />}
                          <div className={`font-bold ${item.low_stock ? 'text-warning' : 'text-foreground'}`}>
                            Current Stock: {item.inventory}
                          </div>

                          <div className="text-sm">
                            Suggested order: {suggestedUnits} units
                            {unitsPerCase
                              ? ` (${casesToOrder} case${casesToOrder === 1 ? '' : 's'})`
                              : ''}
                          </div>

                          {unitsPerCase
                            ? <div className="text-xs text-muted-foreground">Order in cases of {unitsPerCase}</div>
                            : <div className="text-xs text-muted-foreground">Order in units (case size unknown)</div>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )
            })()
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default InventoryDashboard
