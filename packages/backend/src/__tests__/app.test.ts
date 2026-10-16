import request from 'supertest';

jest.mock('../db/prisma', () => ({ __esModule: true, default: {} }));

import app from '../app';

it('keeps health public and JSON', async () => {
  const res = await request(app).get('/health').set('Accept', 'text/html');
  expect(res.status).toBe(200);
  expect(res.type).toBe('application/json');
  expect(res.body).toEqual({ status: 'ok' });
});

it.each(['/api', '/api/not-found', '/health/not-found'])(
  'keeps reserved unknown route %s as JSON 404', async url => {
    const res = await request(app).get(url).set('Accept', 'text/html');
    expect(res.status).toBe(404);
    expect(res.type).toBe('application/json');
    expect(res.body.error).toBeDefined();
  },
);

it('leaves existing auth routes mounted', async () => {
  const res = await request(app).post('/api/v1/auth/login').send({});
  expect(res.status).toBe(401);
  expect(res.type).toBe('application/json');
});

it.each(['/api/v1/bookings/stream', '/api/v1/trips/stream', '/api/v1/config'])(
  'keeps endpoint %s session-protected', async url => {
    const res = await request(app).get(url).set('Accept', 'text/event-stream');
    expect(res.status).toBe(401);
    expect(res.type).toBe('application/json');
  },
);
