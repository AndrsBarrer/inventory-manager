import { InventoryDashboard } from '@/components/InventoryDashboard';

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Liquor Store Inventory System</h1>
          <p className="text-muted-foreground">Manage your inventory, track stock levels, and create reorder requests</p>
        </div>
        <InventoryDashboard />
      </div>
    </div>
  );
};

export default Index;
