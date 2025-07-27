import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { ShoppingCart, TrendingUp, Package, Edit, Download, Send } from 'lucide-react';


interface SalesRecord {
  datetime: string;
  itemName: string;
  quantitySold: number;
}

interface InventoryRecord {
  itemName: string;
  currentStock: number;
  category: 'beer' | 'wine' | 'cigarettes' | 'spirits' | 'mixers' | 'tobacco' | 'cigarette' | 'liquor' | 'alcohol';
}

export interface CategoryOrder {
  category: 'beer' | 'wine' | 'cigarettes' | 'spirits' | 'mixers';
  items: OrderItem[];
  totalItems: number;
}

interface OrderItem {
  itemName: string;
  currentStock: number;
  avgDailySales: number;
  suggestedOrder: number;
  suggestedCases: number;
  unitsPerCase: number;
  daysUntilStockout: number;
  minimumStock: number;
}

interface SalesBasedOrderSuggestionProps {
  salesData: SalesRecord[];
  inventoryData: InventoryRecord[];
  onGenerateOrders: (orders: CategoryOrder[]) => void;
}

export const SalesBasedOrderSuggestion: React.FC<SalesBasedOrderSuggestionProps> = ({
  salesData,
  inventoryData,
  onGenerateOrders
}) => {
  const { toast } = useToast();
  const [webhookUrl, setWebhookUrl] = React.useState('');
  const [isExporting, setIsExporting] = React.useState(false);
  // Store units per case overrides in localStorage
  const [unitsPerCaseOverrides, setUnitsPerCaseOverrides] = React.useState<Record<string, number>>(() => {
    const stored = localStorage.getItem('unitsPerCaseOverrides');
    return stored ? JSON.parse(stored) : {};
  });

  const updateUnitsPerCase = (itemName: string, units: number) => {
    const newOverrides = { ...unitsPerCaseOverrides, [itemName]: units };
    setUnitsPerCaseOverrides(newOverrides);
    localStorage.setItem('unitsPerCaseOverrides', JSON.stringify(newOverrides));
  };

  // Get units per case based on bottle size and type
  const getUnitsPerCase = (itemName: string, category: string): number => {
    // Check for manual overrides first
    if (unitsPerCaseOverrides[itemName]) {
      return unitsPerCaseOverrides[itemName];
    }
    const name = itemName.toLowerCase();
    
    // Detect cigarettes by brand names
    const cigaretteBrands = [
      'marlboro', 'newport', 'camel', 'pall mall', 'kool', 'parliament',
      'american spirit', 'lucky strike', 'winston', 'salem', 'doral',
      'basic', 'virginia slims', 'misty', 'eagle 20s', 'l&m', 'merit', 'montego'
    ];
    
    const isCigarette = cigaretteBrands.some(brand => name.includes(brand));
    if (isCigarette) {
      return 10; // Cigarettes have 10 units per case
    }
    
    // Detect nicotine pouches and similar products (5 units per case)
    const nicotinePouchBrands = ['lucy', 'zyn', 'oeo', 'on!'];
    const isNicotinePouch = nicotinePouchBrands.some(brand => name.includes(brand));
    if (isNicotinePouch) {
      return 5; // Nicotine pouches have 5 units per case
    }
    
    // Detect Backwood 5 Pks (8 units per case)
    if (name.includes('backwood') && name.includes('5 pk')) {
      return 8; // Backwood 5 Pks have 8 units per case
    }
    
    // Detect Grabba Leaf Small (25 units per case)
    if (name.includes('grabba leaf') && name.includes('small')) {
      return 25; // Grabba Leaf Small has 25 units per case
    }
    
    // Specific product overrides (check before general volume rules)
    if (name.includes('jose cuervo') && name.includes('200')) {
      return 48; // Jose Cuervo Silver Tequila 200ml has 48 units per case
    }
    if (name.includes('juul menthol')) {
      return 8; // Juul Menthol has 8 units per case
    }
    if (name.includes('juul virginia tobacco')) {
      return 8; // Juul Virginia Tobacco has 8 units per case
    }
    if (name.includes('juul device')) {
      return 8; // Juul Device has 8 units per case
    }
    if (name.includes('dunhill')) {
      return 10; // Dunhill has 10 units per case
    }
    if (name.includes('bugler pouches')) {
      return 6; // Bugler Pouches has 6 units per case
    }
    if (name.includes('norwegian shag')) {
      return 5; // Norwegian Shag has 5 units per case
    }
    if (name.includes('flum') || name.includes('flume')) {
      return 10; // All Flum/Flume products have 10 units per case
    }
    if (name.includes('grizzly')) {
      return 5; // Grizzly has 5 units per case
    }
    if (name.includes('velo')) {
      return 5; // Velo has 5 units per case
    }

    // Volume-based case sizing (order matters - check more specific patterns first)
    if (name.includes('1.75') || name.includes('1750')) {
      return 6;
    }
    if (name.includes('750')) {
      return 12;
    }
    if (name.includes('375')) {
      return 24;
    }
    if (name.includes('200')) {
      return 24;
    }
    if (name.includes('50ml') || name.includes('50 ml')) {
      return 120;
    }
    
    // Default fallback
    return 12;
  };

  // Predefined stock rules - business logic
  const getMinimumStock = (itemName: string, avgDailySales: number): { minimumStock: number; daysOfSupply: number } => {
    const stockRules: Record<string, { minimumStock: number; daysOfSupply: number }> = {
      'Marlboro Lights': { minimumStock: 100, daysOfSupply: 14 }, // 10 cartons = 100 units
      'Jameson 200ml': { minimumStock: 15, daysOfSupply: 7 },
      'Jameson 375ml': { minimumStock: 15, daysOfSupply: 7 },
      "Chateau d'esclans 'Whispering Angel' Rose": { minimumStock: 6, daysOfSupply: 7 }, // Order at 6 units - people buy 3 at a time
      // Add more predefined rules here as needed
    };
    
    // High selling products (4-5 bottles per week = ~0.57-0.71 per day) should have minimum 4 units
    const weeklyAverage = avgDailySales * 7;
    const isHighSellingProduct = weeklyAverage >= 4;
    
    const defaultRule = stockRules[itemName] || { 
      minimumStock: isHighSellingProduct ? 4 : 0, 
      daysOfSupply: 7 
    };
    
    return defaultRule;
  };


  const categoryOrders = useMemo(() => {
    console.log('SalesBasedOrderSuggestion - Debug Info:');
    console.log('Sales data length:', salesData.length);
    console.log('Inventory data length:', inventoryData.length);
    
    // Debug: Check for Jameson items in inventory
    const jamesonItems = inventoryData.filter(item => item.itemName.toLowerCase().includes('jameson'));
    console.log('Jameson items in inventory:', jamesonItems);
    
    if (jamesonItems.length === 0) {
      console.log('WARNING: No Jameson items found in inventory data');
      console.log('Sample inventory items:', inventoryData.slice(0, 10).map(item => item.itemName));
    }
    
    console.log('Sales data:', salesData);
    console.log('Inventory data:', inventoryData);

    if (!salesData.length || !inventoryData.length) return [];

    // Calculate average daily sales for each item
    const salesByItem = salesData.reduce((acc, record) => {
      if (!acc[record.itemName]) {
        acc[record.itemName] = [];
      }
      acc[record.itemName].push(record.quantitySold);
      return acc;
    }, {} as Record<string, number[]>);

    // Calculate the actual date range from sales data
    const salesDates = salesData.map(record => new Date(record.datetime));
    const minDate = new Date(Math.min(...salesDates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...salesDates.map(d => d.getTime())));
    const actualDays = Math.max(1, Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    
    console.log('=== SALES PERIOD DEBUG ===');
    console.log('Min date:', minDate.toDateString());
    console.log('Max date:', maxDate.toDateString());
    console.log('Actual days in sales data:', actualDays);
    console.log('Total sales records:', salesData.length);

    // Calculate order suggestions for each inventory item
    const orderItems: OrderItem[] = inventoryData.map(item => {
      const sales = salesByItem[item.itemName] || [];
      const totalSales = sales.reduce((sum, qty) => sum + qty, 0);
      const avgDailySales = sales.length > 0 ? totalSales / actualDays : 0; // Use actual days from sales data
      
      // Debug specific problematic item
      if (item.itemName.includes('1800 Silver') && item.itemName.includes('375')) {
        console.log('=== DEBUGGING 1800 Silver 375ml ===');
        console.log('Item name:', item.itemName);
        console.log('Sales array:', sales);
        console.log('Sales array length:', sales.length);
        console.log('Total sales sum:', totalSales);
        console.log('Actual days:', actualDays);
        console.log('Raw sales records for this item:');
        const matchingRecords = salesData.filter(record => record.itemName === item.itemName);
        console.log('Matching records count:', matchingRecords.length);
        console.log('Sample records:', matchingRecords.slice(0, 10));
      }
      
      console.log(`Item: ${item.itemName}, Total Sales: ${totalSales}, Days: ${actualDays}, Daily Average: ${avgDailySales.toFixed(2)}`);
      
      console.log(`Processing item: ${item.itemName}, Current Stock: ${item.currentStock}, Sales: ${totalSales}, Days: ${actualDays}, Avg Daily: ${avgDailySales.toFixed(2)}`);
      
      // Special debug for Jameson items
      if (item.itemName.toLowerCase().includes('jameson')) {
        console.log('=== JAMESON ITEM DEBUG ===');
        console.log('Item name:', item.itemName);
        console.log('Current stock:', item.currentStock);
        console.log('Total sales:', totalSales);
        console.log('Sales array:', sales);
        console.log('Average daily sales:', avgDailySales);
        console.log('Sales data matches:', salesData.filter(r => r.itemName.toLowerCase().includes('jameson')));
      }

      // Special debug for Chateau Souverain items
      if (item.itemName.toLowerCase().includes('chateau souverain')) {
        console.log('=== CHATEAU SOUVERAIN ITEM DEBUG ===');
        console.log('Item name:', item.itemName);
        console.log('Current stock:', item.currentStock);
        console.log('Total sales:', totalSales);
        console.log('Sales array:', sales);
        console.log('Average daily sales:', avgDailySales);
        console.log('Sales data matches:', salesData.filter(r => r.itemName.toLowerCase().includes('chateau souverain')));
      }
      // Get units per case for this item
      const unitsPerCase = getUnitsPerCase(item.itemName, item.category);
      
      // Get predefined stock rule for this item
      const stockRule = getMinimumStock(item.itemName, avgDailySales);
      
      // Calculate minimum stock - prioritize out-of-stock items even without recent sales
      let minimumStock = stockRule.minimumStock;
      if (!minimumStock) {
        if (avgDailySales > 0) {
          minimumStock = Math.ceil(avgDailySales * 7); // 7 days supply based on sales
        } else if (item.currentStock <= 0) {
          // Out-of-stock items should get minimal restock (1 case worth) if no sales history
          const unitsPerCase = getUnitsPerCase(item.itemName, item.category);
          minimumStock = unitsPerCase; // Just 1 case for items with no sales
        } else {
          // Items with stock but no recent sales - don't order
          minimumStock = 0;
        }
      }
      
      const daysOfSupply = stockRule.daysOfSupply;
      
      // Calculate days until stockout
      const daysUntilStockout = avgDailySales > 0 ? Math.floor(item.currentStock / avgDailySales) : 
                                item.currentStock <= 0 ? 0 : 999;
      
      // Calculate suggested order quantity (in units)
      const targetStock = Math.max(minimumStock, Math.ceil(avgDailySales * daysOfSupply));
      const suggestedOrder = Math.max(0, targetStock - item.currentStock);
      
      // Special handling: if item is out of stock, ensure we order at least the minimum
      const finalSuggestedOrder = item.currentStock === 0 ? 
        Math.max(suggestedOrder, minimumStock) : suggestedOrder;
      
      // Convert to cases (round up to nearest case)
      const suggestedCases = Math.ceil(finalSuggestedOrder / unitsPerCase);

      return {
        itemName: item.itemName,
        currentStock: item.currentStock,
        avgDailySales,
        suggestedOrder: finalSuggestedOrder,
        suggestedCases,
        unitsPerCase,
        daysUntilStockout,
        minimumStock
      };
    });

    console.log('All calculated order items (before filtering):', orderItems);
    console.log('Items that need ordering (after filtering):', orderItems.filter(item => item.suggestedOrder > 0));

    // Debug filtering process for specific items
    const chateauItems = orderItems.filter(item => item.itemName.toLowerCase().includes('chateau souverain'));
    if (chateauItems.length > 0) {
      console.log('=== CHATEAU SOUVERAIN FILTERING DEBUG ===');
      chateauItems.forEach(item => {
        console.log(`Item: ${item.itemName}`);
        console.log(`Suggested Order: ${item.suggestedOrder} (needs > 0)`);
        console.log(`Avg Daily Sales: ${item.avgDailySales} (needs > 0)`);
        console.log(`Will be included: ${item.suggestedOrder > 0 && item.avgDailySales > 0}`);
      });
    }

    const filteredOrderItems = orderItems.filter(item => item.suggestedOrder > 0 && item.avgDailySales > 0);

    // Group by specific category from inventory data
    const categories: Record<string, OrderItem[]> = {};

    console.log('=== CATEGORY GROUPING DEBUG ===');
    
    filteredOrderItems.forEach(item => {
      const inventoryItem = inventoryData.find(inv => inv.itemName === item.itemName);
      if (inventoryItem) {
        const category = inventoryItem.category;
        
        console.log(`Item: ${item.itemName}, Category: ${category}`);
        
        // Create category if it doesn't exist
        if (!categories[category]) {
          categories[category] = [];
        }
        categories[category].push(item);
      }
    });

    // Create category orders
    return Object.entries(categories)
      .filter(([_, items]) => items.length > 0)
      .map(([category, items]) => ({
        category: category as any, // Use actual category names
        items,
        totalItems: items.length
      }));
  }, [salesData, inventoryData, unitsPerCaseOverrides]);

  console.log('Final category orders:', categoryOrders);
  console.log('Category orders length:', categoryOrders.length);

  const handleGenerateAllOrders = () => {
    onGenerateOrders(categoryOrders);
  };

  // Export order data as CSV
  const exportToCSV = () => {
    const allItems = categoryOrders.flatMap(category => 
      category.items.map(item => ({
        Category: category.category,
        'Item Name': item.itemName,
        'Current Stock': item.currentStock,
        'Suggested Cases': item.suggestedCases,
        'Units per Case': item.unitsPerCase,
        'Total Units to Order': item.suggestedCases * item.unitsPerCase,
        'Daily Sales Average': item.avgDailySales.toFixed(1),
        'Days Until Stockout': item.daysUntilStockout
      }))
    );

    if (allItems.length === 0) {
      toast({
        title: "No orders to export",
        description: "There are no order suggestions to export.",
        variant: "destructive",
      });
      return;
    }

    const headers = Object.keys(allItems[0]);
    const csvContent = [
      headers.join(','),
      ...allItems.map(item => 
        headers.map(header => `"${item[header as keyof typeof item]}"`).join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `order-suggestions-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Order exported",
      description: "Order suggestions have been downloaded as a CSV file.",
    });
  };

  // Send order to vendor via webhook
  const sendToVendor = async () => {
    if (!webhookUrl) {
      toast({
        title: "Error",
        description: "Please enter your vendor webhook URL",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);

    const orderData = {
      timestamp: new Date().toISOString(),
      orderDate: new Date().toISOString().split('T')[0],
      totalCategories: categoryOrders.length,
      categories: categoryOrders.map(category => ({
        category: category.category,
        totalItems: category.totalItems,
        items: category.items.map(item => ({
          itemName: item.itemName,
          currentStock: item.currentStock,
          suggestedCases: item.suggestedCases,
          unitsPerCase: item.unitsPerCase,
          totalUnitsToOrder: item.suggestedCases * item.unitsPerCase,
          dailySalesAverage: parseFloat(item.avgDailySales.toFixed(1)),
          daysUntilStockout: item.daysUntilStockout
        }))
      }))
    };

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        mode: "no-cors",
        body: JSON.stringify(orderData),
      });

      toast({
        title: "Order sent to vendor",
        description: "The order has been sent to your vendor. Check your automation system to confirm receipt.",
      });
    } catch (error) {
      console.error("Error sending order to vendor:", error);
      toast({
        title: "Error",
        description: "Failed to send order to vendor. Please check the URL and try again.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };


  if (categoryOrders.length === 0) {
    console.log('Showing NO ORDERS message - this means no items need ordering');
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Order Suggestions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-lg font-medium">No orders needed</p>
            <p className="text-muted-foreground">
              All items are sufficiently stocked based on sales history
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5" />
          Order Suggestions Based on Sales History
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Quick Order Button */}
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium">Quick Weekly Order</h4>
              <p className="text-sm text-muted-foreground">
                Auto-calculated for 7 days of sales + safety stock
              </p>
            </div>
            <Button onClick={handleGenerateAllOrders} variant="default">
              <ShoppingCart className="h-4 w-4 mr-2" />
              Generate Week's Order
            </Button>
          </div>
        </div>

        {/* Export Options */}
        <div className="bg-secondary/5 border border-secondary/20 rounded-lg p-4 space-y-4">
          <h4 className="font-medium">Export Order to Vendor</h4>
          
          {/* CSV Export */}
          <div className="flex items-center gap-2">
            <Button onClick={exportToCSV} variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Download CSV
            </Button>
            <span className="text-sm text-muted-foreground">Download order as spreadsheet</span>
          </div>

          {/* Webhook Export */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                type="url"
                placeholder="Enter vendor webhook URL (e.g., Zapier webhook)"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                className="flex-1"
              />
              <Button 
                onClick={sendToVendor} 
                variant="outline" 
                size="sm"
                disabled={isExporting || !webhookUrl}
              >
                <Send className="h-4 w-4 mr-2" />
                {isExporting ? 'Sending...' : 'Send to Vendor'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Send order data directly to your vendor's system via webhook (Zapier, Make, etc.)
            </p>
          </div>
        </div>

        {/* Category Orders */}
        <div className="space-y-4">
          {categoryOrders.sort((a, b) => a.category.localeCompare(b.category)).map(categoryOrder => (
            <Card key={categoryOrder.category} className="border-l-4 border-l-primary">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {categoryOrder.category}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {categoryOrder.totalItems} items
                    </span>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {categoryOrder.items.map((item, index) => {
                    const inventoryItem = inventoryData.find(inv => inv.itemName === item.itemName);
                    return (
                      <div key={`${item.itemName}-${index}`} className="flex items-center justify-between p-3 bg-card rounded-md border">
                        <div className="flex-1">
                          <div className="font-medium">{item.itemName}</div>
                          <div className="text-sm text-muted-foreground flex items-center gap-4 flex-wrap">
                            <span>Category: {inventoryItem?.category || 'Unknown'}</span>
                            <span>Current: {item.currentStock} units</span>
                            <span>Daily Sales: {item.avgDailySales.toFixed(1)}</span>
                            <span>Days Left: {item.daysUntilStockout}</span>
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                value={item.unitsPerCase}
                                onChange={(e) => {
                                  const newValue = parseInt(e.target.value) || item.unitsPerCase;
                                  updateUnitsPerCase(item.itemName, newValue);
                                }}
                                className="w-16 h-6 text-xs"
                                min="1"
                              />
                              <span>units/case</span>
                              {unitsPerCaseOverrides[item.itemName] && (
                                <Badge variant="secondary" className="text-xs">Custom</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-medium text-primary">
                            Order: {item.suggestedCases} cases ({item.suggestedCases * item.unitsPerCase} units)
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};