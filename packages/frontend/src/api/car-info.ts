import { api } from './client';

export interface CarInfoDto {
  id: string;
  carId: string;
  inspectionDue: string | null;
  lastService: string | null;
  owner: string | null;
  insuranceCompany: string | null;
  updatedAt: string;
}

export const carInfoApi = {
  get: (carId: string) =>
    api.get<CarInfoDto>(`/car-info/${carId}`),
  upsert: (carId: string, data: Omit<CarInfoDto, 'id' | 'carId' | 'updatedAt'>) =>
    api.put<CarInfoDto>(`/car-info/${carId}`, data),
};
