import React, {useEffect, useState} from 'react';
import { getAuth, signOut } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useAccessibility } from '@/lib/utils';
import type { TextSize } from "@/lib/utils";
import { useTheme } from '@/components/theme-context';
import { Sun, Moon, AlertTriangle } from 'lucide-react';
import CarPoolCSVExporter from "@/components/ui/car-pool-csv-export";
import HelpDialog from '@/components/help-dialog';
import {useSelector} from "react-redux";
import {format, differenceInCalendarDays, addDays} from "date-fns";
import { sv } from 'date-fns/locale';
import {useNavigate} from "react-router-dom";
import type {AppStore, Booking, Car} from '@/store';
import { db } from '@/db/firebase';
import { doc, getDoc } from 'firebase/firestore';

interface BookingCar extends Booking {
  car: Car;
  date: string;
}

interface RecurrenceInfo {
  isMultiDay: boolean;
  start: string; // yyyy-MM-dd
  end: string;   // yyyy-MM-dd
}

export const HomePage = () => {
  const { settings, updateSettings } = useAccessibility();
  const navigate = useNavigate();
  const { cars } = useSelector((state: AppStore) => state.car);
  const { darkMode, toggleDarkMode } = useTheme();
  const { bookings, loading: bookingsLoading } = useSelector((state: AppStore) => state.booking);
  const { user, loading: userLoading } = useSelector((state: AppStore) => state.auth);
  const { users } = useSelector((state: AppStore) => state.user);
  const [ activeBookings, setActiveBookings ] = useState<BookingCar[]>([]);
  const [ recurrenceMap, setRecurrenceMap ] = useState<Record<string, RecurrenceInfo>>({});
  // Scenario 1: most recent preceding unlogged booking per active booking (keyed by active booking id)
  const [ precedingUnlogged, setPrecedingUnlogged ] = useState<Map<string, BookingCar>>(new Map());
  // Scenario 2: most recent missed (unlogged, past) booking per car for the current user
  const [ missedPerCar, setMissedPerCar ] = useState<BookingCar[]>([]);
  const auth = getAuth();

  useEffect(() => {
    // Find all bookings for today
    const dateStr = format(new Date(), 'yyyy-MM-dd');
    const currentDayBookings = bookings.filter(b => b.date === dateStr);
    const currentUser = user.user_id;
    // Find bookings where current user is booked
    const flatBookings = currentDayBookings
        .flatMap(dayBooking =>
            dayBooking.bookings.map(booking => ({
              ...booking,
              // Would be a bit more efficient to do this later.
              car: cars.find(c => c.id === dayBooking.car.id),
              date: dayBooking.date
            }))
        ).filter(booking =>
            booking.users.some(user => user.id === currentUser)
        );
    const sortedBookings = flatBookings.sort((a, b) => {
      if (a.logged && !b.logged) return 1;
      if (!a.logged && b.logged) return -1;
      return a.startTime - b.startTime;
    });
    setActiveBookings(sortedBookings);

    // Scenario 1: for each active booking, find the most recent preceding unlogged booking
    // on the same car today (made by someone else, or at least unlogged before our slot)
    const newPrecedingMap = new Map<string, BookingCar>();
    flatBookings.forEach(activeBooking => {
      const sameCar = currentDayBookings.find(dcb => dcb.car.id === activeBooking.car?.id);
      if (!sameCar) return;
      const car = activeBooking.car;
      if (!(car?.hasLog ?? true)) return;
      // Highest-endTime unlogged booking that ends at or before our start, excluding ourselves
      const preceding = sameCar.bookings
        .filter(b => b.id !== activeBooking.id && !b.logged && b.endTime <= activeBooking.startTime)
        .sort((a, b) => b.endTime - a.endTime)[0];
      if (preceding) {
        newPrecedingMap.set(activeBooking.id, { ...preceding, car, date: dateStr });
      }
    });
    setPrecedingUnlogged(newPrecedingMap);
  }, [bookings, user, cars]);

  // Fetch recurrence data for any unseen recurrenceIds present in today's active bookings
  useEffect(() => {
    const uniqueRecurrenceIds = Array.from(new Set(activeBookings
      .map(b => b.recurrenceId)
      .filter((id): id is string => Boolean(id))));

    const missing = uniqueRecurrenceIds.filter(id => !recurrenceMap[id]);
    if (missing.length === 0) return;

    (async () => {
      const entries: Array<[string, RecurrenceInfo]> = [];
      for (const rid of missing) {
        try {
          const ref = doc(db, 'recurrence', rid);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const data = snap.data() as any;
            entries.push([rid, {
              isMultiDay: Boolean(data.isMultiDay),
              start: data.recurringStartDate,
              end: data.recurringEndDate
            }]);
          }
        } catch (e) {
          // ignore fetch errors for now
        }
      }
      if (entries.length > 0) {
        setRecurrenceMap(prev => ({...prev, ...Object.fromEntries(entries)}));
      }
    })();
  }, [activeBookings, recurrenceMap]);

  // Scenario 2: most recent unlogged past booking per car for the current user (last 14 days)
  useEffect(() => {
    if (!user.user_id) return;
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const twoWeeksAgoStr = format(addDays(new Date(), -14), 'yyyy-MM-dd');
    const currentUserId = user.user_id;

    const pastMissed: BookingCar[] = bookings
      .filter(dcb => dcb.date < todayStr && dcb.date >= twoWeeksAgoStr)
      .flatMap(dcb => {
        const car = cars.find(c => c.id === dcb.car.id);
        if (!car || !(car.hasLog ?? true)) return [];
        return dcb.bookings
          .filter(b => !b.logged && b.users.some(u => u.id === currentUserId))
          .map(b => ({ ...b, car, date: dcb.date }));
      });

    // Keep only the most recent missed booking per car
    const byCarId = new Map<string, BookingCar>();
    pastMissed.forEach(b => {
      const existing = byCarId.get(b.car.id);
      if (!existing || b.date > existing.date) {
        byCarId.set(b.car.id, b);
      }
    });
    setMissedPerCar(
      Array.from(byCarId.values()).sort((a, b) => b.date.localeCompare(a.date))
    );
  }, [bookings, user, cars]);

  function getUserShortName(userId: string): string {
    return users.find(u => u.id === userId)?.shortName ?? '?';
  }

  // FIXME: Move duplicated code to utility
  function timeToString(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${mins.toString().padStart(2, '0')}`;
  }

  function logBooking(booking: BookingCar) {
    navigate('/register-trip', { state: { booking: booking } });
  }

  function changeBooking(booking: BookingCar) {
    navigate('/book-trip', { state: { parent_id: booking.parent_id, booking_id: booking.id } });
  }

  function bookingStatus(booking: BookingCar): string {
    // Can perhaps use time to give more details in the title.
    return booking.logged ? "Kört" : "Bokat";
  }

  function isMultiDay(booking: BookingCar): boolean {
    if (!booking.recurrenceId) return false;
    const rec = recurrenceMap[booking.recurrenceId];
    return Boolean(rec?.isMultiDay);
  }

  function isLastDayOfMultiDay(booking: BookingCar): boolean {
    const rec = booking.recurrenceId ? recurrenceMap[booking.recurrenceId] : undefined;
    if (!rec?.isMultiDay) return true; // Only restrict when multi-day
    return booking.date === rec.end;
  }

  function capitalizeFirst(text: string): string {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function formatDayLabel(dateStr: string, includeDate: boolean): string {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    if (dateStr === todayStr) return 'Idag';
    const d = new Date(dateStr + 'T00:00:00');
    const label = includeDate ? format(d, 'EEEE d MMM', { locale: sv }) : format(d, 'EEEE', { locale: sv });
    return capitalizeFirst(label);
  }

  function getRecurrenceEdgeTimes(booking: BookingCar): { start?: number; end?: number } {
    const rec = booking.recurrenceId ? recurrenceMap[booking.recurrenceId] : undefined;
    if (!rec) return {};
    const startDay = bookings.find(b => b.car.id === booking.car.id && b.date === rec.start);
    const endDay = bookings.find(b => b.car.id === booking.car.id && b.date === rec.end);
    const startBooking = startDay?.bookings.find(b => b.recurrenceId === booking.recurrenceId);
    const endBooking = endDay?.bookings.find(b => b.recurrenceId === booking.recurrenceId);
    return { start: startBooking?.startTime, end: endBooking?.endTime };
  }

  // TODO: The bookings should be sorted:
  //      1. past booking that hasn't been logged at the top (include such bookings from yesterday)
  //      2. ongoing booking that will need to be logged soon
  //      3. coming bookings later the same day
  //      4. past bookings that has been logged, just remaining there to confirm that it was booked.
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto space-y-4">

        {!userLoading && !bookingsLoading && (
          <>
            {/* Scenario 2: missed (unlogged) past bookings for the current user */}
            {missedPerCar.map((booking) => (
              <Card key={`missed-${booking.id}`} className="border-yellow-500">
                <CardHeader className="py-4">
                  <CardTitle className="text-xl flex items-center gap-2">
                    <AlertTriangle className="text-yellow-600 dark:text-yellow-400" size={20} />
                    {booking.car.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="py-4 space-y-2 text-sm">
                  <p>{`Bokning ${formatDayLabel(booking.date, true)} har inte loggats`}</p>
                  <Button variant="outline" onClick={() => logBooking(booking)}>
                    Logga
                  </Button>
                </CardContent>
              </Card>
            ))}

            {/* Today's bookings */}
            {activeBookings.map((booking) => (
                <Card key={booking.id}>
                  <CardHeader className="py-4">
                    <CardTitle className="text-xl">{`${bookingStatus(booking)} ${booking.car.name}`}</CardTitle>
                  </CardHeader>
                  <CardContent className="py-4 space-y-2 text-sm">
                    {/* Scenario 1: preceding unlogged booking on the same car today */}
                    {precedingUnlogged.has(booking.id) && (() => {
                      const prev = precedingUnlogged.get(booking.id)!;
                      const userName = getUserShortName(prev.users[0]?.id ?? prev.byUser?.id ?? '');
                      return (
                        <Alert variant="warning" className="mb-2">
                          <AlertTriangle size={16} />
                          <AlertTitle>Föregående bokning ej loggad</AlertTitle>
                          <AlertDescription className="flex items-center justify-between gap-2 flex-wrap">
                            <span>{`Bokning av ${userName} har inte loggats`}</span>
                            <Button size="sm" variant="outline" onClick={() => logBooking(prev)}>
                              Logga
                            </Button>
                          </AlertDescription>
                        </Alert>
                      );
                    })()}
                    {isMultiDay(booking) && booking.recurrenceId && recurrenceMap[booking.recurrenceId] ? (
                      (() => {
                        const rec = recurrenceMap[booking.recurrenceId];
                        const spanDays = differenceInCalendarDays(new Date(rec.end + 'T00:00:00'), new Date(rec.start + 'T00:00:00'));
                        const includeDate = spanDays > 7;
                        const edges = getRecurrenceEdgeTimes(booking);
                        return (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{`Start: ${formatDayLabel(rec.start, includeDate)} ${edges.start !== undefined ? timeToString(edges.start) : ''}`}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{`Slut: ${formatDayLabel(rec.end, includeDate)} ${edges.end !== undefined ? timeToString(edges.end) : ''}`}</span>
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{`Tid: ${timeToString(booking.startTime)}-${timeToString(booking.endTime)}`}</span>
                      </div>
                    )}
                    {!booking.logged && (
                          <div className="flex items-center">
                          {(booking.car.hasLog ?? true) && isLastDayOfMultiDay(booking) && (
                            <Button variant="outline"
                              className="mr-2"
                              onClick={() => logBooking(booking)}
                            >
                              Logga
                            </Button>
                          )}
                          <Button  variant="outline"
                            className="ml-auto"
                            onClick={() => changeBooking(booking)}
                          >
                            Ändra
                          </Button>
                          </div>
                    ) || (
                        <span className="font-bold">Loggad</span>
                    )}
                  </CardContent>
                </Card>
          ))}
          </>
            )}

        {(userLoading || bookingsLoading) && (
            <div className="w-full h-64 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        )}

        {/* This card should be collapsed (accordion?) by default, as it is not that frequently used. */}
        <Accordion type="single" collapsible>
          <AccordionItem value="settings">
            <AccordionTrigger className="py-0">
              <CardHeader className="p-3 space-y-3">
                <CardTitle className="text-xl">Inställningar</CardTitle>
              </CardHeader>
            </AccordionTrigger>
            <AccordionContent>
              <CardContent className="p-4 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Hög kontrast</span>
                  <Button
                      variant="outline"
                      onClick={() => updateSettings({isHighContrast: !settings.isHighContrast})}
                  >
                    {settings.isHighContrast ? 'På' : 'Av'}
                  </Button>
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-medium">Textstorlek</span>
                  <Select
                      value={settings.textSize}
                      onValueChange={(value) => updateSettings({textSize: value as TextSize})}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Välj textstorlek"/>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal text</SelectItem>
                      <SelectItem value="large">Stor text</SelectItem>
                      <SelectItem value="larger">Större text</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-medium">Mörkt/Ljust läge</span>
                  <Button
                      variant="outline"
                      onClick={toggleDarkMode}
                      size="icon"
                  >
                    {darkMode ? <Sun size={20}/> : <Moon size={20}/>}
                  </Button>
                </div>
              </CardContent>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="flex gap-4 mb-8">
          <Button
              variant="outline"
              onClick={() => signOut(auth)}
          >
            Logga ut
          </Button>
        </div>

        {(user.isAdmin) && (
            <CarPoolCSVExporter/>
        )}

        <HelpDialog />
      </div>
    </div>
  );
};
