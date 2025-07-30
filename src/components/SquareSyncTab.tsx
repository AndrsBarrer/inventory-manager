import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { Location } from './LocationSelector';

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

interface SquareSyncTabProps {
  onSalesDataUpload: (data: SalesRecord[]) => void;
  onInventoryDataUpload: (data: InventoryRecord[]) => void;
  selectedLocation?: Location | null;
}

export const SquareSyncTab: React.FC<SquareSyncTabProps> = ({
  onSalesDataUpload,
  onInventoryDataUpload,
  selectedLocation
}) => {
  const [squareSyncing, setSquareSyncing] = useState(false);
  const [salesUploaded, setSalesUploaded] = useState(false);
  const [inventoryUploaded, setInventoryUploaded] = useState(false);
  const { toast } = useToast();

  // Process Square inventory data (already structured objects)
  const parseSquareInventory = (inventoryData: any[]): InventoryRecord[] => {
    console.log('=== PARSING SQUARE INVENTORY DATA ===');
    console.log('Raw inventory data:', inventoryData);
    
    const processed = inventoryData
      .filter(item => {
        const isValid = item && 
                       item.itemName && 
                       item.itemName !== 'Unknown Item' && 
                       typeof item.currentStock === 'number' && 
                       item.currentStock > 0;
        
        if (!isValid) {
          console.log('Filtering out invalid item:', item);
        }
        return isValid;
      })
      .map(item => {
        const record: InventoryRecord = {
          itemName: item.itemName,
          currentStock: item.currentStock,
          category: (['beer', 'wine', 'cigarettes'].includes(item.category?.toLowerCase())) 
            ? item.category.toLowerCase() as 'beer' | 'wine' | 'cigarettes'
            : 'beer'
        };
        console.log('Creating inventory record:', record);
        return record;
      });
    
    console.log(`Successfully parsed ${processed.length} valid inventory records`);
    return processed;
  };

  // Process Square sales data (already structured objects)
  const parseSquareSales = (salesData: any[]): SalesRecord[] => {
    console.log('=== PARSING SQUARE SALES DATA ===');
    console.log('Raw sales data:', salesData);
    
    const processed = salesData
      .filter(item => item && item.itemName && item.datetime)
      .map(item => {
        const record: SalesRecord = {
          datetime: item.datetime || new Date().toISOString(),
          itemName: item.itemName || 'Unknown Item',
          quantitySold: parseInt(item.quantitySold?.toString()) || 0
        };
        return record;
      });
    
    console.log('Parsed sales records:', processed.length);
    console.log('First parsed record:', processed[0]);
    return processed;
  };

  const handleSquareSync = async () => {
    if (!selectedLocation || selectedLocation.status !== 'active') {
      toast({
        title: "Error",
        description: "Please select an active Square location first",
        variant: "destructive",
      });
      return;
    }

    setSquareSyncing(true);
    try {
      console.log('=== STARTING SQUARE SYNC ===');
      console.log('Selected location:', selectedLocation);
      
      // Sync inventory
      console.log('Calling Square sync for inventory...');
      const inventoryResponse = await supabase.functions.invoke('square-sync', {
        body: { action: 'inventory', locationId: selectedLocation.squareLocationId }
      });

      console.log('Inventory response:', inventoryResponse);
      if (inventoryResponse.error) {
        console.error('Inventory sync error:', inventoryResponse.error);
        throw inventoryResponse.error;
      }

      // Sync sales data
      console.log('Calling Square sync for sales...');
      const salesResponse = await supabase.functions.invoke('square-sync', {
        body: { action: 'sales', locationId: selectedLocation.squareLocationId }
      });

      console.log('Sales response:', salesResponse);
      if (salesResponse.error) {
        console.error('Sales sync error:', salesResponse.error);
        throw salesResponse.error;
      }

      // Process Square data using dedicated parsers
      if (inventoryResponse.data?.inventory) {
        const parsedInventory = parseSquareInventory(inventoryResponse.data.inventory);
        onInventoryDataUpload(parsedInventory);
        setInventoryUploaded(true);
        console.log('Square inventory parsed and uploaded');
      } else {
        console.log('No inventory data in response:', inventoryResponse.data);
      }

      if (salesResponse.data?.sales) {
        const parsedSales = parseSquareSales(salesResponse.data.sales);
        onSalesDataUpload(parsedSales);
        setSalesUploaded(true);
        console.log('Square sales parsed and uploaded');
      } else {
        console.log('No sales data in response:', salesResponse.data);
      }

      toast({
        title: "Success!",
        description: `Synced ${inventoryResponse.data?.inventory?.length || 0} inventory items and ${salesResponse.data?.sales?.length || 0} sales records from Square`,
      });
    } catch (error) {
      console.error('Square sync error:', error);
      toast({
        title: "Square Sync Failed",
        description: error.message || "Failed to sync with Square. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSquareSyncing(false);
    }
  };

  if (!selectedLocation) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Square POS Integration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Please select a Square location to enable automatic syncing.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5" />
          Square POS Integration
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Sync inventory and sales data directly from Square POS using dedicated Square data processing
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
            <div>
              <p className="font-medium">{selectedLocation.name}</p>
              <p className="text-sm text-muted-foreground">{selectedLocation.address}</p>
            </div>
            <Button
              onClick={handleSquareSync}
              disabled={squareSyncing || selectedLocation.status !== 'active'}
              className="flex items-center gap-2"
            >
              {squareSyncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {squareSyncing ? 'Syncing...' : 'Sync from Square'}
            </Button>
          </div>
          
          {salesUploaded && inventoryUploaded && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950 rounded-md">
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                ✓ Successfully synced data from Square POS
              </p>
            </div>
          )}
          
          {selectedLocation.status !== 'active' && (
            <p className="text-sm text-muted-foreground">
              Location must be connected to Square to sync data
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};