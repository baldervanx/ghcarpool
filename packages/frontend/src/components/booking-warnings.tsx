import React from 'react';
import { addDays, format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { useSelector } from 'react-redux';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AppStore } from '@/store';
import { getLogBookings, getRecentLogBookings, getPrecedingUnloggedBooking, hasBookingEnded } from '@/lib/booking-log';
import type { LogBooking } from '@/lib/booking-log';
import { useBookingClock } from '@/lib/use-booking-clock';

interface BookingWarningsProps {
  onLog: (booking: LogBooking) => void;
  onEdit?: (booking: LogBooking) => void;
}

function dayLabel(date: string) {
  return format(new Date(`${date}T00:00:00`), 'd MMM');
}

export function BookingWarnings({ onLog, onEdit }: BookingWarningsProps) {
  const { bookings } = useSelector((state: AppStore) => state.booking);
  const { cars } = useSelector((state: AppStore) => state.car);
  const { user } = useSelector((state: AppStore) => state.auth);
  const { users } = useSelector((state: AppStore) => state.user);
  const now = useBookingClock();

  if (!user?.user_id) return null;

  const today = format(now, 'yyyy-MM-dd');
  const recent = getRecentLogBookings(getLogBookings(bookings, cars), now);
  const missedByCar = new Map<string, LogBooking>();
  const precedingByBooking = new Map<string, LogBooking>();
  const unresolvedBySeries = new Map<string, LogBooking>();
  const oldestDate = format(addDays(now, -14), 'yyyy-MM-dd');
  for (const container of bookings) {
    const car = cars.find(candidate => candidate.id === container.car.id);
    if (!car || !car.hasLog || container.date < oldestDate || container.date > today) continue;
    for (const booking of container.bookings) {
      if (!booking.logged && booking.recurrence?.isMultiDay === null &&
        booking.users.some(member => member.id === user.user_id)) {
        unresolvedBySeries.set(booking.recurrence.id, {
          ...booking, car, date: container.date, parent_id: container.id,
        });
      }
    }
  }

  for (const booking of recent) {
    if (booking.logged || !booking.users.some(member => member.id === user.user_id)) continue;
    if (hasBookingEnded(booking, now)) missedByCar.set(booking.car.id, booking);
    if (booking.date === today) {
      const preceding = getPrecedingUnloggedBooking(recent, booking, now);
      if (preceding) precedingByBooking.set(preceding.id, preceding);
    }
  }

  const missedBookings = Array.from(missedByCar.values()).sort((a, b) => b.date.localeCompare(a.date));
  const precedingBookings = Array.from(precedingByBooking.values());

  return (
    <>
      {Array.from(unresolvedBySeries.values()).map(booking => (
        <Alert key={`unresolved-${booking.recurrenceId}`} variant="destructive">
          <AlertTriangle size={16} />
          <AlertTitle>Bokningsseriens typ saknas</AlertTitle>
          <AlertDescription>
            Bokningen på {booking.car.name} måste anges som återkommande eller flerdagars innan den kan loggas.
            {onEdit && <Button variant="outline" onClick={() => onEdit(booking)}>Ändra</Button>}
          </AlertDescription>
        </Alert>
      ))}
      {missedBookings.map(booking => (
        <Card key={`missed-${booking.id}`} className="border-yellow-500">
          <CardHeader className="py-4">
            <CardTitle className="flex items-center gap-2 text-xl"><AlertTriangle size={20} />{booking.car.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 py-4 text-sm">
            <p>Bokning {dayLabel(booking.date)} har inte loggats.</p>
            <Button variant="outline" onClick={() => onLog(booking)}>Logga</Button>
          </CardContent>
        </Card>
      ))}
      {precedingBookings.map(booking => {
        const userId = booking.users[0]?.id ?? booking.byUser?.id;
        const name = users.find(candidate => candidate.id === userId)?.shortName ?? userId ?? 'okänd användare';
        return (
          <Alert key={`preceding-${booking.id}`} variant="default" className="border-yellow-500">
            <AlertTriangle size={16} />
            <AlertTitle>Föregående bokning ej loggad</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>Bokning av {name} på {booking.car.name} har inte loggats.</span>
              <Button size="sm" variant="outline" onClick={() => onLog(booking)}>Logga</Button>
            </AlertDescription>
          </Alert>
        );
      })}
    </>
  );
}
