import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Package, ShoppingCart, TrendingDown, RefreshCw, Search } from 'lucide-react';
import { ProductList } from './ProductList';
import { ReorderDialog } from './ReorderDialog';
import { LocationSelector, Location } from './LocationSelector';
import { CSVUploader } from './CSVUploader';
import { supabase } from '@/integrations/supabase/client';

import { SalesBasedOrderSuggestion, CategoryOrder } from './SalesBasedOrderSuggestion';

export interface Product {
  id: string;
  name: string;
  category: 'wine' | 'beer' | 'spirits' | 'mixers';
  currentStock: number;
  reorderPoint: number;
  maxStock: number;
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
  const [squareLocations, setSquareLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [salesData, setSalesData] = useState<SalesRecord[]>(() => {
    const saved = localStorage.getItem('salesData');
    return saved ? JSON.parse(saved) : [];
  });
  const [inventoryData, setInventoryData] = useState<InventoryRecord[]>(() => {
    const saved = localStorage.getItem('inventoryData');
    return saved ? JSON.parse(saved) : [];
  });
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isReorderDialogOpen, setIsReorderDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');


  // Convert uploaded inventory data to Product format for display
  const convertedProducts: Product[] = inventoryData.map((item, index) => ({
    id: `uploaded-${index}`,
    name: item.itemName,
    category: item.category === 'cigarettes' ? 'spirits' : item.category as 'wine' | 'beer' | 'spirits',
    currentStock: item.currentStock,
    reorderPoint: item.category === 'cigarettes' ? 100 : 10, // Default reorder points
    maxStock: item.category === 'cigarettes' ? 200 : 50, // Default max stock
    supplier: item.category === 'cigarettes' ? 'Giant Wholesale (Cigarettes)' : 'Local Supplier',
    lastRestocked: '2024-01-15',
    unitsPerCase: item.category === 'cigarettes' ? 10 : 6
  }));

  // Filter products based on search query
  const filteredProducts = convertedProducts.filter(product =>
    product.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Debug: Check if Jameson items exist in the uploaded data
  console.log('=== INVENTORY DEBUG ===');
  console.log('Total inventory items:', inventoryData.length);
  const jamesonItems = inventoryData.filter(item => item.itemName.toLowerCase().includes('jameson'));
  console.log('Jameson items found in inventory:', jamesonItems);
  
  if (jamesonItems.length === 0) {
    console.log('No Jameson items found in uploaded data');
    console.log('Sample item names:', inventoryData.slice(0, 20).map(item => item.itemName));
  }

  const totalItems = inventoryData.length;
  const totalValue = inventoryData.reduce((sum, item) => sum + (item.currentStock * 25), 0); // Placeholder pricing
  const lowStockItems = inventoryData.filter(item => {
    // Use same predefined logic as in SalesBasedOrderSuggestion
    const stockRules: Record<string, number> = {
      'Marlboro Lights': 100, // 10 cartons = 100 units
      // Add more predefined rules here as needed
    };
    const minimumStock = stockRules[item.itemName] || 0;
    return item.currentStock <= minimumStock;
  });

  // Fetch Square locations on component mount
  useEffect(() => {
    const fetchSquareLocations = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('square-integration', {
          body: { action: 'get-locations' }
        });

        if (error) throw error;

        if (data?.locations) {
          setSquareLocations(data.locations);
        }
      } catch (error) {
        console.error('Error fetching Square locations:', error);
      }
    };

    fetchSquareLocations();
  }, []);

  const handleLocationSelect = (location: Location) => {
    setSelectedLocation(location);
  };

