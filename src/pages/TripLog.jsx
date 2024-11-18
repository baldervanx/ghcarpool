// pages/TripLog.jsx

import ThemeSwitcher from '../components/ThemeSwitcher';
import OfflineStatus from '../components/OfflineStatus';
import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { CarSelector } from '../components/CarSelector';
import { collection, query, where, orderBy, getDocs, doc, limit } from 'firebase/firestore';
import { db } from '../utils/firebase';
import { useCar } from '../App';
import CarPoolCSVExporter from '@/components/ui/car-pool-csv-export';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function TripLog() {
  const [trips, setTrips] = useState([]);
  const [lastFetchTime, setLastFetchTime] = useState(null);
  const { selectedCar } = useCar();

  useEffect(() => {
    fetchTrips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCar]);

  const fetchTrips = async () => {
    if (!selectedCar) return;

    setTrips([]);

    const tripsRef = collection(db, 'trips');
    const carRef = doc(db, 'cars', selectedCar);
    const q = query(
      tripsRef,
      where('car', '==', carRef),
      orderBy('timestamp', 'desc'),
      limit(20)
    );
    // Should perhaps show "loading" while waiting for the data.
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const tripsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate()
      }));

      setTrips(tripsData);
      setLastFetchTime(Date.now());
    }
  };

  const formatDate = (date) => {
    if (!date) return '';
    return new Intl.DateTimeFormat('sv-SE', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const formatUsers = (userRefs) => {
    if (!userRefs) return '';
    return userRefs
      //.map(ref => users[ref.id]?.id || ref.id)
      .map(ref => ref.id)
      .join(', ');
  };

  const formatCost = (cost) => {
     if (!cost) return '';
     return cost.toFixed(2);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-2">
      <Card className="p-2 space-y-2">
        <CarSelector />
        <OfflineStatus
          lastFetchTime={lastFetchTime}
          onRefresh={fetchTrips}
          staleDuration={5 * 60 * 1000} // milliseconds
          //staleDuration={30 * 1000}
        />
      </Card>
      {trips.length > 0 && (
        <Card className="p-2">
          <Table className="compact-table">
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead className="text-right">Odo</TableHead>
                <TableHead className="text-right">Sträcka</TableHead>
                <TableHead className="text-right">Kostnad</TableHead>
                <TableHead className="text-left">Personer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trips.map(trip => (
                <React.Fragment key={trip.id}>
                  <TableRow className="group">
                    <TableCell
                      rowSpan={trip.comment ? 2 : 1}

                      className="align-middle border-r group-last:border-b"
                    >
                      {formatDate(trip.timestamp)}
                    </TableCell>
                    <TableCell className="text-right">{trip.odo}</TableCell>
                    <TableCell className="text-right">{trip.distance} km</TableCell>
                    <TableCell className="text-right">{formatCost(trip.cost)}</TableCell>
                    <TableCell className="text-left">{formatUsers(trip.users)}</TableCell>
                  </TableRow>
                  {trip.comment && (
                    <TableRow className="bg-muted/50 group-hover:bg-muted/50">
                      <TableCell colSpan={4} className="italic text-muted-foreground py-2">
                        {trip.comment}
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <ThemeSwitcher />
      <CarPoolCSVExporter />
    </div>
  );
}
