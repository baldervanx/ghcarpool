import { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

const OfflineStatus = ({ lastFetchTime }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const formatLastUpdated = (timestamp) => {
    if (!timestamp) return 'Aldrig';
    const date = new Date(timestamp);
    return date.toLocaleString('sv-SE');
  };

  if (!isOnline) {
    return (
      <Alert>
        <WifiOff className="h-4 w-4" />
        <AlertTitle>Offline-läge</AlertTitle>
        <AlertDescription>
          Du är offline. Data som visas kan vara inaktuellt.
          {lastFetchTime && (
              <div className="text-sm mt-1">
                Senast uppdaterad: {formatLastUpdated(lastFetchTime)}
              </div>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return null;
};

export default OfflineStatus;
