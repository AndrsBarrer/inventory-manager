import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, FileText, CheckCircle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

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
}

export const CSVUploader: React.FC<CSVUploaderProps> = ({
  onSalesDataUpload,
  onInventoryDataUpload
}) => {
  const [salesFile, setSalesFile] = useState<File | null>(null);
  const [inventoryFile, setInventoryFile] = useState<File | null>(null);
  const [salesUploaded, setSalesUploaded] = useState(false);
  const [inventoryUploaded, setInventoryUploaded] = useState(false);
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
        .filter(row => row.length >= 3)
        .map(row => ({
          datetime: row[0],
          itemName: row[1],
          quantitySold: parseInt(row[2]) || 0
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
          currentStock: parseInt(row[1]) || 0,
          category: (row[2]?.toLowerCase() as 'beer' | 'wine' | 'cigarettes') || 'beer'
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Sales History Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Sales History (2 Weeks)
          </CardTitle>
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
            Current Inventory
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            <p>Expected format:</p>
            <p className="font-mono text-xs bg-muted p-2 rounded">
              Item Name, Current Stock, Category
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
  );
};