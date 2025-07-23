import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings, Save, Edit } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface StockRule {
  id: string;
  itemName: string;
  category: 'beer' | 'wine' | 'cigarettes';
  minimumStock: number;
  daysOfSupply: number;
  notes?: string;
}

interface StockConfigurationProps {
  stockRules: StockRule[];
  onUpdateStockRules: (rules: StockRule[]) => void;
  inventoryItems: string[];
}

export const StockConfiguration: React.FC<StockConfigurationProps> = ({
  stockRules,
  onUpdateStockRules,
  inventoryItems
}) => {
  const [editingRule, setEditingRule] = useState<StockRule | null>(null);
  const [newRule, setNewRule] = useState<Partial<StockRule>>({
    itemName: '',
    category: 'beer',
    minimumStock: 0,
    daysOfSupply: 7
  });

  const handleSaveRule = () => {
    if (editingRule) {
      // Update existing rule
      const updatedRules = stockRules.map(rule =>
        rule.id === editingRule.id ? editingRule : rule
      );
      onUpdateStockRules(updatedRules);
      setEditingRule(null);
    } else {
      // Add new rule
      if (newRule.itemName && newRule.category) {
        const rule: StockRule = {
          id: Date.now().toString(),
          itemName: newRule.itemName,
          category: newRule.category,
          minimumStock: newRule.minimumStock || 0,
          daysOfSupply: newRule.daysOfSupply || 7,
          notes: newRule.notes
        };
        onUpdateStockRules([...stockRules, rule]);
        setNewRule({
          itemName: '',
          category: 'beer',
          minimumStock: 0,
          daysOfSupply: 7
        });
      }
    }
  };

  const handleDeleteRule = (ruleId: string) => {
    const updatedRules = stockRules.filter(rule => rule.id !== ruleId);
    onUpdateStockRules(updatedRules);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Stock Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Add New Rule */}
        <div className="border rounded-lg p-4 space-y-4">
          <h3 className="font-semibold">Add New Stock Rule</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Item Name</Label>
              <Select
                value={newRule.itemName}
                onValueChange={(value) => setNewRule({ ...newRule, itemName: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select item" />
                </SelectTrigger>
                <SelectContent>
                  {inventoryItems.map(item => (
                    <SelectItem key={item} value={item}>{item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={newRule.category}
                onValueChange={(value: 'beer' | 'wine' | 'cigarettes') => 
                  setNewRule({ ...newRule, category: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beer">Beer</SelectItem>
                  <SelectItem value="wine">Wine</SelectItem>
                  <SelectItem value="cigarettes">Cigarettes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Minimum Stock</Label>
              <Input
                type="number"
                value={newRule.minimumStock}
                onChange={(e) => setNewRule({ ...newRule, minimumStock: parseInt(e.target.value) || 0 })}
                placeholder="0"
              />
            </div>
            
            <div className="space-y-2">
              <Label>Days of Supply</Label>
              <Input
                type="number"
                value={newRule.daysOfSupply}
                onChange={(e) => setNewRule({ ...newRule, daysOfSupply: parseInt(e.target.value) || 7 })}
                placeholder="7"
              />
            </div>
          </div>
          
          <Button onClick={handleSaveRule} className="w-full md:w-auto">
            <Save className="h-4 w-4 mr-2" />
            Add Rule
          </Button>
        </div>

        {/* Existing Rules */}
        <div className="space-y-4">
          <h3 className="font-semibold">Current Stock Rules ({stockRules.length})</h3>
          {stockRules.length === 0 ? (
            <p className="text-muted-foreground">No stock rules configured yet.</p>
          ) : (
            <div className="space-y-3">
              {stockRules.map(rule => (
                <div key={rule.id} className="border rounded-lg p-4">
                  {editingRule?.id === rule.id ? (
                    // Edit mode
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="space-y-2">
                        <Label>Item Name</Label>
                        <Input
                          value={editingRule.itemName}
                          onChange={(e) => setEditingRule({ ...editingRule, itemName: e.target.value })}
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label>Category</Label>
                        <Select
                          value={editingRule.category}
                          onValueChange={(value: 'beer' | 'wine' | 'cigarettes') => 
                            setEditingRule({ ...editingRule, category: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="beer">Beer</SelectItem>
                            <SelectItem value="wine">Wine</SelectItem>
                            <SelectItem value="cigarettes">Cigarettes</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div className="space-y-2">
                        <Label>Minimum Stock</Label>
                        <Input
                          type="number"
                          value={editingRule.minimumStock}
                          onChange={(e) => setEditingRule({ ...editingRule, minimumStock: parseInt(e.target.value) || 0 })}
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label>Days of Supply</Label>
                        <Input
                          type="number"
                          value={editingRule.daysOfSupply}
                          onChange={(e) => setEditingRule({ ...editingRule, daysOfSupply: parseInt(e.target.value) || 7 })}
                        />
                      </div>
                      
                      <div className="flex gap-2 md:col-span-4">
                        <Button onClick={handleSaveRule} size="sm">
                          <Save className="h-4 w-4 mr-2" />
                          Save
                        </Button>
                        <Button 
                          variant="outline" 
                          onClick={() => setEditingRule(null)} 
                          size="sm"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // View mode
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div>
                          <div className="font-medium">{rule.itemName}</div>
                          <div className="text-sm text-muted-foreground">
                            Min Stock: {rule.minimumStock} | Days Supply: {rule.daysOfSupply}
                          </div>
                        </div>
                        <Badge variant="outline" className="capitalize">
                          {rule.category}
                        </Badge>
                      </div>
                      
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingRule(rule)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteRule(rule.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
