import { api } from './client';
import type { Car, Destination } from '@/store';

export interface ApiUser {
  id: string;
  email: string;
  isAdmin: boolean;
  shortName: string;
  commentMandatory: boolean;
}

export interface ApiSettings {
  cost_per_km: number;
  [key: string]: unknown;
}

export const usersApi = {
  list: () => api.get<ApiUser[]>('/users'),
};

export const carsApi = {
  list: () => api.get<Car[]>('/cars'),
};

export const destinationsApi = {
  list: () => api.get<Destination[]>('/destinations'),
};

export const settingsApi = {
  get: () => api.get<ApiSettings>('/settings'),
};
