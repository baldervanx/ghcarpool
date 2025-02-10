// Create a new hook: use-listen-to-bookings.ts
import { useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  collection,
  query,
  orderBy,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/db/firebase';
import {
  setBookingsLoading,
  setBookingsRange,
  addOrUpdateBooking,
  removeBooking
} from '../store';
import {addDays, format, startOfDay} from "date-fns";

const convertBooking = (doc) => {
  const data = doc.data();
  return {
    id: doc.id,
    date: data.date,
    car: { id: data.car.id },
    bookings: data.bookings.map(booking => ({
      ...booking,
      users: booking.users.map(user => ({ id: user.id })),
      byUser: { id: booking.byUser.id },
      parent_id: doc.id
    }))
  };
};

export function useListenToBookings() {
  const dispatch = useDispatch();
  const existingBookings = useSelector(state => state.booking.bookings);
  const unsubscribeRef = useRef(null);

  const handleSnapshot = useCallback((snapshot) => {
    dispatch(setBookingsLoading(false));

    snapshot.docChanges().forEach((change) => {
      const booking = convertBooking(change.doc);
      console.log("Change %s, booking date=%s, bookings=%o", change.type, booking.date, booking.bookings);
      switch (change.type) {
        case 'added':
          dispatch(addOrUpdateBooking(booking));
          break;
        case 'modified':
          dispatch(addOrUpdateBooking(booking));
          break;
        case 'removed':
          dispatch(removeBooking(booking));
          break;
      }
    });
  }, [dispatch]);

  useEffect(() => {
    dispatch(setBookingsLoading(true));
    const daysPerPage = 14;
    const pageCount = 8;
    const pastDays = daysPerPage + 1;
    const futureDays = daysPerPage * (pageCount - 1) - 1; // About 3 months

    const startDate = format(addDays(startOfDay(new Date()), -pastDays), 'yyyy-MM-dd');
    const endDate = format(addDays(new Date(startDate), futureDays), 'yyyy-MM-dd');
    dispatch(setBookingsRange({startDate, endDate}));

    const bookingsRef = collection(db, 'date-car-bookings');

    const q = query(
      bookingsRef,
      where('date', '>=', startDate),
      where('date', '<=', endDate),
      orderBy('date', 'asc')
    );

    console.log(`Loading bookings for ${startDate}-${endDate}`);
    unsubscribeRef.current = onSnapshot(
      q,
      handleSnapshot,
      (error) => {
        console.error('Error fetching bookings:', error);
        dispatch(setBookingsLoading(false));
      }
    );

    return () => {
      if (unsubscribeRef.current) {
        console.log("Unsubscribing bookings");
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [handleSnapshot, dispatch]);

  return {
    bookings: existingBookings,
    loading: useSelector(state => state.booking.loading)
  };
}
