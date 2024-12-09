// pages/TripLog.jsx

import OfflineStatus from '../components/OfflineStatus';
import React, {useEffect, useState} from 'react';
import { useSelector } from 'react-redux';
import { Card } from '@/components/ui/card';
import { CarSelector } from '../components/CarSelector';
import CarPoolCSVExporter from '@/components/ui/car-pool-csv-export';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useListenToTrips } from '@/db/use-listen-to-trips';

export function TripLog() {
  useListenToTrips();
  const { trips, loading: tripsLoading } = useSelector(state => state.trip);
  const [ carTrips, setCarTrips ] = useState([]);
  const { selectedCar } = useSelector(state => state.car);

  useEffect(() => {
    if (selectedCar) {
      // The trips in the store are trips for all the cars
      const relevantTrips = trips.filter(trip => trip.car.id === selectedCar);
      setCarTrips(relevantTrips);
    }
  }, [selectedCar, trips]);

  const formatUsers = (userRefs) => {
    if (!userRefs) return '';
    return userRefs.map(ref => ref.id).join(', ');
  };

  const formatCost = (cost) => {
    if (!cost) return '';
    return Math.round(cost).toString() + ' kr';
  };

  return (
      <div className="max-w-4xl mx-auto space-y-2">
        <Card className="p-2 space-y-2">
          <CarSelector />
          <OfflineStatus />
        </Card>
        {!tripsLoading && carTrips.length > 0 && (
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

        {tripsLoading && (
            <div className="flex items-center justify-center min-h-screen">Laddar...</div>
        )}

        <CarPoolCSVExporter />
      </div>
  );
}
