import { useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  collection,
  query,
  orderBy,
  where,
  Timestamp,
  onSnapshot
} from 'firebase/firestore';
import { db } from '@/db/firebase';
import { setTripsLoading, addMultipleTrips, addOrUpdateTrip, removeTrip } from '@/store';

const formatDate = (date) => {
  if (!date) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const convertTrip = (doc) => {
  const data = doc.data();
  return {
    id: doc.id,
    car: { id: data.car.id },
    odo: data.odo,
    distance: data.distance,
    cost: data.cost,
    comment: data.comment,
    users: data.users.map(user => ({ id: user.id })),
    byUser: { id: data.byUser.id },
    timestamp: formatDate(data.timestamp?.toDate())
  };
};

export function useListenToTrips() {
  const dispatch = useDispatch();
  const unsubscribeRef = useRef<(() => void) | null>(null);
  // Only subscribe when authenticated; re-subscribe when the user changes.
  const uid = useSelector((state: any) => state.auth.user?.uid);

  const handleSnapshot = useCallback((snapshot) => {
    dispatch(setTripsLoading(false));

    const addedTrips = [];
    const modifiedTrips = [];
    const removedTrips = [];

    snapshot.docChanges().forEach((change) => {
      const trip = convertTrip(change.doc);

      switch (change.type) {
        case 'added':
          addedTrips.push(trip);
          break;
        case 'modified':
          modifiedTrips.push(trip);
          break;
        case 'removed':
          removedTrips.push(trip);
          break;
      }
    });

    if (addedTrips.length > 0) {
      dispatch(addMultipleTrips(addedTrips));
    }
    if (modifiedTrips.length > 0) {
      modifiedTrips.forEach(trip => dispatch(addOrUpdateTrip(trip)));
    }
    if (removedTrips.length > 0) {
      removedTrips.forEach(trip => dispatch(removeTrip(trip)));
    }
  }, [dispatch]);


  useEffect(() => {
    // Don't subscribe before the user is authenticated. An unauthenticated
    // query fails with permission-denied and terminates the listener, leaving
    // the trip list blank until a full page reload.
    if (!uid) {
      return;
    }

    // Sätt loading-state när lyssnaren startar
    dispatch(setTripsLoading(true));

    const tripsRef = collection(db, 'trips');

    const lastMonth = new Date();
    lastMonth.setDate(lastMonth.getDate() - 30);

    const q = query(
      tripsRef,
      where('timestamp', '>=', Timestamp.fromDate(lastMonth)),
      orderBy('odo', 'asc')
    );

    // Sätt upp snapshot-lyssnaren
    console.log("Loading trips");
    unsubscribeRef.current = onSnapshot(
      q,
      handleSnapshot,
      (error) => {
        console.error('Error fetching trips:', error);
        dispatch(setTripsLoading(false));
      }
    );

    // Cleanup-funktion för att avregistrera när komponenten unmountas
    return () => {
      if (unsubscribeRef.current) {
        console.log("Unsubscribing trips");
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [uid]);
}
