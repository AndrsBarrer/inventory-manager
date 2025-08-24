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
              className="text-3xl font-inter font-light tracking-wide bg-gradient-to-r from-slate-300 via-white to-slate-300 bg-clip-text text-transparent mb-2 cursor-pointer hover:from-slate-200 hover:via-slate-100 hover:to-slate-200 transition-all duration-300 drop-shadow-lg"
              style={{
                textShadow: '0 0 1px rgba(0,0,0,0.5), 0 0 2px rgba(0,0,0,0.3)',
                WebkitTextStroke: '0.5px rgba(100,100,100,0.3)'
              }}
              onClick={() => navigate('/')}
            >
              Inventory Manager
            </h1>
            <p className="text-muted-foreground">Manage your inventory and track stock levels</p>
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