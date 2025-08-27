import React, {useEffect, useState} from 'react'
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Tabs, TabsList, TabsTrigger, TabsContent} from '@/components/ui/tabs'
import {AlertTriangle} from 'lucide-react'
import {ChevronLeft, ChevronRight} from 'lucide-react'

export interface Product {
  id: string
  name: string | null
  sku?: string | null
  category?: string | null
  sales: number
  salesPerDay: number
  inventory?: number | null
  low_stock?: boolean
  suggested_order?: number
  minimumStock?: number
  unitsPerCase?: number
  locationId?: string
  locationName?: string
}

export const InventoryDashboard: React.FC = () => {
  const [lowStockItems, setLowStockItems] = useState<Product[]>([])
  const [locations, setLocations] = useState<{id: string; name: string}[]>([])
  const [loadingLow, setLoadingLow] = useState(false)
  const [activeLocation, setActiveLocation] = useState<string>('all')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(20)
  const [modalVisible, setModalVisible] = useState(false)
  const [modalAnimate, setModalAnimate] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncType, setSyncType] = useState<'full' | 'products' | 'locations' | 'sales' | 'inventory'>('full')
  const [syncMessage, setSyncMessage] = useState<string>('')

  // reset page and category when location or items change
  useEffect(() => {
    setCurrentPage(1)
    setActiveCategory('all')
  }, [activeLocation, lowStockItems])

  // also reset page when category changes
  useEffect(() => {
    setCurrentPage(1)
  }, [activeCategory])

  const openModal = () => {
    setModalVisible(true)
    setTimeout(() => setModalAnimate(true), 10)
  }

  const closeModal = () => {
    setModalAnimate(false)
    setTimeout(() => {
      setModalVisible(false)
      setSyncMessage('')
    }, 300)
  }

  const scratcherNames = [
    "7's",
    "Loteria",
    "Lotteria",
    "Joker's Wild Poker",
    "15X",
    "100X",
    "Sunny Money",
    "California Black Premium"
  ].map(n => n.toLowerCase())

  const fetchLowStock = async () => {
    setLoadingLow(true)
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/low-stock`)
      const data = await res.json()
      const apiLocations = data.locations || []

      // flatten and normalize product shape
      const allLowStockProducts = apiLocations.flatMap((loc: any) =>
        (loc.products || []).map((prod: any) => {
          const id = prod.id || prod.product_id || prod.productId || null
          return {
            ...prod,
            id,
            locationId: loc.id,
            locationName: loc.name
          }
        })
      )
        .filter((p: any) => {
          const salesPerDay = Number(p.salesPerDay || 0)
          const name = (p.name || '').toString()
          const isScratcher = scratcherNames.some(s => name.toLowerCase().includes(s))
          return Boolean(p.low_stock) && salesPerDay > 0 && !isScratcher && !!p.id
        })

      setLowStockItems(allLowStockProducts)
      setLocations(apiLocations.map((l: any) => ({id: l.id, name: l.name})))
    } catch (err) {
      console.error('Error fetching low-stock items:', err)
    } finally {
      setSyncing(false)
      setLoadingLow(false)
    }
  }

  useEffect(() => {fetchLowStock()}, [])

  const fmtAvg = (v?: number | null) => (v === null || v === undefined ? '—' : Number(v).toFixed(2))

  const handleSync = async () => {
    setSyncing(true)
    setSyncMessage('')
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/sync`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({type: syncType})
      })
      const data = await res.json()
      if (res.ok) {
        setSyncMessage(`Sync completed: ${data.message}`)
        await fetchLowStock()
      } else {
        setSyncMessage(`Sync failed: ${data.message}`)
      }
    } catch (err) {
      console.error('Error during sync:', err)
      setSyncMessage(`Sync error: ${err}`)
    } finally {
      setSyncing(false)
    }
  }

  // -----------------------------------------------------------------------
  // Derive data for current location -> categories -> items
  // -----------------------------------------------------------------------
  const locationFiltered = activeLocation === 'all'
    ? lowStockItems
    : lowStockItems.filter(p => p.locationId === activeLocation)

  // categories for current location (normalize null/undefined -> "Uncategorized")
  const categoriesSet = new Set<string>()
  locationFiltered.forEach(p => categoriesSet.add((p.category || 'Uncategorized') as string))
  const categories = ['all', ...Array.from(categoriesSet).sort()]

  // clamp activeCategory if it no longer exists (e.g., after a sync)
  useEffect(() => {
    if (activeCategory !== 'all' && !categories.includes(activeCategory)) {
      setActiveCategory('all')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.join('|')]) // run when categories change

  const categoryFiltered = activeCategory === 'all'
    ? locationFiltered
    : locationFiltered.filter(p => ((p.category || 'Uncategorized') === activeCategory))

  const sorted = [...categoryFiltered].sort((a, b) =>
    (a.name || '').toString().trim().localeCompare((b.name || '').toString().trim(), undefined, {numeric: true, sensitivity: 'base'})
  )

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sorted.length / itemsPerPage))
  const startIndex = (currentPage - 1) * itemsPerPage
  const currentItems = sorted.slice(startIndex, startIndex + itemsPerPage)

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(totalPages, page)))
    window.scrollTo({top: 0, behavior: 'smooth'})
  }

  return (
    <div className="space-y-6 relative">
      <Card>
        <CardHeader className="flex justify-between items-center">
          <CardTitle>Inventory Dashboard</CardTitle>
          <Button variant="secondary" onClick={openModal}>Sync Data</Button>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Low-stock items are based on 2-week average sales and configured reorder rules.
          </p>
        </CardContent>
      </Card>

      {/* Outer tabs: locations */}
      <Tabs value={activeLocation} onValueChange={(v) => {setActiveLocation(v); setCurrentPage(1); setActiveCategory('all')}}>
        <TabsList>
          <TabsTrigger key="all" value="all">All</TabsTrigger>
          {locations.filter(l => ['MAIN ST MARKET', 'Surf Liquor', 'Wolf Liquor'].includes(l.name)).map(l => (
            <TabsTrigger key={l.id} value={l.id}>{l.name}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={activeLocation}>
          {loadingLow ? (
            <p>Loading...</p>
          ) : (
            <>
              {/* Inner tabs: categories for the selected location */}
              <div className="mb-4">
                <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v)}>
                  <TabsList>
                    {categories.map(cat => (
                      <TabsTrigger key={cat} value={cat}>{cat === 'all' ? 'All Categories' : cat}</TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>

              {totalPages > 1 && (
                <div className="flex justify-center items-center gap-4 my-2 text-sm text-muted-foreground">
                  <button className="p-1 rounded-full hover:bg-gray-100 disabled:opacity-50" disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)}><ChevronLeft size={16} /></button>
                  <span>Page {currentPage} of {totalPages}</span>
                  <button className="p-1 rounded-full hover:bg-gray-100 disabled:opacity-50" disabled={currentPage === totalPages} onClick={() => goToPage(currentPage + 1)}><ChevronRight size={16} /></button>
                </div>
              )}

              {currentItems.length === 0 ? <p>No low stock items.</p> : (
                <ul className="space-y-2">
                  {currentItems.map(item => {
                    const suggestedUnits = item.suggested_order ?? 0
                    const unitsPerCase = item.unitsPerCase ?? undefined
                    const casesToOrder = unitsPerCase ? Math.ceil(suggestedUnits / unitsPerCase) : null
                    const currentStock = item.inventory === null || item.inventory === undefined ? '—' : item.inventory
                    const lowStockFlag = (item.low_stock !== undefined && item.low_stock !== null)
                      ? Boolean(item.low_stock)
                      : ((item.inventory ?? 0) < (item.minimumStock ?? Infinity))

                    return (
                      <li key={`${item.locationId}::${item.id}`} className="flex justify-between items-center border p-2 rounded">
                        <div>
                          <p className="font-semibold">{item.name ?? 'Unnamed product'}</p>
                          {item.locationName && <p className="text-xs text-muted-foreground">Location: {item.locationName}</p>}
                          <p className="text-xs text-muted-foreground">Category: {item.category ?? '—'}</p>
                          <p className="text-xs text-muted-foreground">SKU: {item.sku ?? '—'}</p>
                          <p className="text-xs text-muted-foreground">Avg daily sales (14d): {fmtAvg(item.salesPerDay)}</p>
                          {item.unitsPerCase !== undefined && <p className="text-xs text-muted-foreground">Units per case: {item.unitsPerCase}</p>}
                          {item.minimumStock !== undefined && <p className="text-xs text-muted-foreground">Minimum stock: {item.minimumStock}</p>}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {lowStockFlag && <AlertTriangle className="text-warning h-5 w-5" />}
                          <div className={`font-bold ${lowStockFlag ? 'text-warning' : 'text-foreground'}`}>
                            Current Stock: {currentStock}
                          </div>
                          <div className="text-sm">
                            Suggested order: {suggestedUnits ?? 0} units
                            {unitsPerCase ? ` (${casesToOrder} case${casesToOrder === 1 ? '' : 's'})` : ''}
                          </div>
                          {unitsPerCase ? (
                            <div className="text-xs text-muted-foreground">Order in cases of {unitsPerCase}</div>
                          ) : (
                            <div className="text-xs text-muted-foreground">Order in units (case size unknown)</div>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}

              {totalPages > 1 && (
                <div className="flex justify-center items-center gap-2 mt-4">
                  <Button disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)}>Prev</Button>
                  <span>Page {currentPage} of {totalPages}</span>
                  <Button disabled={currentPage === totalPages} onClick={() => goToPage(currentPage + 1)}>Next</Button>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* modal unchanged (keep your existing modal JSX) */}
      {modalVisible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className={`fixed inset-0 bg-black transition-opacity duration-300 ${modalAnimate ? 'opacity-50' : 'opacity-0'}`}
            onClick={() => !syncing && closeModal()}
          />
          <Card className={`relative z-10 w-96 p-6 space-y-4 bg-white rounded-lg shadow-lg transform transition-all duration-300 ${modalAnimate ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
            <button onClick={closeModal} disabled={syncing} className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center text-gray-700 hover:text-gray-900 text-xl font-bold rounded-full bg-gray-200 hover:bg-gray-300 shadow-md focus:outline-none">×</button>
            <CardTitle>Sync Data from Square</CardTitle>
            <CardContent>
              <p className="text-sm text-muted-foreground">This will pull the latest data from Square into the database and update the dashboard with the most recent information.</p>
              <div className="flex flex-wrap gap-2 mt-4">
                {['full', 'products', 'locations', 'sales', 'inventory'].map(option => (
                  <button key={option} type="button" onClick={() => setSyncType(option as any)} disabled={syncing} className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${syncType === option ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'}`}>
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </button>
                ))}
              </div>
              {syncMessage && <p className="mt-4 text-sm">{syncMessage}</p>}
              <div className="flex justify-end gap-2 mt-6">
                <Button onClick={handleSync} disabled={syncing}>{syncing ? 'Syncing...' : 'Confirm Sync'}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

export default InventoryDashboard
