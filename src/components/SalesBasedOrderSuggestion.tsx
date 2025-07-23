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
  category: 'beer' | 'wine' | 'cigarettes';
}

export interface CategoryOrder {
  category: 'beer' | 'wine' | 'cigarettes';
  items: OrderItem[];
  totalCost: number;
  totalItems: number;
}

interface OrderItem {
  itemName: string;
  currentStock: number;
  avgDailySales: number;
  suggestedOrder: number;
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
  // Predefined stock rules - business logic
  const getMinimumStock = (itemName: string): { minimumStock: number; daysOfSupply: number } => {
    const stockRules: Record<string, { minimumStock: number; daysOfSupply: number }> = {
      'Marlboro Lights': { minimumStock: 100, daysOfSupply: 14 }, // 10 cartons = 100 units
      // Add more predefined rules here as needed
    };
    
    return stockRules[itemName] || { minimumStock: 0, daysOfSupply: 7 };
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
    if (!salesData.length || !inventoryData.length) return [];

    // Calculate average daily sales for each item
    const salesByItem = salesData.reduce((acc, record) => {
      if (!acc[record.itemName]) {
        acc[record.itemName] = [];
      }
      acc[record.itemName].push(record.quantitySold);
      return acc;
    }, {} as Record<string, number[]>);

    // Calculate order suggestions for each inventory item
    const orderItems: OrderItem[] = inventoryData.map(item => {
      const sales = salesByItem[item.itemName] || [];
      const totalSales = sales.reduce((sum, qty) => sum + qty, 0);
      const avgDailySales = sales.length > 0 ? totalSales / 14 : 0; // 2 weeks = 14 days
      
      // Get predefined stock rule for this item
      const stockRule = getMinimumStock(item.itemName);
      const minimumStock = stockRule.minimumStock || Math.ceil(avgDailySales * 7); // Default to 7 days supply
      const daysOfSupply = stockRule.daysOfSupply;
      
      // Calculate days until stockout
      const daysUntilStockout = avgDailySales > 0 ? Math.floor(item.currentStock / avgDailySales) : 999;
      
      // Calculate suggested order quantity
      const targetStock = Math.max(minimumStock, Math.ceil(avgDailySales * daysOfSupply));
      const suggestedOrder = Math.max(0, targetStock - item.currentStock);
      
      // Estimate cost (placeholder - you'd need actual pricing data)
      const estimatedUnitCost = getEstimatedCost(item.itemName, item.category);
      const estimatedCost = suggestedOrder * estimatedUnitCost;

      return {
        itemName: item.itemName,
        currentStock: item.currentStock,
        avgDailySales,
        suggestedOrder,
        daysUntilStockout,
        minimumStock,
        estimatedCost
      };
    }).filter(item => item.suggestedOrder > 0); // Only items that need ordering

    // Group by category
    const categories: Record<string, OrderItem[]> = {
      beer: [],
      wine: [],
      cigarettes: []
    };

    orderItems.forEach(item => {
      const inventoryItem = inventoryData.find(inv => inv.itemName === item.itemName);
      if (inventoryItem) {
        categories[inventoryItem.category].push(item);
      }
    });

    // Create category orders
    return Object.entries(categories)
      .filter(([_, items]) => items.length > 0)
      .map(([category, items]) => ({
        category: category as 'beer' | 'wine' | 'cigarettes',
        items,
        totalCost: items.reduce((sum, item) => sum + item.estimatedCost, 0),
        totalItems: items.length
      }));
  }, [salesData, inventoryData]);


  const totalOrderValue = categoryOrders.reduce((sum, order) => sum + order.totalCost, 0);

  const handleGenerateAllOrders = () => {
    onGenerateOrders(categoryOrders);
  };

  if (categoryOrders.length === 0) {
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
            Generate All Orders
          </Button>
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
                  {categoryOrder.items.map(item => (
                    <div key={item.itemName} className="flex items-center justify-between p-3 bg-card rounded-md border">
                      <div className="flex-1">
                        <div className="font-medium">{item.itemName}</div>
                        <div className="text-sm text-muted-foreground">
                          Current: {item.currentStock} | Daily Sales: {item.avgDailySales.toFixed(1)} | 
                          Days Left: {item.daysUntilStockout}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium text-primary">
                          Order: {item.suggestedOrder}
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