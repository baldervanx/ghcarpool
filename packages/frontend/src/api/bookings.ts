import { api } from './client';
import type { DateCarBooking } from '@/store';

export interface BookingsResponse {
  startDate: string;
  endDate: string;
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

export const bookingsApi = {
  list: (startDate?: string, endDate?: string) => {
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    const qs = params.toString();
    return api.get<BookingsResponse>(`/bookings${qs ? '?' + qs : ''}`);
  },

  save: (payload: CreateBookingPayload) =>
    api.post<DateCarBooking>('/bookings', payload),

  delete: (parentId: string, bookingId: string) =>
    api.delete<{ id: string }>(`/bookings/${parentId}/${bookingId}`),
};
