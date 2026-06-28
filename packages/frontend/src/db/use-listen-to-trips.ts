/**
 * SSE-hook för körloggen (Trips).
 *
 * Trips lämpar sig utmärkt för caching: rader ändras i praktiken aldrig
 * (odo-monoton validering säkerställer detta) och det enda som tillkommer
 * är nya rader. Cachen är därmed permanent och delta-sync hämtar enbart
 * rader med timestamp > cachedAt sedan förra sessionen.
 *
 * Flöde vid appstart:
 *   1. Finns localStorage-cache? → dispatcha direkt till Redux (0 nätverksfördröjning).
 *   2. Delta-sync: GET /trips?since=<cachedAt> → slå ihop med cache → spara tillbaka.
 *   3. Ingen cache: full hämtning (senaste 30 dagar), spara till cache.
 *   4. SSE-stream: varje ny/uppdaterad/raderad trip slår igenom direkt i Redux
 *      och skrivs in i cachen.
 *
 * Delete-händelser invaliderar hela cachen och triggar en full re-fetch,
 * eftersom vi inte kan veta vilka rader som tagits bort ur en cached lista.
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
import { tripsApi, type TripDto } from '@/api/trips';
import {
  tripCacheRead,
  tripCacheWrite,
  tripCacheInvalidate,
  mergeTripCache,
} from '@/lib/trip-cache';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

export function useListenToTrips() {
  const dispatch = useDispatch();
  const uid = useSelector((state: AppStore) => state.auth.user?.uid);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!uid) return;

    let cancelled = false;

    const load = async () => {
      const cached = tripCacheRead();

      if (cached && cached.trips.length > 0) {
        // --- 1. Visa cachad data direkt (ingen nätverksfördröjning) ---
        dispatch(setTrips(cached.trips as any));

        // --- 2. Delta-sync: hämta enbart rader sedan förra sessionen ---
        try {
          const fresh = await tripsApi.list(cached.cachedAt);
          if (cancelled) return;

          if (fresh.length > 0) {
            // Slå ihop med cache (nyare rader vinner)
            const merged = mergeTripCache(cached.trips, fresh);
            tripCacheWrite(merged, new Date().toISOString());
            dispatch(setTrips(merged as any));
          } else {
            // Inget nytt — uppdatera bara cachedAt-tidsstämpeln
            tripCacheWrite(cached.trips, new Date().toISOString());
          }
        } catch (err) {
          console.warn('[trips] delta-sync misslyckades (cache används):', err);
        }
      } else {
        // --- 3. Ingen cache: full hämtning ---
        dispatch(setTripsLoading(true));
        try {
          const trips = await tripsApi.list();
          if (cancelled) return;
          tripCacheWrite(trips, new Date().toISOString());
          dispatch(setTrips(trips as any));
        } catch (err) {
          console.error('[trips] initial load misslyckades:', err);
        } finally {
          dispatch(setTripsLoading(false));
        }
      }
    };

    load();

    // --- 4. SSE-stream för live-uppdateringar ---
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
        const data = JSON.parse(e.data) as TripDto & { id: string };

        if (type === 'remove') {
          // Ta bort ur Redux
          dispatch(removeTrip(data));
          // Invalidera hela cachen — full re-fetch nästa session
          tripCacheInvalidate();
        } else {
          // Lägg till / uppdatera i Redux
          dispatch(addOrUpdateTrip(data as any));
          // Skriv in i cache (mergeTripCache hanterar insert + replace)
          const existing = tripCacheRead()?.trips ?? [];
          const merged = mergeTripCache(existing, [data as TripDto]);
          tripCacheWrite(merged, new Date().toISOString());
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
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
    };
  }, [uid, dispatch]);
}
