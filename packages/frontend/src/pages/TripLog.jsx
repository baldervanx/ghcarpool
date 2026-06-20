// pages/TripLog.jsx

import OfflineStatus from '../components/OfflineStatus';
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CarSelector } from '../components/CarSelector';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format, parseISO, subMonths } from 'date-fns';
import { sv } from 'date-fns/locale';
import { CalendarDays, Filter } from 'lucide-react';
import { api } from '@/api/client';

export function TripLog() {

  const { trips, loading: tripsLoading } = useSelector(state => state.trip);
  const { user } = useSelector(state => state.auth);
  const [ carTrips, setCarTrips ] = useState([]);
  const { selectedCar } = useSelector(state => state.car);
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [historicalTrips, setHistoricalTrips] = useState([]);
  const [loadingHistorical, setLoadingHistorical] = useState(false);
  const [showMonthFilter, setShowMonthFilter] = useState(false);

  const availableMonths = useMemo(() => {
    const months = [];
    const today = new Date();
    for (let i = 0; i < 18; i++) {
        const date = subMonths(today, i);
        months.push(format(date, 'yyyy-MM'));
    }
    return months;
  }, []);

  const fetchHistoricalTrips = useCallback(async (carId, month) => {
    setLoadingHistorical(true);
    try {
      const result = await api.get(`/admin/trips?carId=${carId}&month=${month}`);
      setHistoricalTrips(result);
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
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <CarSelector carFilter={(cars) => cars.filter(c => c.hasLog ?? true)}/>
            </div>
            {availableMonths.length > 0 && (
              <Button
                  variant={showMonthFilter ? 'secondary' : 'ghost'}
                  size="icon"
                  aria-label="Filtrera på månad"
                  onClick={() => setShowMonthFilter(v => !v)}
              >
                <Filter size={20} />
              </Button>
            )}
          </div>
          {showMonthFilter && availableMonths.length > 0 && (
            <div className="flex items-center gap-2 p-2">
              <CalendarDays size={32} />
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
