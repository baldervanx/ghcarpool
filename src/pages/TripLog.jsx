// pages/TripLog.jsx

import OfflineStatus from '../components/OfflineStatus';
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { Card } from '@/components/ui/card';
import { CarSelector } from '../components/CarSelector';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format, parseISO, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { sv } from 'date-fns/locale';
import {collection, getDocs, query, where, orderBy, Timestamp, doc} from 'firebase/firestore';
import { db } from '../db/firebase';

export function TripLog() {

  const { trips, loading: tripsLoading } = useSelector(state => state.trip);
  const { user } = useSelector(state => state.auth);
  const [ carTrips, setCarTrips ] = useState([]);
  const { selectedCar } = useSelector(state => state.car);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [historicalTrips, setHistoricalTrips] = useState([]);
  const [loadingHistorical, setLoadingHistorical] = useState(false);

  const availableMonths = useMemo(() => {
    const months = [];
    const today = new Date();
    for (let i = 0; i < 18; i++) {
        const date = subMonths(today, i);
        months.push(format(date, 'yyyy-MM'));
    }
    return months;
  }, []);

  const convertTrip = (doc) => {
    const data = doc.data();
    // The timestamp from firestore is a Timestamp object, convert it to a string.
    // The live trips from redux store already have a string timestamp.
    const date = data.timestamp?.toDate();
    const timestamp = date ? format(date, 'yyyy-MM-dd') : '';

    return {
      id: doc.id,
      ...data,
      car: { id: data.car.id },
      users: data.users.map(user => ({ id: user.id })),
      timestamp: timestamp
    };
  };

  const fetchHistoricalTrips = useCallback(async (carId, month) => {
    setLoadingHistorical(true);
    const startDate = startOfMonth(parseISO(`${month}-01`));
    const endDate = endOfMonth(parseISO(`${month}-01`));

    const tripsRef = collection(db, 'trips');
    const carRef = doc(db, "cars", carId);
    const q = query(tripsRef,
        where('car', '==', carRef),
        where('timestamp', '>=', Timestamp.fromDate(startDate)),
        where('timestamp', '<=', Timestamp.fromDate(endDate)),
        orderBy('timestamp', 'desc')
    );

    try {
        const querySnapshot = await getDocs(q);
        const fetchedTrips = querySnapshot.docs.map(convertTrip);
        setHistoricalTrips(fetchedTrips);
    } catch (error) {
        console.error("Error fetching historical trips: ", error);
        setHistoricalTrips([]);
    } finally {
        setLoadingHistorical(false);
    }
  }, []);

  useEffect(() => {
    const currentMonth = format(new Date(), 'yyyy-MM');

    if (selectedCar) {
      if (user.isAdmin && selectedMonth !== currentMonth) {
        fetchHistoricalTrips(selectedCar, selectedMonth);
      } else {
        // Clear historical trips if we switch back to current month or are not admin
        setHistoricalTrips([]);
      }
    } else {
      setCarTrips([]);
      setHistoricalTrips([]);
    }
  }, [selectedCar, selectedMonth, user.isAdmin, fetchHistoricalTrips]);

  useEffect(() => {
    const currentMonth = format(new Date(), 'yyyy-MM');
    if (selectedCar) {
      if (user.isAdmin && selectedMonth !== currentMonth) {
        setCarTrips(historicalTrips);
      } else {
        // The trips in the store are trips for all the cars
        const relevantTrips = trips.filter(trip => trip.car.id === selectedCar);
        setCarTrips(relevantTrips);
      }
    } else {
      setCarTrips([]);
    }
  }, [selectedCar, trips, historicalTrips, selectedMonth, user.isAdmin]);

  const formatUsers = (userRefs) => {
    if (!userRefs) return '';
    return userRefs.map(ref => ref.id).join(', ');
  };

  const formatCost = (cost) => {
    if (!cost) return '';
    return Math.round(cost).toString() + ' kr';
  };

  const formatMonth = (monthStr) => {
    if (!monthStr) return '';
    const date = parseISO(`${monthStr}-01`);
    return format(date, 'MMMM yyyy', { locale: sv });
  };

  return (
      <div className="max-w-4xl mx-auto space-y-2">
        <Card className="p-2 space-y-2">
          <CarSelector carFilter={(cars) => cars.filter(c => c.hasLog ?? true)}/>
          {user.isAdmin && availableMonths.length > 0 && (
            <div className="p-2">
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="w-[280px]">
                  <SelectValue placeholder="Välj månad" />
                </SelectTrigger>
                <SelectContent>
                  {availableMonths.map(month => (
                    <SelectItem key={month} value={month}>
                      {formatMonth(month)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <OfflineStatus />
        </Card>
        {(tripsLoading || loadingHistorical) && (
            <div className="w-full h-64 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        )}

        {!(tripsLoading || loadingHistorical) && carTrips.length > 0 && (
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
                  {carTrips.map(trip => (
                      <React.Fragment key={trip.id}>
                        <TableRow className="group">
                          <TableCell
                              rowSpan={trip.comment ? 2 : 1}
                              className="align-middle border-r group-last:border-b"
                          >
                            {trip.timestamp}
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

        {!(tripsLoading || loadingHistorical) && carTrips.length === 0 && selectedCar && (
            <div className="text-center p-4">Inga resor registrerade för vald bil och månad.</div>
        )}

      </div>
  );
}
