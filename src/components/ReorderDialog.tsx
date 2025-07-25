import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Package, DollarSign, Truck } from 'lucide-react';
import { Product } from './InventoryDashboard';
import { useToast } from '@/hooks/use-toast';

interface ReorderDialogProps {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export const ReorderDialog: React.FC<ReorderDialogProps> = ({
  product,
  open,
  onOpenChange,
  onConfirm
}) => {
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const { toast } = useToast();

  React.useEffect(() => {
    if (product && open) {
      // Suggest reordering to max stock
      const suggestedQuantity = product.maxStock - product.currentStock;
      setQuantity(suggestedQuantity.toString());
      setNotes('');
    }
  }, [product, open]);

  if (!product) return null;

  const handleConfirm = () => {
    if (!quantity || parseInt(quantity) <= 0) {
      toast({
        title: "Invalid Quantity",
        description: "Please enter a valid quantity to reorder.",
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Purchase Order Created",
      description: `Reorder request for ${quantity} units of ${product.name} has been submitted to ${product.supplier}.`,
    });

    onConfirm();
  };

  const orderQuantity = parseInt(quantity) || 0;
  const newStockLevel = product.currentStock + orderQuantity;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Reorder Request</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Product Info */}
          <Card>
            <CardContent className="pt-4">
              <div className="space-y-2">
                <h3 className="font-semibold">{product.name}</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Current Stock:</span>
                    <div className="font-medium">{product.currentStock} units</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Reorder Point:</span>
                    <div className="font-medium">{product.reorderPoint} units</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Order Details */}
          <div className="space-y-3">
            <div>
              <Label htmlFor="quantity">Quantity to Order</Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="Enter quantity"
              />
            </div>

            <div>
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional notes for supplier..."
                rows={2}
              />
            </div>
          </div>

          {/* Order Summary */}
          {orderQuantity > 0 && (
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <h4 className="font-medium mb-3">Order Summary</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span>Quantity:</span>
                    </div>
                    <span className="font-medium">{orderQuantity} units</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-muted-foreground" />
                      <span>New Stock Level:</span>
                    </div>
                    <span className="font-medium">{newStockLevel} units</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} className="bg-accent hover:bg-accent/90">
            Create Purchase Order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};