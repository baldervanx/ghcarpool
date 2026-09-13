import React from 'react';
import { addDays, format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { useSelector } from 'react-redux';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AppStore, Booking, Car } from '@/store';

interface BookingWithCar extends Booking {
  car: Car;
  date: string;
}

interface BookingWarningsProps {
  onLog: (booking: BookingWithCar) => void;
}

function dayLabel(date: string) {
  return format(new Date(`${date}T00:00:00`), 'd MMM');
}

export function BookingWarnings({ onLog }: BookingWarningsProps) {
  const { bookings } = useSelector((state: AppStore) => state.booking);
  const { cars } = useSelector((state: AppStore) => state.car);
  const { user } = useSelector((state: AppStore) => state.auth);
  const { users } = useSelector((state: AppStore) => state.user);

  if (!user?.user_id) return null;

  const today = format(new Date(), 'yyyy-MM-dd');
  const twoWeeksAgo = format(addDays(new Date(), -14), 'yyyy-MM-dd');
  const missedByCar = new Map<string, BookingWithCar>();
  const precedingByBooking = new Map<string, BookingWithCar>();

  for (const dateCarBooking of bookings) {
    const car = cars.find(candidate => candidate.id === dateCarBooking.car.id);
    if (!car || car.hasLog === false) continue;

    if (dateCarBooking.date >= twoWeeksAgo && dateCarBooking.date < today) {
      for (const booking of dateCarBooking.bookings) {
        if (booking.logged || !booking.users.some(member => member.id === user.user_id)) continue;
        if (booking.recurrenceId && booking.endTime === 1440) continue;
        const existing = missedByCar.get(car.id);
        if (!existing || dateCarBooking.date > existing.date) {
          missedByCar.set(car.id, { ...booking, car, date: dateCarBooking.date });
        }
      }
    }

    if (dateCarBooking.date === today) {
      for (const activeBooking of dateCarBooking.bookings) {
        if (!activeBooking.users.some(member => member.id === user.user_id)) continue;
        const preceding = dateCarBooking.bookings
          .filter(booking => booking.id !== activeBooking.id && !booking.logged && booking.endTime <= activeBooking.startTime)
          .sort((a, b) => b.endTime - a.endTime)[0];
        if (preceding) precedingByBooking.set(activeBooking.id, { ...preceding, car, date: today });
      }
    }
  }

  const missedBookings = Array.from(missedByCar.values()).sort((a, b) => b.date.localeCompare(a.date));
  const precedingBookings = Array.from(precedingByBooking.values());

  return (
    <>
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
              <span>Bokning av {name} har inte loggats.</span>
              <Button size="sm" variant="outline" onClick={() => onLog(booking)}>Logga</Button>
            </AlertDescription>
          </Alert>
        );
      })}
    </>
  );
}
