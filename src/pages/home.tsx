import React from 'react';
import { getAuth, signOut } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAccessibility } from '../lib/utils';
import { useTheme } from '@/components/theme-context';
import { Sun, Moon } from 'lucide-react';

export const HomePage = () => {
  const { settings, updateSettings } = useAccessibility();
  const { darkMode, toggleDarkMode } = useTheme();
  const auth = getAuth();

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex gap-4 mb-8">
          <Button 
            variant="outline" 
            onClick={() => signOut(auth)}
          >
            Logga ut
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Inställningar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <span className="font-medium">Hög kontrast</span>
              <Button
                variant="outline"
                onClick={() => updateSettings({ isHighContrast: !settings.isHighContrast })}
              >
                {settings.isHighContrast ? 'På' : 'Av'}
              </Button>
            </div>

            <div className="flex items-center justify-between">
              <span className="font-medium">Textstorlek</span>
              <Select
                value={settings.textSize}
                onValueChange={(value) => updateSettings({ textSize: value as TextSize })}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Välj textstorlek" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal text</SelectItem>
                  <SelectItem value="large">Stor text</SelectItem>
                  <SelectItem value="larger">Större text</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <span className="font-medium">Mörkt/Ljust läge</span>
              <Button 
                variant="outline"
                onClick={toggleDarkMode}
                size="icon"
              >
                {darkMode ? <Sun size={20} /> : <Moon size={20} />}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
