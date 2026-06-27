/**
 * use-booking-month-loader.ts
 *
 * Hook som lazy-laddar en månad on-demand när användaren navigerar bakåt.
 *
 * Flöde:
 *   1. Är månaden redan laddad i Redux (loadedMonths)? → inget nätverksanrop.
 *   2. Finns den i localStorage-cache och är månaden låst? → dispatcha direkt från cache.
 *   3. Annars → fetch från backend, uppdatera Redux + cache.
 *
 * Returnerar { loadMonth } som booking-overview.tsx anropar vid sidnavigering.
 */

import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import type { AppStore, DateCarBooking } from '@/store';
import {
  addMultipleBookings,
  markMonthsLoaded,
  setLoadingMonth,
} from '@/store';
import { bookingsApi } from '@/api/bookings';
import {
  bookingCacheRead,
  bookingCacheWrite,
  isMonthLocked,
} from '@/lib/booking-cache';

export function useBookingMonthLoader() {
  const dispatch = useDispatch();
  const loadedMonths = useSelector((state: AppStore) => state.booking.loadedMonths);
  const loadingMonths = useSelector((state: AppStore) => state.booking.loadingMonths);

  /**
   * Ladda en månad om den inte redan finns i Redux.
   * @param monthKey  "yyyy-MM" — t.ex. "2026-04"
   */
  const loadMonth = useCallback(
    async (monthKey: string) => {
      // Redan laddad eller håller på att laddas
      if (loadedMonths.includes(monthKey) || loadingMonths.includes(monthKey)) {
        return;
      }

      dispatch(setLoadingMonth({ month: monthKey, loading: true }));

      // Kolla localStorage
      const cached = bookingCacheRead(monthKey);
      if (cached) {
        // Har vi cache: dispatcha direkt, markera laddad
        dispatch(addMultipleBookings(cached.bookings));
        dispatch(markMonthsLoaded([monthKey]));

        // Låst månad: cache är permanent, klar här
        if (isMonthLocked(monthKey)) {
          dispatch(setLoadingMonth({ month: monthKey, loading: false }));
          return;
        }

        // Icke-låst månad med cache: gör delta-sync för att fånga ändringar
        try {
          const start = format(startOfMonth(parseISO(monthKey + '-01')), 'yyyy-MM-dd');
          const end = format(endOfMonth(parseISO(monthKey + '-01')), 'yyyy-MM-dd');
          const res = await bookingsApi.list(start, end, cached.cachedAt);
          if (res.bookings.length > 0) {
            dispatch(addMultipleBookings(res.bookings));
            // Uppdatera cache med merged data
            const existing = cached.bookings;
            const merged = mergeBookings(existing, res.bookings);
            bookingCacheWrite(monthKey, merged, new Date().toISOString());
          }
        } catch (err) {
          console.warn(`[booking-month-loader] delta-sync för ${monthKey} misslyckades:`, err);
        }
        dispatch(markMonthsLoaded([monthKey]));
        return;
      }

      // Ingen cache: full hämtning
      try {
        const start = format(startOfMonth(parseISO(monthKey + '-01')), 'yyyy-MM-dd');
        const end = format(endOfMonth(parseISO(monthKey + '-01')), 'yyyy-MM-dd');
        const res = await bookingsApi.list(start, end);
        dispatch(addMultipleBookings(res.bookings));

        // Spara i cache
        const monthBookings = res.bookings.filter(b => b.date.startsWith(monthKey));
        bookingCacheWrite(monthKey, monthBookings, new Date().toISOString());

        dispatch(markMonthsLoaded([monthKey]));
      } catch (err) {
        console.error(`[booking-month-loader] fetch för ${monthKey} misslyckades:`, err);
        dispatch(setLoadingMonth({ month: monthKey, loading: false }));
      }
    },
    [dispatch, loadedMonths, loadingMonths],
  );

  return { loadMonth };
}

/** Slå ihop två arrays av DateCarBooking — nyare (incoming) vinner vid kollision på id */
function mergeBookings(existing: DateCarBooking[], incoming: DateCarBooking[]): DateCarBooking[] {
  const map = new Map<string, DateCarBooking>();
  for (const b of existing) map.set(b.id, b);
  for (const b of incoming) map.set(b.id, b);
  return Array.from(map.values());
}
