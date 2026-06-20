/**
 * Testar att api/client.ts korrekt sätter Authorization-header
 * och kastar ApiError vid HTTP-fel.
 */
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks';

// Mocka Firebase Auth så att getIdToken returnerar ett känt värde
vi.mock('firebase/auth', async (importOrig) => {
  const orig = await importOrig<typeof import('firebase/auth')>();
  return {
    ...orig,
    getAuth: vi.fn(() => ({
      currentUser: {
        getIdToken: vi.fn(() => Promise.resolve('test-firebase-token')),
      },
    })),
  };
});

// Importera efter mock
const { api, ApiError } = await import('@/api/client');

describe('api client', () => {
  it('skickar Authorization-header med Firebase-token', async () => {
    let capturedAuth: string | null = null;

    server.use(
      http.get('/api/v1/users', ({ request }) => {
        capturedAuth = request.headers.get('Authorization');
        return HttpResponse.json([]);
      }),
    );

    await api.get('/users');
    expect(capturedAuth).toBe('Bearer test-firebase-token');
  });

  it('kastar ApiError med statuskod vid HTTP 401', async () => {
    server.use(
      http.get('/api/v1/users', () =>
        HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      ),
    );

    await expect(api.get('/users')).rejects.toMatchObject({
      status: 401,
    });
  });

  it('kastar ApiError vid HTTP 500', async () => {
    server.use(
      http.get('/api/v1/cars', () =>
        new HttpResponse(null, { status: 500 }),
      ),
    );

    let err: unknown;
    try { await api.get('/cars'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });
});
