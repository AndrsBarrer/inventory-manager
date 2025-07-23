import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShoppingCart, Truck } from 'lucide-react';
import { Product } from './InventoryDashboard';

interface OrderSuggestionProps {
  products: Product[];
  onGenerateOrder: (vendorOrders: VendorOrder[]) => void;
}

export interface VendorOrder {
  vendor: string;
  products: Array<{
    product: Product;
    suggestedCases: number;
    suggestedUnits: number;
    totalCost: number;
  }>;
  totalCost: number;
}

export const OrderSuggestion: React.FC<OrderSuggestionProps> = ({ products, onGenerateOrder }) => {
  // Group products by vendor and calculate suggested orders
  const vendorOrders: VendorOrder[] = React.useMemo(() => {
    const productsByVendor = products.reduce((acc, product) => {
      if (!acc[product.supplier]) {
        acc[product.supplier] = [];
      }
      acc[product.supplier].push(product);
      return acc;
    }, {} as Record<string, Product[]>);

    return Object.entries(productsByVendor).map(([vendor, vendorProducts]) => {
      const productsNeedingReorder = vendorProducts.filter(p => p.currentStock <= p.reorderPoint);
      
      const orderProducts = productsNeedingReorder.map(product => {
        // Calculate units needed to reach max stock
        const unitsNeeded = product.maxStock - product.currentStock;
        const suggestedCases = Math.ceil(unitsNeeded / product.unitsPerCase);
        const suggestedUnits = suggestedCases * product.unitsPerCase;
        const totalCost = suggestedUnits * product.unitCost;

        return {
          product,
          suggestedCases,
          suggestedUnits,
          totalCost
        };
      });

      const totalCost = orderProducts.reduce((sum, item) => sum + item.totalCost, 0);

      return {
        vendor,
        products: orderProducts,
        totalCost
      };
    }).filter(order => order.products.length > 0);
  }, [products]);

  const totalOrderValue = vendorOrders.reduce((sum, order) => sum + order.totalCost, 0);

  const handleGenerateAllOrders = () => {
    onGenerateOrder(vendorOrders);
  };

  if (vendorOrders.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Order Suggestions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No reorders needed at this time. All products are above reorder points.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5" />
          Order Suggestions
        </CardTitle>
        <div className="flex items-center justify-between mt-2">
          <p className="text-sm text-muted-foreground">
            {vendorOrders.length} vendor{vendorOrders.length > 1 ? 's' : ''} • Total: ${totalOrderValue.toFixed(2)}
          </p>
          <Button onClick={handleGenerateAllOrders} className="bg-primary hover:bg-primary/90">
            Generate All Orders
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {vendorOrders.map(order => (
            <div key={order.vendor} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold">{order.vendor}</h3>
                  <Badge variant="secondary">
                    {order.products.length} item{order.products.length > 1 ? 's' : ''}
                  </Badge>
                </div>
                <div className="text-right">
                  <div className="font-semibold">${order.totalCost.toFixed(2)}</div>
                </div>
              </div>
              
              <div className="space-y-2">
                {order.products.map(({ product, suggestedCases, suggestedUnits, totalCost }) => (
                  <div key={product.id} className="flex items-center justify-between text-sm p-2 bg-muted/50 rounded">
                    <div className="flex-1">
                      <span className="font-medium">{product.name}</span>
                      <div className="text-xs text-muted-foreground">
                        Current: {product.currentStock} units • Reorder at: {product.reorderPoint}
                      </div>
                    </div>
                    <div className="text-right min-w-[120px]">
                      <div className="font-medium">
                        {suggestedCases} case{suggestedCases > 1 ? 's' : ''}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        ({suggestedUnits} units • ${totalCost.toFixed(2)})
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};