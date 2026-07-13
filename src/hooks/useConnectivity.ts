import { useCallback, useEffect, useState } from 'react';
import { getOfflineQueueCount, OFFLINE_QUEUE_EVENT } from '../sync/offlineQueue';

export function useConnectivity() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pendingChanges, setPendingChanges] = useState(0);

  const refreshQueue = useCallback(async () => {
    setPendingChanges(await getOfflineQueueCount());
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      window.setTimeout(() => void refreshQueue(), 300);
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener(OFFLINE_QUEUE_EVENT, refreshQueue);
    void refreshQueue();
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener(OFFLINE_QUEUE_EVENT, refreshQueue);
    };
  }, [refreshQueue]);

  return { online, pendingChanges };
}
