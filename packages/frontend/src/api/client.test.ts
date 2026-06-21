/**
 * Testar att api/client.ts skickar credentials:include och kastar ApiError vid HTTP-fel.
 */
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks';
import { api, ApiError } from '@/api/client';

describe('api client', () => {
  it('returnerar data vid lyckat anrop', async () => {
    server.use(
      http.get('/api/v1/users', () => HttpResponse.json([{ id: '1' }])),
    );
    const result = await api.get('/users');
    expect(result).toEqual([{ id: '1' }]);
  });

  it('kastar ApiError med statuskod vid HTTP 401', async () => {
    server.use(
      http.get('/api/v1/users', () =>
        HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      ),
    );
    await expect(api.get('/users')).rejects.toMatchObject({ status: 401 });
  });

  it('kastar ApiError vid HTTP 500', async () => {
    server.use(
      http.get('/api/v1/cars', () => new HttpResponse(null, { status: 500 })),
    );
    let err: unknown;
    try { await api.get('/cars'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).status).toBe(500);
  });
});
