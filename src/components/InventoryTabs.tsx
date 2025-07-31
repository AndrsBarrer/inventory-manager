import React from 'react';
import { Upload } from 'lucide-react';
import { ManualUploadTab } from './ManualUploadTab';

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
}

export const InventoryTabs: React.FC<InventoryTabsProps> = ({
  onSalesDataUpload,
  onInventoryDataUpload
}) => {
  return (
    <div className="space-y-6 mb-6">
      <div className="w-full">
        <div className="flex items-center gap-2 mb-6">
          <Upload className="h-5 w-5" />
          <h3 className="text-lg font-semibold">Upload Data</h3>
        </div>
        
        <ManualUploadTab
          onSalesDataUpload={onSalesDataUpload}
          onInventoryDataUpload={onInventoryDataUpload}
        />
      </div>
    </div>
  );
};