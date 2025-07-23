import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Package, ShoppingCart, TrendingDown, RefreshCw } from 'lucide-react';
import { ProductList } from './ProductList';
import { ReorderDialog } from './ReorderDialog';
import { LocationSelector, Location } from './LocationSelector';
import { CSVUploader } from './CSVUploader';
import { StockConfiguration, StockRule } from './StockConfiguration';
import { SalesBasedOrderSuggestion, CategoryOrder } from './SalesBasedOrderSuggestion';

export interface Product {
  id: string;
  name: string;
  category: 'wine' | 'beer' | 'spirits' | 'mixers';
  currentStock: number;
  reorderPoint: number;
  maxStock: number;
  unitCost: number;
  supplier: string;
  lastRestocked: string;
  unitsPerCase: number;
}

const mockProducts: Product[] = [
  {
    id: '1',
    name: 'Cabernet Sauvignon 2020',
    category: 'wine',
    currentStock: 5,
    reorderPoint: 15,
    maxStock: 50,
    unitCost: 24.99,
    supplier: 'Southern Wine and Spirits',
    lastRestocked: '2024-01-15',
    unitsPerCase: 12
  },
  {
    id: '2',
    name: 'IPA Craft Beer Case',
    category: 'beer',
    currentStock: 3,
    reorderPoint: 10,
    maxStock: 30,
    unitCost: 45.00,
    supplier: 'Breakthru Beverages',
    lastRestocked: '2024-01-10',
    unitsPerCase: 24
  },
  {
    id: '3',
    name: 'Premium Vodka 750ml',
    category: 'spirits',
    currentStock: 25,
    reorderPoint: 12,
    maxStock: 40,
    unitCost: 35.50,
    supplier: 'Harbor',
    lastRestocked: '2024-01-20',
    unitsPerCase: 6
  },
  {
    id: '4',
    name: 'Tonic Water 6-pack',
    category: 'mixers',
    currentStock: 8,
    reorderPoint: 20,
    maxStock: 60,
    unitCost: 12.99,
    supplier: 'Southern Wine and Spirits',
    lastRestocked: '2024-01-18',
    unitsPerCase: 4
  },
  {
    id: '5',
    name: 'Marlboro Gold Pack',
    category: 'spirits',
    currentStock: 2,
    reorderPoint: 10,
    maxStock: 50,
    unitCost: 85.00,
    supplier: 'Giant Wholesale (Cigarettes)',
    lastRestocked: '2024-01-12',
    unitsPerCase: 10
  },
  {
    id: '6',
    name: 'Crown Royal Whiskey',
    category: 'spirits',
    currentStock: 4,
    reorderPoint: 8,
    maxStock: 24,
    unitCost: 42.00,
    supplier: 'Harbor',
    lastRestocked: '2024-01-14',
    unitsPerCase: 6
  }
];

interface SalesRecord {
  datetime: string;
  itemName: string;
  quantitySold: number;
}

interface InventoryRecord {
  itemName: string;
  currentStock: number;
  category: 'beer' | 'wine' | 'cigarettes';
}

export const InventoryDashboard: React.FC = () => {
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [salesData, setSalesData] = useState<SalesRecord[]>([]);
  const [inventoryData, setInventoryData] = useState<InventoryRecord[]>([]);
  const [stockRules, setStockRules] = useState<StockRule[]>([]);

  const totalItems = inventoryData.length;
  const totalValue = inventoryData.reduce((sum, item) => sum + (item.currentStock * 25), 0); // Placeholder pricing
  const lowStockItems = inventoryData.filter(item => {
    const rule = stockRules.find(r => r.itemName === item.itemName);
    return rule ? item.currentStock <= rule.minimumStock : false;
  });

  const handleLocationSelect = (location: Location) => {
    setSelectedLocation(location);
  };

  const handleSyncSquareData = async () => {
    if (!selectedLocation) return;
    
    setIsLoading(true);
    // TODO: Replace with actual Square API call when Supabase is connected
    setTimeout(() => {
      setIsLoading(false);
    }, 2000);
  };

  const handleSalesDataUpload = (data: SalesRecord[]) => {
    setSalesData(data);
  };

  const handleInventoryDataUpload = (data: InventoryRecord[]) => {
    setInventoryData(data);
  };

  const handleUpdateStockRules = (rules: StockRule[]) => {
    setStockRules(rules);
  };

  const handleGenerateOrders = (categoryOrders: CategoryOrder[]) => {
    // TODO: Implement order generation (could send to email, print, or save to database)
    console.log('Generated orders:', categoryOrders);
    const totalCost = categoryOrders.reduce((sum, order) => sum + order.totalCost, 0);
    alert(`Generated ${categoryOrders.length} category order(s) totaling $${totalCost.toFixed(2)}`);
  };

  const outOfStockItems = inventoryData.filter(item => item.currentStock === 0);

  return (
    <div className="space-y-6">
      {/* Location Selector */}
      <LocationSelector
        locations={[]}
        selectedLocation={selectedLocation}
        onLocationSelect={handleLocationSelect}
      />

      {/* Sync Button */}
      {selectedLocation && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Square POS Integration</h3>
                <p className="text-sm text-muted-foreground">
                  Sync inventory data from {selectedLocation.name}
                </p>
              </div>
              <Button
                onClick={handleSyncSquareData}
                disabled={isLoading || selectedLocation.status !== 'active'}
                className="flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                {isLoading ? 'Syncing...' : 'Sync Now'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* CSV Upload Section */}
      <CSVUploader
        onSalesDataUpload={handleSalesDataUpload}
        onInventoryDataUpload={handleInventoryDataUpload}
      />

      {/* Stock Configuration */}
      <StockConfiguration
        stockRules={stockRules}
        onUpdateStockRules={handleUpdateStockRules}
        inventoryItems={inventoryData.map(item => item.itemName)}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Products</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalItems}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Items</CardTitle>
            <AlertTriangle className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{lowStockItems.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Out of Stock</CardTitle>
            <TrendingDown className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{outOfStockItems.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inventory Value</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalValue.toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Sales-Based Order Suggestions */}
      <SalesBasedOrderSuggestion
        salesData={salesData}
        inventoryData={inventoryData}
        stockRules={stockRules}
        onGenerateOrders={handleGenerateOrders}
      />

      {/* Low Stock Alert */}
      {lowStockItems.length > 0 && (
        <Card className="border-warning bg-warning/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-warning">
              <AlertTriangle className="h-5 w-5" />
              Low Stock Alert
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {lowStockItems.map(item => (
                <div key={item.itemName} className="flex items-center justify-between p-2 bg-card rounded-md">
                  <div>
                    <span className="font-medium">{item.itemName}</span>
                    <Badge variant="outline" className="ml-2 capitalize">
                      {item.category}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      Current Stock: {item.currentStock}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};