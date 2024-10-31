import React, { useState, useEffect } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

const OfflineStatus = ({ lastFetchTime, onRefresh, staleDuration = 300000 }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showStaleData, setShowStaleData] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check if data is stale on visibility change
    const handleVisibilityChange = () => {
      if (!document.hidden && lastFetchTime) {
        const timeSinceLastFetch = Date.now() - lastFetchTime;
        setShowStaleData(timeSinceLastFetch > staleDuration);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [lastFetchTime, staleDuration]);

  const handleRefreshClick = async () => {
    setIsLoading(true);
    try {
      await onRefresh();
      setShowStaleData(false);
    } finally {
      setIsLoading(false);
    }
  };

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
          <div className="text-sm mt-1">
            Senast uppdaterad: {formatLastUpdated(lastFetchTime)}
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  if (showStaleData) {
    return (
      <Alert>
        <AlertTitle>Inaktuell data</AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          <div>
            <div>Data kan behöva uppdateras.</div>
            <div className="text-sm">
              Senast uppdaterad: {formatLastUpdated(lastFetchTime)}
            </div>
          </div>
          <button
            onClick={handleRefreshClick}
            disabled={isLoading}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Uppdatera
          </button>
        </AlertDescription>
      </Alert>
    );
  }

  return null;
};

export default OfflineStatus;
