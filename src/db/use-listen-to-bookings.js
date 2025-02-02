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
  addOrUpdateBooking,
  removeBooking
} from '../store';

const convertBooking = (doc) => {
  const data = doc.data();
  return {
    parent_id: doc.id,
    parent_ref: doc.ref,
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

export function useListenToBookings(startDate, endDate) {
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

    const bookingsRef = collection(db, 'date-car-bookings');

    const q = query(
      bookingsRef,
      where('date', '>=', startDate),
      where('date', '<=', endDate),
      orderBy('date', 'asc')
    );

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
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [startDate, endDate, handleSnapshot, dispatch]);

  return {
    bookings: existingBookings,
    loading: useSelector(state => state.booking.loading)
  };
}
