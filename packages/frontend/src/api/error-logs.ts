import { api } from './client';

export interface ErrorLogComment {
  id: string;
  text: string;
  byUserId: string;
  createdAt: string;
}

export interface ErrorLogDto {
  id: string;
  carId: string;
  description: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  assignedToId: string | null;
  updatedById: string;
  createdAt: string;
  updatedAt: string;
  comments: ErrorLogComment[];
}

export const errorLogsApi = {
  list: (params?: { carId?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.carId) q.set('carId', params.carId);
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return api.get<ErrorLogDto[]>(`/error-logs${qs ? `?${qs}` : ''}`);
  },
  create: (data: { carId: string; description: string; assignedToId?: string }) =>
    api.post<ErrorLogDto>('/error-logs', data),
  updateStatus: (id: string, status: string) =>
    api.patch<ErrorLogDto>(`/error-logs/${id}`, { status }),
  addComment: (id: string, text: string) =>
    api.post<ErrorLogDto>(`/error-logs/${id}/comments`, { text }),
  remove: (id: string) =>
    api.delete<{ ok: boolean }>(`/error-logs/${id}`),
};
