import React, { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { AlertTriangle } from 'lucide-react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

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
  locationId?: string
  locationName?: string
}

export const InventoryDashboard: React.FC = () => {
  const [lowStockItems, setLowStockItems] = useState<Product[]>([])
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([])
  const [loadingLow, setLoadingLow] = useState(false)
  const [activeLocation, setActiveLocation] = useState<string>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(20) // number of products per page
  const [modalVisible, setModalVisible] = useState(false)
  const [modalAnimate, setModalAnimate] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncType, setSyncType] = useState<'full' | 'products' | 'locations' | 'sales' | 'inventory'>('full')
  const [syncMessage, setSyncMessage] = useState<string>('')

  const openModal = () => {
    setModalVisible(true)
    setTimeout(() => setModalAnimate(true), 10)
  }

  const closeModal = () => {
    setModalAnimate(false)
    setTimeout(() => {
      setModalVisible(false)
      setSyncMessage('') // clear message when closing
    }, 300)
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
      setSyncing(false)
      setLoadingLow(false)
    }
  }

  useEffect(() => {
    fetchLowStock()
  }, [])

  const fmtAvg = (v?: number | null) => (v === null || v === undefined ? '—' : Number(v).toFixed(2))

  const handleSync = async () => {
    setSyncing(true)
    setSyncMessage('')
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: syncType })
      })
      const data = await res.json()
      if (res.ok) {
        setSyncMessage(`Sync completed: ${data.message}`)
        fetchLowStock().catch(err => console.error('Error fetching low stock after sync', err))
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

  // Filter & sort
  const filtered = activeLocation === 'all'
    ? lowStockItems
    : lowStockItems.filter(p => p.locationId === activeLocation)
  const sorted = [...filtered].sort((a, b) => (b.salesPerDay ?? 0) - (a.salesPerDay ?? 0))

  // Pagination logic
  const totalPages = Math.ceil(sorted.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const currentItems = sorted.slice(startIndex, startIndex + itemsPerPage)

  // Pagination handler
  const goToPage = (page: number) => {
    setCurrentPage(page)
    window.scrollTo({ top: 0, behavior: 'smooth' })
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

      <Tabs value={activeLocation} onValueChange={setActiveLocation}>
        <TabsList>
          <TabsTrigger key="all" value="all">All</TabsTrigger>
          {locations
            .filter(l => ['MAIN ST MARKET', 'Surf Liquor', 'Wolf Liquor'].includes(l.name))
            .map(l => <TabsTrigger key={l.id} value={l.id}>{l.name}</TabsTrigger>)}
        </TabsList>

        <TabsContent value={activeLocation}>
          {loadingLow ? (
            <p>Loading...</p>
          ) : (
            <>
              {totalPages > 1 && (
                <>
                  {/* Option 2: Arrow icons (lucide) */}
                  <div className="flex justify-center items-center gap-4 my-2 text-sm text-muted-foreground">
                    <button
                      className="p-1 rounded-full hover:bg-gray-100 disabled:opacity-50"
                      disabled={currentPage === 1}
                      onClick={() => goToPage(currentPage - 1)}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span>Page {currentPage} of {totalPages}</span>
                    <button
                      className="p-1 rounded-full hover:bg-gray-100 disabled:opacity-50"
                      disabled={currentPage === totalPages}
                      onClick={() => goToPage(currentPage + 1)}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </>
              )}
              {currentItems.length === 0 ? <p>No low stock items.</p> : (
                <ul className="space-y-2">
                  {currentItems.map(item => {
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

              {/* Pagination controls */}
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

      {modalVisible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Dimmed background */}
          <div
            className={`fixed inset-0 bg-black transition-opacity duration-300 ${modalAnimate ? 'opacity-50' : 'opacity-0'}`}
            onClick={() => !syncing && closeModal()}
          />

          {/* Modal card */}
          <Card
            className={`relative z-10 w-96 p-6 space-y-4 bg-white rounded-lg shadow-lg transform transition-all duration-300
        ${modalAnimate ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
          >
            {/* X button */}
            <button
              onClick={closeModal}
              disabled={syncing}
              className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center text-gray-700 hover:text-gray-900 text-xl font-bold rounded-full bg-gray-200 hover:bg-gray-300 shadow-md focus:outline-none"

            >
              ×
            </button>
            <CardTitle>Sync Data from Square</CardTitle>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                This will pull the latest data from Square into the database and update the dashboard with the most recent information.
              </p>

              {/* Modern button-style selection */}
              <div className="flex flex-wrap gap-2 mt-4">
                {['full', 'products', 'locations', 'sales', 'inventory'].map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSyncType(option as any)}
                    disabled={syncing}
                    className={`px-4 py-2 rounded-lg font-medium transition-all duration-200
                ${syncType === option ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'}`}
                  >
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </button>
                ))}
              </div>

              {syncMessage && <p className="mt-4 text-sm">{syncMessage}</p>}

              {/* Action buttons */}
              <div className="flex justify-end gap-2 mt-6">
                <Button onClick={handleSync} disabled={syncing}>
                  {syncing ? 'Syncing...' : 'Confirm Sync'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

export default InventoryDashboard
