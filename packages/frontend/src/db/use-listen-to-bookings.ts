/**
 * SSE-hook som ersätter use-listen-to-bookings.js (Firestore onSnapshot).
 *
 * Öppnar en SSE-anslutning mot /api/v1/bookings/stream och dispatchhar
 * exakt samma Redux-actions som den gamla Firestore-lyssnaren.
 *
 * Initialladdning:
 *   - Innevarande månad + 3 månader framåt (startOfMonth → endOfMonth+3)
 *   - Om localStorage-cache finns för berörda månader: visa dem direkt,
 *     gör sedan ett delta-sync (?since=<senaste cachedAt>) för att hämta
 *     ändringar sedan förra sessionen.
 */
import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  format,
  startOfMonth,
  endOfMonth,
  addMonths,
  isBefore,
  endOfDay,
  parseISO,
} from 'date-fns';
import {
  setBookingsLoading,
  setBookingsRange,
  addMultipleBookings,
  addOrUpdateBooking,
  removeBooking,
  setBookings,
  markMonthsLoaded,
} from '@/store';
import type { AppStore, DateCarBooking } from '@/store';
import { bookingsApi } from '@/api/bookings';
import {
  bookingCacheRead,
  bookingCacheWrite,
  bookingCacheMonthKey,
} from '@/lib/booking-cache';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

/** Månader som ska laddas vid start: innevarande + 3 framåt */
function defaultDateRange() {
  const now = new Date();
  return {
    startDate: format(startOfMonth(now), 'yyyy-MM-dd'),
    endDate: format(endOfMonth(addMonths(now, 3)), 'yyyy-MM-dd'),
  };
}

/** Räkna ut alla "yyyy-MM"-nycklar som spänner startDate–endDate */
function monthKeysInRange(startDate: string, endDate: string): string[] {
  const keys: string[] = [];
  let cursor = startOfMonth(parseISO(startDate));
  const end = startOfMonth(parseISO(endDate));
  while (!isBefore(end, cursor)) {
    keys.push(format(cursor, 'yyyy-MM'));
    cursor = addMonths(cursor, 1);
  }
  return keys;
}

export function useListenToBookings() {
  const dispatch = useDispatch();
  const uid = useSelector((state: AppStore) => state.auth.user?.uid);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!uid) return;

    const { startDate, endDate } = defaultDateRange();
    dispatch(setBookingsRange({ startDate, endDate }));

    const monthKeys = monthKeysInRange(startDate, endDate);

    // --- 1. Ladda från localStorage-cache direkt ---
    const allCached: DateCarBooking[] = [];
    let oldestCachedAt: string | null = null;

    for (const key of monthKeys) {
      const entry = bookingCacheRead(key);
      if (entry) {
        allCached.push(...entry.bookings);
        if (!oldestCachedAt || entry.cachedAt < oldestCachedAt) {
          oldestCachedAt = entry.cachedAt;
        }
      }
    }

    if (allCached.length > 0) {
      // Visa cachad data direkt — UI renderas utan nätverksrundtur
      dispatch(setBookings(allCached));
      dispatch(markMonthsLoaded(monthKeys));
    } else {
      dispatch(setBookingsLoading(true));
    }

    // --- 2. Hämta från backend ---
    // Om vi har cache: delta-sync med ?since= (hämtar bara ändrade rader)
    // Annars: fullständig hämtning av hela fönstret
    const fetchPromise = oldestCachedAt
      ? bookingsApi.list(startDate, endDate, oldestCachedAt)
      : bookingsApi.list(startDate, endDate);

    fetchPromise
      .then((res) => {
        if (oldestCachedAt) {
          // Delta: slå ihop med vad vi redan har
          dispatch(addMultipleBookings(res.bookings));
        } else {
          dispatch(setBookings(res.bookings));
        }
        dispatch(markMonthsLoaded(monthKeys));

        // Spara/uppdatera cache per månad — ej låsta månader cachas med ny tidsstämpel
        const now = new Date().toISOString();
        const today = endOfDay(new Date());
        for (const key of monthKeys) {
          const isLocked = isBefore(parseISO(key + '-28'), today) &&
            isBefore(endOfMonth(parseISO(key + '-01')), today);

          if (!isLocked) {
            // Framtida/innevarande: uppdatera alltid cache
            const monthBookings = res.bookings.filter(b =>
              b.date.startsWith(key)
            );
            // Slå ihop med befintlig cache (delta-sync ersätter bara ändrade)
            const existing = bookingCacheRead(key)?.bookings ?? [];
            const merged = mergeBookings(existing, monthBookings);
            bookingCacheWrite(key, merged, now);
          } else {
            // Låst månad: cachas permanent om vi fick data från backend
            const cached = bookingCacheRead(key);
            if (!cached) {
              const monthBookings = res.bookings.filter(b =>
                b.date.startsWith(key)
              );
              bookingCacheWrite(key, monthBookings, now);
            }
          }
        }
      })
      .catch((err) => {
        console.error('[bookings] initial load failed:', err);
      })
      .finally(() => {
        dispatch(setBookingsLoading(false));
      });

    // --- 3. SSE stream för live-uppdateringar ---
    const openStream = () => {
      const url = `${API_BASE}/bookings/stream`;
      const es = new EventSource(url, { withCredentials: true });
      esRef.current = es;

      const t0 = performance.now();
      let firstEvent = true;

      const handleEvent = (type: 'add' | 'update' | 'remove') => (e: MessageEvent) => {
        if (firstEvent) {
          firstEvent = false;
          console.log(`[perf] bookings first SSE event in ${Math.round(performance.now() - t0)}ms`);
        }
        const data = JSON.parse(e.data) as DateCarBooking;

        // Uppdatera localStorage-cache för den berörda månaden
        if (type !== 'remove') {
          const monthKey = bookingCacheMonthKey(data.date);
          const existing = bookingCacheRead(monthKey)?.bookings ?? [];
          const updated = mergeBookings(existing, [data]);
          bookingCacheWrite(monthKey, updated, new Date().toISOString());
        }

        switch (type) {
          case 'add':    dispatch(addOrUpdateBooking(data)); break;
          case 'update': dispatch(addOrUpdateBooking(data)); break;
          case 'remove': dispatch(removeBooking(data));      break;
        }
      };

      es.addEventListener('add',    handleEvent('add'));
      es.addEventListener('update', handleEvent('update'));
      es.addEventListener('remove', handleEvent('remove'));

      es.onerror = (err) => {
        console.error('[bookings] SSE error', err);
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

/** Slå ihop två arrays av DateCarBooking — nyare (incoming) vinner vid kollision på id */
function mergeBookings(existing: DateCarBooking[], incoming: DateCarBooking[]): DateCarBooking[] {
  const map = new Map<string, DateCarBooking>();
  for (const b of existing) map.set(b.id, b);
  for (const b of incoming) map.set(b.id, b);
  return Array.from(map.values());
}
