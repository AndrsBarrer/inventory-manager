import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, FileText, CheckCircle, Loader2, RefreshCw } from 'lucide-react';
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

interface CSVUploaderProps {
  onSalesDataUpload: (data: SalesRecord[]) => void;
  onInventoryDataUpload: (data: InventoryRecord[]) => void;
  selectedLocation?: Location | null;
}

export const CSVUploader: React.FC<CSVUploaderProps> = ({
  onSalesDataUpload,
  onInventoryDataUpload,
  selectedLocation
}) => {
  const [salesFile, setSalesFile] = useState<File | null>(null);
  const [inventoryFile, setInventoryFile] = useState<File | null>(null);
  const [salesUploaded, setSalesUploaded] = useState(false);
  const [inventoryUploaded, setInventoryUploaded] = useState(false);
  const [squareSyncing, setSquareSyncing] = useState(false);
  const { toast } = useToast();

  const parseCSV = (text: string): string[][] => {
    const lines = text.trim().split('\n');
    return lines.map(line => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    });
  };

  const handleSalesUpload = async () => {
    if (!salesFile) return;

    try {
      const text = await salesFile.text();
      const rows = parseCSV(text);
      
      // Skip header row
      const dataRows = rows.slice(1);
      
      const salesData: SalesRecord[] = dataRows
        .filter(row => row.length >= 9) // Need at least 9 columns for quantity at the end
        .map(row => ({
          datetime: row[0],
          itemName: row[1],
          quantitySold: parseInt(row[row.length - 1]) || 0 // Quantity is in the last column
        }));

      onSalesDataUpload(salesData);
      setSalesUploaded(true);
      toast({
        title: "Success",
        description: `Uploaded ${salesData.length} sales records`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to parse sales CSV file",
        variant: "destructive",
      });
    }
  };

  const handleInventoryUpload = async () => {
    if (!inventoryFile) return;

    try {
      const text = await inventoryFile.text();
      const rows = parseCSV(text);
      
      // Skip header row
      const dataRows = rows.slice(1);
      
      const inventoryData: InventoryRecord[] = dataRows
        .filter(row => row.length >= 3)
        .map(row => ({
          itemName: row[0],
          category: (row[1]?.toLowerCase() as 'beer' | 'wine' | 'cigarettes') || 'beer',
          currentStock: parseInt(row[2]) || 0
        }));

      onInventoryDataUpload(inventoryData);
      setInventoryUploaded(true);
      toast({
        title: "Success",
        description: `Uploaded ${inventoryData.length} inventory records`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to parse inventory CSV file",
        variant: "destructive",
      });
    }
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
      // Sync inventory
      const inventoryResponse = await supabase.functions.invoke('square-sync', {
        body: { action: 'inventory', locationId: selectedLocation.squareLocationId }
      });

      if (inventoryResponse.error) throw inventoryResponse.error;

      // Sync sales data
      const salesResponse = await supabase.functions.invoke('square-sync', {
        body: { action: 'sales', locationId: selectedLocation.squareLocationId }
      });

      if (salesResponse.error) throw salesResponse.error;

      // Update the app with Square data
      if (inventoryResponse.data?.inventory) {
        onInventoryDataUpload(inventoryResponse.data.inventory);
        setInventoryUploaded(true);
      }

      if (salesResponse.data?.sales) {
        onSalesDataUpload(salesResponse.data.sales);
        setSalesUploaded(true);
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

  return (
    <div className="space-y-6 mb-6">
      {/* Square Sync Section */}
      {selectedLocation && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Square POS Integration
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Sync inventory and sales data directly from Square POS
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
              {selectedLocation.status !== 'active' && (
                <p className="text-sm text-muted-foreground">
                  Location must be connected to Square to sync data
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual CSV Upload Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Sales History Upload */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Sales History (Manual Upload)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Upload CSV with columns: datetime, itemName, quantitySold
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground">
              <p>Expected format:</p>
              <p className="font-mono text-xs bg-muted p-2 rounded">
                Date/Time, Item Name, How many Sold
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="sales-file">Select Sales CSV File</Label>
              <Input
                id="sales-file"
                type="file"
                accept=".csv"
                onChange={(e) => setSalesFile(e.target.files?.[0] || null)}
              />
            </div>
            
            <Button
              onClick={handleSalesUpload}
              disabled={!salesFile || salesUploaded}
              className="w-full"
            >
              {salesUploaded ? (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Sales Data Uploaded
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Sales Data
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Current Inventory Upload */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Current Inventory (Manual Upload)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Upload CSV with columns: itemName, currentStock, category
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground">
              <p>Expected format:</p>
              <p className="font-mono text-xs bg-muted p-2 rounded">
                Item Name, Categories, Current Quantity
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="inventory-file">Select Inventory CSV File</Label>
              <Input
                id="inventory-file"
                type="file"
                accept=".csv"
                onChange={(e) => setInventoryFile(e.target.files?.[0] || null)}
              />
            </div>
            
            <Button
              onClick={handleInventoryUpload}
              disabled={!inventoryFile || inventoryUploaded}
              className="w-full"
            >
              {inventoryUploaded ? (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Inventory Data Uploaded
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Inventory Data
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};