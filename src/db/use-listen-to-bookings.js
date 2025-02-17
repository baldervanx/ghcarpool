// Create a new hook: use-listen-to-bookings.ts
import { useEffect, useRef, useCallback } from 'react';
import { useDispatch } from 'react-redux';
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
  removeBooking, addMultipleBookings
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
      logged: booking.logged?.id,
      users: booking.users.map(user => ({ id: user.id })),
      byUser: { id: booking.byUser.id },
      parent_id: doc.id
    }))
  };
};

export function useListenToBookings() {
  const dispatch = useDispatch();
  const unsubscribeRef = useRef(null);

  const handleSnapshot = useCallback((snapshot) => {
    dispatch(setBookingsLoading(false));

    const addedBookings = [];
    const modifiedBookings = [];
    const removedBookings = [];

    snapshot.docChanges().forEach((change) => {
      const booking = convertBooking(change.doc);

      switch (change.type) {
        case 'added':
          addedBookings.push(booking);
          break;
        case 'modified':
          modifiedBookings.push(booking);
          break;
        case 'removed':
          removedBookings.push(booking);
          break;
      }
    });

    if (addedBookings.length > 0) {
      dispatch(addMultipleBookings(addedBookings));
    }
    if (modifiedBookings.length > 0) {
      modifiedBookings.forEach(booking => dispatch(addOrUpdateBooking(booking)));
    }
    if (removedBookings.length > 0) {
      removedBookings.forEach(booking => dispatch(removeBooking(booking)));
    }
  }, [dispatch]);

  useEffect(() => {
    dispatch(setBookingsLoading(true));
    const daysPerPage = 14;
    const pageCount = 8;
    const pastDays = daysPerPage + 1; // Currently only showing 2 weeks of history
    const totalDays = daysPerPage * pageCount; // About 3 months

    const startDateAsDate = addDays(startOfDay(new Date()), -pastDays);
    const startDate = format(startDateAsDate, 'yyyy-MM-dd');
    const endDate = format(addDays(startDateAsDate, totalDays), 'yyyy-MM-dd');
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
  });
}
