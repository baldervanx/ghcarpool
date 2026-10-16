import { addDays, format } from 'date-fns';
import type { Booking, Car, DateCarBooking } from '@/store';

export interface LogBooking extends Booking {
  car: Car;
  date: string;
  parent_id: string;
}

export function getLogBookings(bookings: DateCarBooking[], cars: Car[]): LogBooking[] {
  const entries = bookings.flatMap(container => {
    const car = cars.find(candidate => candidate.id === container.car.id);
    if (!car || car.hasLog === false) return [];
    return container.bookings.map(booking => ({
      ...booking, parent_id: container.id, car, date: container.date,
    }));
  }).sort((a, b) => a.date.localeCompare(b.date) || a.endTime - b.endTime || a.startTime - b.startTime);

  return entries.filter(booking => {
    if (booking.recurrence) {
      if (booking.recurrence.isMultiDay === null) return false;
      return !booking.recurrence.isMultiDay || booking.date === booking.recurrence.recurringEndDate;
    }
    if (!booking.recurrenceId || booking.endTime !== 1440) return true;
    // A midnight boundary alone also occurs in ordinary recurring bookings.
    return !entries.some(next =>
      next.car.id === booking.car.id && next.recurrenceId === booking.recurrenceId &&
      next.date === format(addDays(new Date(`${booking.date}T00:00:00`), 1), 'yyyy-MM-dd') &&
      next.startTime === 0,
    );
  });
}

export function hasBookingEnded(booking: LogBooking, now: Date): boolean {
  const end = new Date(`${booking.date}T00:00:00`);
  end.setMinutes(booking.endTime);
  return end.getTime() <= now.getTime();
}

export function getRecentLogBookings(bookings: LogBooking[], now: Date): LogBooking[] {
  const today = format(now, 'yyyy-MM-dd');
  const oldest = format(addDays(now, -14), 'yyyy-MM-dd');
  return bookings.filter(booking => booking.date >= oldest && booking.date <= today);
}

export function getPrecedingUnloggedBooking(
  bookings: LogBooking[], booking: Pick<LogBooking, 'id' | 'date' | 'startTime'> & { car: { id: string } }, now: Date,
  currentUserId?: string,
): LogBooking | undefined {
  const previous = bookings.filter(candidate =>
    candidate.id !== booking.id && candidate.car.id === booking.car.id &&
    (candidate.date < booking.date || candidate.date === booking.date && candidate.endTime <= booking.startTime) &&
    hasBookingEnded(candidate, now),
  ).sort((a, b) => b.date.localeCompare(a.date) || b.endTime - a.endTime || b.startTime - a.startTime)[0];
  return previous && !previous.logged && !previous.users.some(member => member.id === currentUserId)
    ? previous
    : undefined;
}
