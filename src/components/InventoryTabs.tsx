import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, RefreshCw } from 'lucide-react';
import { ManualUploadTab } from './ManualUploadTab';
import { SquareSyncTab } from './SquareSyncTab';
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

interface InventoryTabsProps {
  onSalesDataUpload: (data: SalesRecord[]) => void;
  onInventoryDataUpload: (data: InventoryRecord[]) => void;
  selectedLocation?: Location | null;
}

export const InventoryTabs: React.FC<InventoryTabsProps> = ({
  onSalesDataUpload,
  onInventoryDataUpload,
  selectedLocation
}) => {
  return (
    <div className="space-y-6 mb-6">
      <Tabs defaultValue="manual" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="manual" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Manual Upload
          </TabsTrigger>
          <TabsTrigger value="square" className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Square Sync
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="manual" className="mt-6">
          <ManualUploadTab
            onSalesDataUpload={onSalesDataUpload}
            onInventoryDataUpload={onInventoryDataUpload}
          />
        </TabsContent>
        
        <TabsContent value="square" className="mt-6">
          <SquareSyncTab
            onSalesDataUpload={onSalesDataUpload}
            onInventoryDataUpload={onInventoryDataUpload}
            selectedLocation={selectedLocation}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};