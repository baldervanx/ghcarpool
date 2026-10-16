import { format } from 'date-fns';

export function allowsPastBookings(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.ALLOW_PAST_BOOKINGS === 'true';
}

export function canBookDate(date: string, existingDate?: string): boolean {
  return allowsPastBookings() || date >= format(new Date(), 'yyyy-MM-dd') || date === existingDate;
}
