import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShoppingCart, TrendingUp, Package } from 'lucide-react';


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
  totalCost: number;
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
  estimatedCost: number;
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
  // Get units per case based on bottle size and type
  const getUnitsPerCase = (itemName: string, category: string): number => {
    const lowerName = itemName.toLowerCase();
    
    // Special cases for 375ml bottles with 24 units (you can add more here)
    const special375mlCases: Record<string, number> = {
      'fireball cinnamon whisky 375ml': 24,
      'smirnoff vodka 375ml': 24,
      // Add more items that have 24 units per case for 375ml
    };
    
    // Check for bottle sizes in name
    if (lowerName.includes('750ml')) {
      return 12; // Wine and liquor 750ml bottles
    }
    
    if (lowerName.includes('375ml')) {
      return special375mlCases[lowerName] || 12; // Default 12, special cases 24
    }
    
    if (lowerName.includes('200ml')) {
      // You can add logic here to determine if it's 24 or 48
      // For now, default to 24, but you can customize per item
      const special200mlCases: Record<string, number> = {
        // Add specific 200ml items that have 48 units
      };
      return special200mlCases[lowerName] || 24;
    }
    
    // Category defaults
    if (category === 'cigarettes') return 10; // Cigarette cartons
    if (category === 'beer') return 24; // Beer cases
    
    return 12; // Default for wine/spirits
  };

  // Predefined stock rules - business logic
  const getMinimumStock = (itemName: string, avgDailySales: number): { minimumStock: number; daysOfSupply: number } => {
    const stockRules: Record<string, { minimumStock: number; daysOfSupply: number }> = {
      'Marlboro Lights': { minimumStock: 100, daysOfSupply: 14 }, // 10 cartons = 100 units
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

  const getEstimatedCost = (itemName: string, category: string): number => {
    // Placeholder pricing logic - you'd want to add real pricing data
    const basePrices = {
      beer: 45,
      wine: 25,
      cigarettes: 85
    };
    return basePrices[category as keyof typeof basePrices] || 25;
  };

  const categoryOrders = useMemo(() => {
    console.log('SalesBasedOrderSuggestion - Debug Info:');
    console.log('Sales data length:', salesData.length);
    console.log('Inventory data length:', inventoryData.length);
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
      
      // Get units per case for this item
      const unitsPerCase = getUnitsPerCase(item.itemName, item.category);
      
      // Get predefined stock rule for this item
      const stockRule = getMinimumStock(item.itemName, avgDailySales);
      
      // Calculate minimum stock - ensure out of stock items get a minimum order
      let minimumStock = stockRule.minimumStock;
      if (!minimumStock) {
        if (avgDailySales > 0) {
          minimumStock = Math.ceil(avgDailySales * 7); // 7 days supply based on sales
        } else if (item.currentStock === 0) {
          // For out-of-stock items with no sales history, set a reasonable minimum
          minimumStock = item.category === 'cigarettes' ? 100 : 
                        item.category === 'beer' ? 24 : 12; 
        } else {
          minimumStock = 0; // Items with stock but no sales history
        }
      }
      
      const daysOfSupply = stockRule.daysOfSupply;
      
      // Calculate days until stockout
      const daysUntilStockout = avgDailySales > 0 ? Math.floor(item.currentStock / avgDailySales) : 
                                item.currentStock === 0 ? 0 : 999;
      
      // Calculate suggested order quantity (in units)
      const targetStock = Math.max(minimumStock, Math.ceil(avgDailySales * daysOfSupply));
      const suggestedOrder = Math.max(0, targetStock - item.currentStock);
      
      // Special handling: if item is out of stock, ensure we order at least the minimum
      const finalSuggestedOrder = item.currentStock === 0 ? 
        Math.max(suggestedOrder, minimumStock) : suggestedOrder;
      
      // Convert to cases (round up to nearest case)
      const suggestedCases = Math.ceil(finalSuggestedOrder / unitsPerCase);
      
      // Estimate cost (placeholder - you'd need actual pricing data)
      const estimatedUnitCost = getEstimatedCost(item.itemName, item.category);
      const estimatedCost = finalSuggestedOrder * estimatedUnitCost;

      return {
        itemName: item.itemName,
        currentStock: item.currentStock,
        avgDailySales,
        suggestedOrder: finalSuggestedOrder,
        suggestedCases,
        unitsPerCase,
        daysUntilStockout,
        minimumStock,
        estimatedCost
      };
    });

    console.log('All calculated order items (before filtering):', orderItems);
    console.log('Items that need ordering (after filtering):', orderItems.filter(item => item.suggestedOrder > 0));

    const filteredOrderItems = orderItems.filter(item => item.suggestedOrder > 0);

    // Group by category with flexible category mapping
    const categories: Record<string, OrderItem[]> = {
      beer: [],
      wine: [],
      cigarettes: [],
      spirits: [], // Add spirits category
      mixers: []   // Add mixers category
    };

    console.log('=== CATEGORY GROUPING DEBUG ===');
    
    filteredOrderItems.forEach(item => {
      const inventoryItem = inventoryData.find(inv => inv.itemName === item.itemName);
      if (inventoryItem) {
        let validCategory = inventoryItem.category.toLowerCase();
        
        // Map different category names to our standard categories
        if (validCategory === 'tobacco' || validCategory === 'cigarette') {
          validCategory = 'cigarettes';
        }
        if (validCategory === 'liquor' || validCategory === 'alcohol') {
          validCategory = 'spirits';
        }
        
        console.log(`Item: ${item.itemName}, Original Category: ${inventoryItem.category}, Mapped Category: ${validCategory}`);
        
        // Ensure the category exists in our categories object, or use 'spirits' as default
        if (categories[validCategory]) {
          categories[validCategory].push(item);
        } else {
          console.log(`Unknown category "${validCategory}" for ${item.itemName}, adding to spirits`);
          categories['spirits'].push(item);
        }
      }
    });

    // Create category orders
    return Object.entries(categories)
      .filter(([_, items]) => items.length > 0)
      .map(([category, items]) => ({
        category: category as 'beer' | 'wine' | 'cigarettes' | 'spirits' | 'mixers',
        items,
        totalCost: items.reduce((sum, item) => sum + item.estimatedCost, 0),
        totalItems: items.length
      }));
  }, [salesData, inventoryData]);

  console.log('Final category orders:', categoryOrders);
  console.log('Category orders length:', categoryOrders.length);

  const totalOrderValue = categoryOrders.reduce((sum, order) => sum + order.totalCost, 0);

  const handleGenerateAllOrders = () => {
    onGenerateOrders(categoryOrders);
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
        {/* Summary */}
        <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
          <div>
            <p className="text-sm text-muted-foreground">Total Order Value</p>
            <p className="text-2xl font-bold">${totalOrderValue.toFixed(2)}</p>
          </div>
          <Button onClick={handleGenerateAllOrders} size="lg">
            <TrendingUp className="h-4 w-4 mr-2" />
            One-Click Weekly Order
          </Button>
        </div>

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

        {/* Category Orders */}
        <div className="space-y-4">
          {categoryOrders.map(categoryOrder => (
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
                  <span className="text-lg font-bold">
                    ${categoryOrder.totalCost.toFixed(2)}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {categoryOrder.items.map((item, index) => (
                    <div key={`${item.itemName}-${index}`} className="flex items-center justify-between p-3 bg-card rounded-md border">
                      <div className="flex-1">
                        <div className="font-medium">{item.itemName}</div>
                        <div className="text-sm text-muted-foreground">
                          Current: {item.currentStock} units | Daily Sales: {item.avgDailySales.toFixed(1)} | 
                          Days Left: {item.daysUntilStockout} | {item.unitsPerCase} units/case
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium text-primary">
                          Order: {item.suggestedCases} cases ({item.suggestedOrder} units)
                        </div>
                        <div className="text-sm text-muted-foreground">
                          ${item.estimatedCost.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};