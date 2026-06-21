/**
 * SSE-hook som ersätter use-listen-to-bookings.js (Firestore onSnapshot).
 *
 * Öppnar en SSE-anslutning mot /api/v1/bookings/stream och dispatchhar
 * exakt samma Redux-actions som den gamla Firestore-lyssnaren.
 */
import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { addDays, format, startOfDay } from 'date-fns';
import {
  setBookingsLoading,
  setBookingsRange,
  addMultipleBookings,
  addOrUpdateBooking,
  removeBooking,
  setBookings,
} from '@/store';
import type { AppStore, DateCarBooking } from '@/store';
import { bookingsApi } from '@/api/bookings';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

function defaultDateRange() {
  const pastDays = 15;
  const totalDays = 14 * 8;
  const start = addDays(startOfDay(new Date()), -pastDays);
  return {
    startDate: format(start, 'yyyy-MM-dd'),
    endDate: format(addDays(start, totalDays), 'yyyy-MM-dd'),
  };
}

export function useListenToBookings() {
  const dispatch = useDispatch();
  const uid = useSelector((state: AppStore) => state.auth.user?.uid);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!uid) return;

    // 1. Initial load via REST
    const { startDate, endDate } = defaultDateRange();
    dispatch(setBookingsLoading(true));
    dispatch(setBookingsRange({ startDate, endDate }));

    bookingsApi.list(startDate, endDate).then((res) => {
      dispatch(setBookings(res.bookings));
      dispatch(setBookingsLoading(false));
    }).catch((err) => {
      console.error('[bookings] initial load failed:', err);
      dispatch(setBookingsLoading(false));
    });

    // 2. SSE stream for live updates — session-cookie autentiserar automatiskt
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
