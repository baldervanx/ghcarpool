import { api } from './client';

export interface ExpenseDto {
  id: string;
  carId: string;
  amount: number;
  description: string;
  status: 'UNPAID' | 'PAID';
  hasReceipt: boolean;
  byUserId: string;
  createdAt: string;
  updatedAt: string;
}

export const expensesApi = {
  list: (params?: { carId?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.carId) q.set('carId', params.carId);
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return api.get<ExpenseDto[]>(`/expenses${qs ? `?${qs}` : ''}`);
  },
  create: (data: { carId: string; amount: number; description: string; receipt?: File }) => {
    const form = new FormData();
    form.append('carId', data.carId);
    form.append('amount', String(data.amount));
    form.append('description', data.description);
    if (data.receipt) form.append('receipt', data.receipt);
    return api.postForm<ExpenseDto>('/expenses', form);
  },
  updateStatus: (id: string, status: string) =>
    api.patch<ExpenseDto>(`/expenses/${id}`, { status }),
  receiptUrl: (id: string) =>
    `/api/v1/expenses/${id}/receipt`,
  remove: (id: string) =>
    api.delete<{ ok: boolean }>(`/expenses/${id}`),
};
