import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Package, ShoppingCart, TrendingDown, RefreshCw } from 'lucide-react';
import { ProductList } from './ProductList';
import { ReorderDialog } from './ReorderDialog';
import { LocationSelector, Location } from './LocationSelector';
import { OrderSuggestion, VendorOrder } from './OrderSuggestion';

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
  }
];

export const InventoryDashboard: React.FC = () => {
  const [products] = useState<Product[]>(mockProducts);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showReorderDialog, setShowReorderDialog] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const lowStockProducts = products.filter(p => p.currentStock <= p.reorderPoint);
  const totalValue = products.reduce((sum, p) => sum + (p.currentStock * p.unitCost), 0);
  const outOfStockProducts = products.filter(p => p.currentStock === 0);

  const handleReorder = (product: Product) => {
    setSelectedProduct(product);
    setShowReorderDialog(true);
  };

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

  const handleGenerateOrders = (vendorOrders: VendorOrder[]) => {
    // TODO: Implement order generation (could send to email, print, or save to database)
    console.log('Generated orders:', vendorOrders);
    // For now, just show a simple alert
    alert(`Generated ${vendorOrders.length} order(s) totaling $${vendorOrders.reduce((sum, order) => sum + order.totalCost, 0).toFixed(2)}`);
  };

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

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Products</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{products.length}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Items</CardTitle>
            <AlertTriangle className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{lowStockProducts.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Out of Stock</CardTitle>
            <TrendingDown className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{outOfStockProducts.length}</div>
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

      {/* Order Suggestions */}
      <OrderSuggestion 
        products={products} 
        onGenerateOrder={handleGenerateOrders}
      />

      {/* Low Stock Alert */}
      {lowStockProducts.length > 0 && (
        <Card className="border-warning bg-warning/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-warning">
              <AlertTriangle className="h-5 w-5" />
              Low Stock Alert
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {lowStockProducts.map(product => (
                <div key={product.id} className="flex items-center justify-between p-2 bg-card rounded-md">
                  <div>
                    <span className="font-medium">{product.name}</span>
                    <Badge variant="outline" className="ml-2 capitalize">
                      {product.category}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      Stock: {product.currentStock} / Reorder at: {product.reorderPoint}
                    </span>
                    <Button 
                      size="sm" 
                      onClick={() => handleReorder(product)}
                      className="bg-accent hover:bg-accent/90"
                    >
                      Reorder
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Product List */}
      <ProductList products={products} onReorder={handleReorder} />

      {/* Reorder Dialog */}
      <ReorderDialog
        product={selectedProduct}
        open={showReorderDialog}
        onOpenChange={setShowReorderDialog}
        onConfirm={() => {
          setShowReorderDialog(false);
          setSelectedProduct(null);
        }}
      />
    </div>
  );
};