import React, {useEffect, useMemo, useState} from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, AppStore, Booking, Car, fetchAuthState } from '@/store';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useAccessibility } from '@/lib/utils';
import type { TextSize } from "@/lib/utils";
import { useTheme } from '@/components/theme-context';
import { Sun, Moon } from 'lucide-react';
import CarPoolCSVExporter from "@/components/ui/car-pool-csv-export";
import HelpDialog from '@/components/help-dialog';
import {format, differenceInCalendarDays} from "date-fns";
import { sv } from 'date-fns/locale';
import {useNavigate} from "react-router-dom";
import { api, ApiError } from '@/api/client';

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
  const dispatch = useDispatch<AppDispatch>();
  const { settings, updateSettings } = useAccessibility();
  const navigate = useNavigate();
  const { cars } = useSelector((state: AppStore) => state.car);
  const { darkMode, toggleDarkMode } = useTheme();
  const { bookings, loading: bookingsLoading } = useSelector((state: AppStore) => state.booking);
  const { user, loading: userLoading } = useSelector((state: AppStore) => state.auth);
  const [ activeBookings, setActiveBookings ] = useState<BookingCar[]>([]);

  // Lösenordsbyte
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  const handleLogout = async () => {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    dispatch(fetchAuthState());
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(false);
    if (pwNew !== pwConfirm) { setPwError('De nya lösenorden matchar inte'); return; }
    if (pwNew.length < 8) { setPwError('Nytt lösenord måste vara minst 8 tecken'); return; }
    setPwLoading(true);
    try {
      await api.post('/auth/change-password', { currentPassword: pwCurrent, newPassword: pwNew });
      setPwSuccess(true);
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : 'Kunde inte byta lösenord');
    } finally {
      setPwLoading(false);
    }
  };

  useEffect(() => {
    // Find all bookings for today
    const dateStr = format(new Date(), 'yyyy-MM-dd');
    const currentDayBookings = bookings.filter(b => b.date === dateStr);
    const currentUser = user?.user_id;
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
            booking.users.some(u => u.id === currentUser)
        ).filter((booking): booking is BookingCar => booking.car !== undefined);
    const sortedBookings = flatBookings.sort((a, b) => {
      if (a.logged && !b.logged) return 1;
      if (!a.logged && b.logged) return -1;
      return a.startTime - b.startTime;
    });
    setActiveBookings(sortedBookings);
  }, [bookings, user]);

  // Recurrence-data härleds direkt från bookings i state (satt av SSE-hooken).
  // isMultiDay detekteras via att en bokning spänner flera dagar (startTime=0 eller endTime=1440).
  const recurrenceMap = useMemo<Record<string, RecurrenceInfo>>(() => {
    const map: Record<string, RecurrenceInfo> = {};
    for (const dcb of bookings) {
      for (const b of dcb.bookings) {
        if (!b.recurrenceId || map[b.recurrenceId]) continue;
        // Samla alla dcb med detta recurrenceId för att hitta start/end
        const related = bookings.filter(d => d.bookings.some(x => x.recurrenceId === b.recurrenceId))
          .sort((a, c) => a.date.localeCompare(c.date));
        if (related.length === 0) continue;
        // Flerdagsbokning: start och slut är distinkta datum
        const isMultiDay = related.length > 1 &&
          related[0].bookings.some(x => x.recurrenceId === b.recurrenceId && x.endTime === 1440);
        map[b.recurrenceId] = {
          isMultiDay,
          start: related[0].date,
          end: related[related.length - 1].date,
        };
      }
    }
    return map;
  }, [bookings]);

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
    return booking.logged ? "Kört" : "Bokat";
  }

  function isMultiDay(booking: BookingCar): boolean {
    if (!booking.recurrenceId) return false;
    const rec = recurrenceMap[booking.recurrenceId];
    return Boolean(rec?.isMultiDay);
  }

  function isLastDayOfMultiDay(booking: BookingCar): boolean {
    const rec = booking.recurrenceId ? recurrenceMap[booking.recurrenceId] : undefined;
    if (!rec?.isMultiDay) return true;
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

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto space-y-4">

        {!userLoading && !bookingsLoading && (
            activeBookings.map((booking) => (
                <Card key={booking.id}>
                  <CardHeader className="py-4">
                    <CardTitle className="text-xl">{`${bookingStatus(booking)} ${booking.car.name}`}</CardTitle>
                  </CardHeader>
                  <CardContent className="py-4 space-y-2 text-sm">
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
                          <Button variant="outline"
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
          ))
          )}

        {(userLoading || bookingsLoading) && (
            <div className="w-full h-64 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        )}

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

        <Accordion type="single" collapsible>
          <AccordionItem value="change-password">
            <AccordionTrigger className="py-0">
              <CardHeader className="p-3 space-y-3">
                <CardTitle className="text-xl">Byt lösenord</CardTitle>
              </CardHeader>
            </AccordionTrigger>
            <AccordionContent>
              <CardContent className="p-4">
                <form onSubmit={handleChangePassword} className="space-y-3">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Nuvarande lösenord</label>
                    <input
                      type="password"
                      value={pwCurrent}
                      onChange={e => setPwCurrent(e.target.value)}
                      className="w-full border rounded px-3 py-2 text-sm bg-background"
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Nytt lösenord</label>
                    <input
                      type="password"
                      value={pwNew}
                      onChange={e => setPwNew(e.target.value)}
                      className="w-full border rounded px-3 py-2 text-sm bg-background"
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Bekräfta nytt lösenord</label>
                    <input
                      type="password"
                      value={pwConfirm}
                      onChange={e => setPwConfirm(e.target.value)}
                      className="w-full border rounded px-3 py-2 text-sm bg-background"
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                  </div>
                  {pwError && <p className="text-red-600 text-sm">{pwError}</p>}
                  {pwSuccess && <p className="text-green-600 text-sm">Lösenordet har bytts!</p>}
                  <Button type="submit" size="sm" disabled={pwLoading}>
                    {pwLoading ? 'Sparar...' : 'Byt lösenord'}
                  </Button>
                </form>
              </CardContent>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="flex gap-4 mb-8">
          <Button variant="outline" onClick={handleLogout}>
            Logga ut
          </Button>
        </div>

        {user?.isAdmin && (
            <CarPoolCSVExporter/>
        )}

        <HelpDialog />
      </div>
    </div>
  );
};
