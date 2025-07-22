import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Wine, Beer, Zap, Coffee } from 'lucide-react';
import { Product } from './InventoryDashboard';

interface ProductListProps {
  products: Product[];
  onReorder: (product: Product) => void;
}

const getCategoryIcon = (category: Product['category']) => {
  switch (category) {
    case 'wine':
      return <Wine className="h-4 w-4" />;
    case 'beer':
      return <Beer className="h-4 w-4" />;
    case 'spirits':
      return <Zap className="h-4 w-4" />;
    case 'mixers':
      return <Coffee className="h-4 w-4" />;
  }
};

const getStockStatus = (currentStock: number, reorderPoint: number) => {
  if (currentStock === 0) {
    return { label: 'Out of Stock', variant: 'destructive' as const };
  }
  if (currentStock <= reorderPoint) {
    return { label: 'Low Stock', variant: 'destructive' as const };
  }
  if (currentStock <= reorderPoint * 1.5) {
    return { label: 'Medium Stock', variant: 'secondary' as const };
  }
  return { label: 'In Stock', variant: 'default' as const };
};

export const ProductList: React.FC<ProductListProps> = ({ products, onReorder }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventory Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {products.map(product => {
            const stockStatus = getStockStatus(product.currentStock, product.reorderPoint);
            const stockPercentage = (product.currentStock / product.maxStock) * 100;
            
            return (
              <div key={product.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      {getCategoryIcon(product.category)}
                      <h3 className="font-semibold">{product.name}</h3>
                    </div>
                    <Badge variant="outline" className="capitalize">
                      {product.category}
                    </Badge>
                    <Badge variant={stockStatus.variant}>
                      {stockStatus.label}
                    </Badge>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => onReorder(product)}
                    disabled={product.currentStock > product.reorderPoint}
                  >
                    Reorder
                  </Button>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Current Stock:</span>
                    <div className="font-medium">{product.currentStock} units</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Reorder Point:</span>
                    <div className="font-medium">{product.reorderPoint} units</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Max Stock:</span>
                    <div className="font-medium">{product.maxStock} units</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Unit Cost:</span>
                    <div className="font-medium">${product.unitCost}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Supplier:</span>
                    <div className="font-medium">{product.supplier}</div>
                  </div>
                </div>

                {/* Stock Level Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Stock Level</span>
                    <span>{stockPercentage.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full transition-all ${
                        stockPercentage < 30 ? 'bg-destructive' :
                        stockPercentage < 60 ? 'bg-warning' : 'bg-success'
                      }`}
                      style={{ width: `${Math.min(stockPercentage, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};