/**
 * SSE-hook som ersätter use-listen-to-trips.ts (Firestore onSnapshot).
 */
import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  setTripsLoading,
  setTrips,
  addOrUpdateTrip,
  removeTrip,
} from '@/store';
import type { AppStore } from '@/store';
import { tripsApi } from '@/api/trips';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

export function useListenToTrips() {
  const dispatch = useDispatch();
  const uid = useSelector((state: AppStore) => state.auth.user?.uid);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!uid) return;

    // 1. Initial load
    dispatch(setTripsLoading(true));
    tripsApi.list().then((trips) => {
      dispatch(setTrips(trips as any));
      dispatch(setTripsLoading(false));
    }).catch((err) => {
      console.error('[trips] initial load failed:', err);
      dispatch(setTripsLoading(false));
    });

    // 2. SSE for live updates — session-cookie autentiserar automatiskt
    const openStream = () => {
      const url = `${API_BASE}/trips/stream`;
      const es = new EventSource(url, { withCredentials: true });
      esRef.current = es;

      const t0 = performance.now();
      let firstEvent = true;

      const handle = (type: 'add' | 'update' | 'remove') => (e: MessageEvent) => {
        if (firstEvent) {
          firstEvent = false;
          console.log(`[perf] trips first SSE event in ${Math.round(performance.now() - t0)}ms`);
        }
        const data = JSON.parse(e.data);
        switch (type) {
          case 'add':    dispatch(addOrUpdateTrip(data)); break;
          case 'update': dispatch(addOrUpdateTrip(data)); break;
          case 'remove': dispatch(removeTrip(data));      break;
        }
      };

      es.addEventListener('add',    handle('add'));
      es.addEventListener('update', handle('update'));
      es.addEventListener('remove', handle('remove'));

      es.onerror = (err) => {
        console.error('[trips] SSE error', err);
        es.close();
        setTimeout(openStream, 5000);
      };
    };

    openStream();

    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [uid, dispatch]);
}
