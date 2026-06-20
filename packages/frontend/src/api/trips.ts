import { api } from './client';

export interface TripDto {
  id: string;
  car: { id: string };
  odo: number;
  distance: number;
  cost: number;
  comment?: string;
  byUser: { id: string };
  users: { id: string }[];
  timestamp: string;
}

export interface CreateTripPayload {
  carId: string;
  odo: number;
  distance: number;
  cost: number;
  comment?: string;
  userIds: string[];
  bookingId?: string;
  parentId?: string;
}

export interface UpdateTripPayload {
  odo: number;
  distance: number;
  cost: number;
  comment?: string;
  userIds: string[];
}

export const tripsApi = {
  list: () => api.get<TripDto[]>('/trips'),
  create: (payload: CreateTripPayload) => api.post<TripDto>('/trips', payload),
  update: (id: string, payload: UpdateTripPayload) =>
    api.put<TripDto>(`/trips/${id}`, payload),
  delete: (id: string) => api.delete<{ id: string }>(`/trips/${id}`),
};
