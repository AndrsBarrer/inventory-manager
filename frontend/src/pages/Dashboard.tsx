import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { InventoryDashboard } from '@/components/InventoryDashboard';
import { Plus } from 'lucide-react';

const Dashboard = () => {
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Check if user is authenticated
    const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';

    if (!isAuthenticated) {
      navigate('/');
    } else {
      setLoading(false);
    }
  }, [navigate]);

  const handleSignOut = () => {
    localStorage.removeItem('isAuthenticated');
    navigate('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 px-4">
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h1
              className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 mb-1 cursor-pointer hover:text-blue-600 transition-colors duration-300"
              onClick={() => navigate('/')}
            >
              Inventory Dashboard
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Insights on stock levels and suggested orders
            </p>

          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={handleSignOut}>
              Sign Out
            </Button>
          </div>
        </div>
        <InventoryDashboard />
      </div>
    </div>
  );
};

export default Dashboard;