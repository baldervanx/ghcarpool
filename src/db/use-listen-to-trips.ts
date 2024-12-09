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
import { setTrips, setTripsLoading } from '../store';

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

//FIXME: Genererar fortfarande multipla requests varje gång jag byter sida
//FIXME: Mina lokala uppdateringar borde givetvis uppdatera listan, men gör det inte.
// Grejar emulatorn att hantera onSnapshot korrekt?
export function useListenToTrips() {
  const dispatch = useDispatch();
  const existingTrips = useSelector(state => state.trip.trips);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const handleSnapshot = useCallback((snapshot) => {
    // Stoppa loading-state när första snapshot har kommit
    dispatch(setTripsLoading(false));

    snapshot.docChanges().forEach((change) => {
      const trip = convertTrip(change.doc);

      switch (change.type) {
        case 'added':
          if (!existingTrips.some(t => t.id === trip.id)) {
            dispatch(setTrips([...existingTrips, trip]));
          }
          break;
        case 'modified':
          dispatch(setTrips(existingTrips.map(t =>
            t.id === trip.id ? trip : t
          )));
          break;
        case 'removed':
          dispatch(setTrips(existingTrips.filter(t =>
            t.id !== trip.id
          )));
          break;
      }
    });
  }, [dispatch, existingTrips]);

  useEffect(() => {
    // Sätt loading-state när lyssnaren startar
    dispatch(setTripsLoading(true));

    const tripsRef = collection(db, 'trips');

    // Skapa ett timestamp för 20 dagar sedan
    const twentyDaysAgo = new Date();
    twentyDaysAgo.setDate(twentyDaysAgo.getDate() - 20);

    const q = query(
      tripsRef,
      where('timestamp', '>=', Timestamp.fromDate(twentyDaysAgo)),
      orderBy('odo', 'asc')
    );

    // Sätt upp snapshot-lyssnaren
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
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [handleSnapshot, dispatch]);
}
