/**
 * MSW-handlers för REST-API:et.
 * Importeras av vitest setup och kan överskuggas per test med server.use(…).
 */
import { http, HttpResponse } from 'msw';

// ── Testdata ─────────────────────────────────────────────────────────────────

export const TEST_USERS = [
  { id: 'u1', email: 'anna@example.com',    shortName: 'ANA', isAdmin: false, commentMandatory: false },
  { id: 'u2', email: 'bjorn@example.com',   shortName: 'BJN', isAdmin: false, commentMandatory: true  },
  { id: 'u3', email: 'admin@example.com',   shortName: 'ADM', isAdmin: true,  commentMandatory: false },
];

export const TEST_CARS = [
  { id: 'c1', name: 'Volvo XC60', range: 400, order: 1, hasLog: true },
  { id: 'c2', name: 'Tesla Model 3', range: 500, order: 2, hasLog: true },
];

export const TEST_DESTINATIONS = [
  { id: 'd1', name: 'Huvudkontoret', shortName: 'HK', distance: 12 },
  { id: 'd2', name: 'Lager Norr',    shortName: 'LN', distance: 25 },
];

export const TEST_SETTINGS = { cost_per_km: 1.5 };

export const TEST_BOOKINGS = [
  {
    id: 'dcb1',
    date: '2026-06-20',
    car: { id: 'c1' },
    bookings: [
      {
        id: 'b1',
        startTime: 480,
        endTime: 600,
        distance: 25,
        destination: { id: 'd2', shortName: 'LN' },
        comment: null,
        recurrenceId: null,
        logged: null,
        byUser: { id: 'u1' },
        users: [{ id: 'u1' }],
        parent_id: 'dcb1',
      },
    ],
  },
];

export const TEST_TRIPS = [
  {
    id: 't1',
    car: { id: 'c1' },
    odo: 87200,
    distance: 25,
    cost: 37.5,
    comment: '',
    timestamp: '20 jun 2026',
    byUser: { id: 'u1' },
    users: [{ id: 'u1' }, { id: 'u2' }],
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

export const handlers = [
  http.get('/api/v1/users',        () => HttpResponse.json(TEST_USERS)),
  http.get('/api/v1/cars',         () => HttpResponse.json(TEST_CARS)),
  http.get('/api/v1/destinations', () => HttpResponse.json(TEST_DESTINATIONS)),
  http.get('/api/v1/settings',     () => HttpResponse.json(TEST_SETTINGS)),
  http.get('/api/v1/bookings',     () => HttpResponse.json(TEST_BOOKINGS)),
  http.get('/api/v1/trips',        () => HttpResponse.json(TEST_TRIPS)),

  http.post('/api/v1/bookings', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ id: 'new-booking', ...body }, { status: 201 });
  }),

  http.delete('/api/v1/bookings/:id', ({ params }) => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/api/v1/trips', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ id: 'new-trip', ...body }, { status: 201 });
  }),

  http.put('/api/v1/trips/:id', async ({ request, params }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ id: params.id, ...body });
  }),

  http.delete('/api/v1/trips/:id', () => new HttpResponse(null, { status: 204 })),
];