  const handleSyncSquareData = async () => {
    if (!selectedLocation) {
      console.log('No location selected');
      return;
    }
    
    setIsLoading(true);
    console.log('🔄 Starting sync for location:', selectedLocation.name, selectedLocation.squareLocationId);
    
    try {
      // Fetch inventory data from Square
      console.log('📦 Fetching inventory data...');
      const { data: inventoryData, error: inventoryError } = await supabase.functions.invoke('square-integration', {
        body: { action: 'get-inventory', locationId: selectedLocation.squareLocationId }
      });

      console.log('📦 Inventory response:', inventoryData, inventoryError);

      if (inventoryError) {
        console.error('❌ Inventory error:', inventoryError);
        throw inventoryError;
      }

      // Fetch sales data from Square
      console.log('📊 Fetching sales data...');
      const { data: salesData, error: salesError } = await supabase.functions.invoke('square-integration', {
        body: { action: 'get-sales', locationId: selectedLocation.squareLocationId }
      });

      console.log('📊 Sales response:', salesData, salesError);

      if (salesError) {
        console.error('❌ Sales error:', salesError);
        throw salesError;
      }

      // Update state with real data from Square
      if (inventoryData?.products) {
        console.log('✅ Processing', inventoryData.products.length, 'inventory items');
        const convertedInventory = inventoryData.products.map((product: any) => ({
          itemName: product.name,
          currentStock: product.currentStock,
          category: 'wine' as const // Default category for Square items
        }));
        setInventoryData(convertedInventory);
        localStorage.setItem('inventoryData', JSON.stringify(convertedInventory));
        console.log('✅ Inventory data saved:', convertedInventory);
      } else {
        console.log('⚠️ No inventory products found');
      }

      if (salesData?.salesRecords) {
        console.log('✅ Processing', salesData.salesRecords.length, 'sales records');
        const convertedSales = salesData.salesRecords.map((record: any) => ({
          datetime: record.saleDate,
          itemName: record.productName,
          quantitySold: record.quantitySold
        }));
        setSalesData(convertedSales);
        localStorage.setItem('salesData', JSON.stringify(convertedSales));
        console.log('✅ Sales data saved:', convertedSales);
      } else {
        console.log('⚠️ No sales records found');
      }

      console.log('🎉 Successfully synced Square data');
    } catch (error) {
      console.error('💥 Error syncing Square data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadTestData = () => {
    console.log('🧪 Loading test inventory data...');
    
    // Sample liquor store inventory data
    const testInventoryData = [
      { itemName: 'B&H DeLuxe 100s', currentStock: 45, category: 'cigarettes' as const },
      { itemName: 'Capri Cigarettes', currentStock: 23, category: 'cigarettes' as const },
      { itemName: 'Djarum Black', currentStock: 67, category: 'cigarettes' as const },
      { itemName: 'Jameson Irish Whiskey 750ml', currentStock: 12, category: 'wine' as const },
      { itemName: 'Grey Goose Vodka 750ml', currentStock: 8, category: 'wine' as const },
      { itemName: 'Hennessy VS Cognac 750ml', currentStock: 15, category: 'wine' as const },
      { itemName: 'Patron Silver Tequila 750ml', currentStock: 6, category: 'wine' as const },
      { itemName: 'Jack Daniels Whiskey 750ml', currentStock: 18, category: 'wine' as const },
      { itemName: 'Heineken Beer 6-pack', currentStock: 34, category: 'beer' as const },
      { itemName: 'Corona Extra 12-pack', currentStock: 28, category: 'beer' as const },
      { itemName: 'Budweiser 24-pack', currentStock: 22, category: 'beer' as const },
      { itemName: 'Stella Artois 6-pack', currentStock: 19, category: 'beer' as const },
      { itemName: 'Red Bull Energy Drink 4-pack', currentStock: 41, category: 'beer' as const },
      { itemName: 'Monster Energy 4-pack', currentStock: 33, category: 'beer' as const }
    ];

    // Sample sales data from last 30 days
    const testSalesData = [
      { datetime: '2024-01-20T14:30:00Z', itemName: 'B&H DeLuxe 100s', quantitySold: 15 },
      { datetime: '2024-01-20T15:45:00Z', itemName: 'Jameson Irish Whiskey 750ml', quantitySold: 3 },
      { datetime: '2024-01-21T10:15:00Z', itemName: 'Capri Cigarettes', quantitySold: 8 },
      { datetime: '2024-01-21T16:20:00Z', itemName: 'Heineken Beer 6-pack', quantitySold: 5 },
      { datetime: '2024-01-22T12:00:00Z', itemName: 'Grey Goose Vodka 750ml', quantitySold: 2 },
      { datetime: '2024-01-22T18:30:00Z', itemName: 'Corona Extra 12-pack', quantitySold: 4 },
      { datetime: '2024-01-23T09:45:00Z', itemName: 'Djarum Black', quantitySold: 12 },
      { datetime: '2024-01-23T14:15:00Z', itemName: 'Red Bull Energy Drink 4-pack', quantitySold: 7 }
    ];

    // Update state with test data
    setInventoryData(testInventoryData);
    setSalesData(testSalesData);
    
    // Save to localStorage
    localStorage.setItem('inventoryData', JSON.stringify(testInventoryData));
    localStorage.setItem('salesData', JSON.stringify(testSalesData));
    
    console.log('✅ Test data loaded:', { 
      inventory: testInventoryData.length + ' items', 
      sales: testSalesData.length + ' records' 
    });
  };

  const handleSalesDataUpload = (data: SalesRecord[]) => {
    console.log('=== SALES DATA UPLOADED ===');
    console.log('Sales data received:', data);
    console.log('Sales data length:', data.length);
    
    // Clear previous data first
    setSalesData([]);
    setInventoryData([]);
    localStorage.removeItem('salesData');
    localStorage.removeItem('inventoryData');
    
    // Set new data
    setSalesData(data);
    localStorage.setItem('salesData', JSON.stringify(data));
  };

  const handleInventoryDataUpload = (data: InventoryRecord[]) => {
    console.log('=== INVENTORY DATA UPLOADED ===');
    console.log('Inventory data received:', data);
    console.log('Inventory data length:', data.length);
    setInventoryData(data);
    localStorage.setItem('inventoryData', JSON.stringify(data));
  };

  const handleReorder = (product: Product) => {
    setSelectedProduct(product);
    setIsReorderDialogOpen(true);
  };

  const handleGenerateOrders = (categoryOrders: CategoryOrder[]) => {
    // TODO: Implement order generation (could send to email, print, or save to database)
    console.log('Generated orders:', categoryOrders);
    const totalCost = 0; // Cost tracking removed
    alert(`Generated ${categoryOrders.length} category order(s) totaling $${totalCost.toFixed(2)}`);
  };

  const outOfStockItems = inventoryData.filter(item => item.currentStock === 0);

  return (
    <div className="space-y-6">
      {/* Location Selector */}
      <LocationSelector
        locations={squareLocations}
        selectedLocation={selectedLocation}
        onLocationSelect={handleLocationSelect}
      />

      {/* Test Data and Sync Buttons */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">Wolf Liquor Test Data</h3>
              <p className="text-sm text-muted-foreground">
                Load sample inventory data to test ORDER MIND AI
              </p>
            </div>
            <Button
              onClick={handleLoadTestData}
              variant="outline"
              className="flex items-center gap-2"
            >
              <Package className="h-4 w-4" />
              Load Test Data
            </Button>
          </div>
          
          {selectedLocation && (
            <div className="flex items-center justify-between border-t pt-4">
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
          )}
        </CardContent>
      </Card>

      {/* Sales-Based Order Suggestions - Moved up per user request */}
      <SalesBasedOrderSuggestion
        salesData={salesData}
        inventoryData={inventoryData}
        onGenerateOrders={handleGenerateOrders}
      />

      {/* CSV Upload Section */}
      <CSVUploader 
        onSalesDataUpload={handleSalesDataUpload}
        onInventoryDataUpload={handleInventoryDataUpload}
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

      {/* Inventory Search */}
      {convertedProducts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Search Inventory</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search inventory items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            {searchQuery && (
              <p className="text-sm text-muted-foreground mt-2">
                Showing {filteredProducts.length} of {convertedProducts.length} items
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Current Inventory Display */}
      {convertedProducts.length > 0 && (
        <ProductList
          products={filteredProducts}
          onReorder={handleReorder}
          salesData={salesData}
        />
      )}

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

      {/* Reorder Dialog */}
      <ReorderDialog
        open={isReorderDialogOpen}
        onOpenChange={setIsReorderDialogOpen}
        product={selectedProduct}
        onConfirm={() => setIsReorderDialogOpen(false)}
      />
    </div>
  );
};