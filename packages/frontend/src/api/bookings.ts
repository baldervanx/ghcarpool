import { api } from './client';
import type { DateCarBooking, Destination } from '@/store';

export interface BookingsResponse {
  startDate: string;
  endDate: string;
  since: string | null;
  bookings: DateCarBooking[];
}

export interface CreateBookingPayload {
  date: string;
  carId: string;
  startTime: number;
  endTime: number;
  distance?: number;
  destinationId?: string;
  comment?: string;
  recurrenceId?: string;
  userIds: string[];
  existingBookingId?: string;
  existingParentId?: string;
}

// POST /bookings returnerar DateCarBooking, plus newDestination om en temporär
// destination skapades automatiskt under bokningen.
export type SaveBookingResponse = DateCarBooking & { newDestination?: Destination };

export const bookingsApi = {
  /**
   * Hämta bokningar för ett datumfönster.
   * @param startDate  ISO "yyyy-MM-dd"
   * @param endDate    ISO "yyyy-MM-dd"
   * @param since      ISO 8601 — returnerar bara DCBs ändrade sedan detta datum (delta-sync)
   */
  list: (startDate?: string, endDate?: string, since?: string) => {
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (since) params.set('since', since);
    const qs = params.toString();
    return api.get<BookingsResponse>(`/bookings${qs ? '?' + qs : ''}`);
  },

  save: (payload: CreateBookingPayload) =>
    api.post<SaveBookingResponse>('/bookings', payload),

  delete: (parentId: string, bookingId: string) =>
    api.delete<{ id: string }>(`/bookings/${parentId}/${bookingId}`),
};
