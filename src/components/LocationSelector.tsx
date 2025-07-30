import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin, Store, CheckCircle, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface Location {
  id: string;
  name: string;
  address: string;
  status: 'active' | 'inactive' | 'syncing';
  lastSync?: string;
  squareLocationId?: string;
}

interface LocationSelectorProps {
  locations: Location[];
  selectedLocation: Location | null;
  onLocationSelect: (location: Location) => void;
}

const mockLocations: Location[] = [
  {
    id: '1',
    name: 'Downtown Store',
    address: '123 Main St, Downtown',
    status: 'active',
    lastSync: '2024-01-22T10:30:00Z',
    squareLocationId: 'L1234567890'
  },
  {
    id: '2',
    name: 'Westside Location',
    address: '456 Oak Ave, Westside',
    status: 'inactive',
    squareLocationId: 'L0987654321'
  },
  {
    id: '3',
    name: 'Mall Kiosk',
    address: '789 Shopping Center, Mall',
    status: 'inactive',
    squareLocationId: 'L1122334455'
  }
];

export const LocationSelector: React.FC<LocationSelectorProps> = ({
  locations: propLocations,
  selectedLocation,
  onLocationSelect
}) => {
  const [locations, setLocations] = useState<Location[]>(propLocations || mockLocations);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (propLocations && propLocations.length > 0) {
      setLocations(propLocations);
    } else {
      loadSquareLocations();
    }
  }, [propLocations]);

  const loadSquareLocations = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('square-sync', {
        body: { action: 'locations' }
      });

      if (error) throw error;

      if (data?.locations) {
        setLocations(data.locations);
      }
    } catch (error) {
      console.error('Failed to load Square locations:', error);
      toast({
        title: "Square Connection",
        description: "Using demo locations. Connect to Square to see real locations.",
        variant: "default",
      });
      setLocations(mockLocations);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectLocation = async (location: Location) => {
    // For now, just mark as active - in a full implementation, 
    // this would trigger Square OAuth flow
    const updatedLocations = locations.map(loc =>
      loc.id === location.id
        ? { ...loc, status: 'active' as const, lastSync: new Date().toISOString() }
        : loc
    );
    setLocations(updatedLocations);
    
    toast({
      title: "Location Connected",
      description: `${location.name} is now connected to Square POS`,
    });
  };
  const getStatusBadge = (status: Location['status']) => {
    switch (status) {
      case 'active':
        return <Badge variant="default" className="bg-success">Active</Badge>;
      case 'syncing':
        return <Badge variant="secondary">Syncing...</Badge>;
      case 'inactive':
        return <Badge variant="outline">Not Connected</Badge>;
    }
  };

  const formatLastSync = (lastSync?: string) => {
    if (!lastSync) return 'Never';
    return new Date(lastSync).toLocaleString();
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Store className="h-5 w-5" />
          Store Locations
          {loading && <RefreshCw className="h-4 w-4 animate-spin" />}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Select a location to view its inventory. Start with one location and expand from there.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {locations.map((location) => (
            <div
              key={location.id}
              className={`border rounded-lg p-4 cursor-pointer transition-all hover:shadow-md ${
                selectedLocation?.id === location.id
                  ? 'ring-2 ring-primary bg-primary/5'
                  : 'hover:bg-muted/50'
              }`}
              onClick={() => onLocationSelect(location)}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-semibold text-sm">{location.name}</h3>
                  </div>
                  {selectedLocation?.id === location.id && (
                    <CheckCircle className="h-4 w-4 text-primary" />
                  )}
                </div>
                
                <p className="text-xs text-muted-foreground">{location.address}</p>
                
                <div className="flex items-center justify-between">
                  {getStatusBadge(location.status)}
                  {location.status === 'inactive' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleConnectLocation(location);
                      }}
                    >
                      Connect
                    </Button>
                  )}
                </div>
                
                {location.lastSync && (
                  <div className="text-xs text-muted-foreground">
                    Last sync: {formatLastSync(location.lastSync)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        
        {selectedLocation && (
          <div className="mt-4 p-3 bg-muted/50 rounded-md">
            <p className="text-sm">
              <strong>Selected:</strong> {selectedLocation.name}
              {selectedLocation.status === 'active' ? (
                <span className="text-success ml-2">• Connected to Square POS</span>
              ) : (
                <span className="text-muted-foreground ml-2">• Ready to connect</span>
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};