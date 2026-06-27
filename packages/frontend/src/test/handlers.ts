/**
 * MSW-handlers för REST-API:et.
 * Importeras av vitest setup och kan överskuggas per test med server.use(…).
 */
import { http, HttpResponse } from 'msw';
import type { BookingsResponse } from '@/api/bookings';

// ── Testdata ──────────────────────────────────────────────────────────────────

export const TEST_USERS = [
  { id: 'u1', email: 'anna@example.com',  shortName: 'ANA', isAdmin: false, commentMandatory: false },
  { id: 'u2', email: 'bjorn@example.com', shortName: 'BJN', isAdmin: false, commentMandatory: true  },
  { id: 'u3', email: 'admin@example.com', shortName: 'ADM', isAdmin: true,  commentMandatory: false },
];

export const TEST_CARS = [
  { id: 'c1', name: 'Volvo XC60',      range: 400, order: 1, hasLog: true },
  { id: 'c2', name: 'Tesla Model 3',   range: 500, order: 2, hasLog: true },
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

export const TEST_BOOKINGS_RESPONSE: BookingsResponse = {
  startDate: '2026-06-16',
  endDate:   '2026-06-22',
  since:     null,
  bookings:  TEST_BOOKINGS as any,
};

export const TEST_TRIPS = [
  {
    id: 't1',
    car: { id: 'c1' },
    odo: 87200,
    distance: 25,
    cost: 37.5,
    comment: '',
    timestamp: '2026-06-20T10:00:00.000Z',
    byUser: { id: 'u1' },
    users: [{ id: 'u1' }, { id: 'u2' }],
  },
  {
    id: 't2',
    car: { id: 'c1' },
    odo: 87150,
    distance: 15,
    cost: 22.5,
    comment: 'Förra resan',
    timestamp: '2026-06-18T09:00:00.000Z',
    byUser: { id: 'u2' },
    users: [{ id: 'u2' }],
  },
];

export const TEST_ADMIN_TRIPS = [
  {
    id: 'at1',
    car: { id: 'c1' },
    odo: 87200,
    distance: 25,
    cost: 37.5,
    comment: 'Init',
    timestamp: '2026-06-20T10:00:00.000Z',
    byUser: { id: 'u1' },
    users: [{ id: 'u1' }],
  },
  {
    id: 'at2',
    car: { id: 'c1' },
    odo: 87225,
    distance: 15,
    cost: 22.5,
    comment: 'Regular trip',
    timestamp: '2026-06-15T09:00:00.000Z',
    byUser: { id: 'u2' },
    users: [{ id: 'u1' }, { id: 'u2' }],
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

export const handlers = [
  // Generella resurser
  http.get('/api/v1/users',        () => HttpResponse.json(TEST_USERS)),
  http.get('/api/v1/cars',         () => HttpResponse.json(TEST_CARS)),
  http.get('/api/v1/destinations', () => HttpResponse.json(TEST_DESTINATIONS)),
  http.get('/api/v1/settings',     () => HttpResponse.json(TEST_SETTINGS)),

  // Bokningar
  http.get('/api/v1/bookings', () => HttpResponse.json(TEST_BOOKINGS_RESPONSE)),

  http.post('/api/v1/bookings', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ id: 'new-booking', ...body }, { status: 201 });
  }),

  http.delete('/api/v1/bookings/:parentId/:bookingId', () =>
    new HttpResponse(null, { status: 204 }),
  ),

  // Resor
  http.get('/api/v1/trips', () => HttpResponse.json(TEST_TRIPS)),

  http.post('/api/v1/trips', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ id: 'new-trip', ...body }, { status: 201 });
  }),

  http.put('/api/v1/trips/:id', async ({ request, params }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ id: params.id, ...body });
  }),

  http.delete('/api/v1/trips/:id', () => new HttpResponse(null, { status: 204 })),

  // Admin
  http.get('/api/v1/admin/trips', () => HttpResponse.json(TEST_ADMIN_TRIPS)),

  http.delete('/api/v1/admin/trips/:id', () => new HttpResponse(null, { status: 204 })),
];
