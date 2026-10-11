import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { frontendMiddleware } from '../middleware/frontend';

let directory: string;
let app: express.Express;

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'ghcarpool-frontend-'));
  mkdirSync(path.join(directory, 'assets'));
  mkdirSync(path.join(directory, 'api'));
  writeFileSync(path.join(directory, 'index.html'), '<html>carpool SPA</html>');
  writeFileSync(path.join(directory, 'assets', 'app-hash.js'), 'console.log("app")');
  writeFileSync(path.join(directory, 'api', 'leak.html'), 'must not be served');
  writeFileSync(path.join(directory, 'health'), 'must not be served');
  app = express();
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use(frontendMiddleware(directory));
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
});

afterAll(() => rmSync(directory, { recursive: true, force: true }));

it.each(['/', '/login', '/register-trip', '/booking-overview?date=2026-10-11'])(
  'serves the SPA for HTML navigation to %s', async url => {
    const res = await request(app).get(url).set('Accept', 'text/html');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('carpool SPA');
    expect(res.headers['cache-control']).toBe('no-cache');
  },
);

it('supports HEAD navigation without a body', async () => {
  const res = await request(app).head('/login').set('Accept', 'text/html');
  expect(res.status).toBe(200);
  expect(res.type).toBe('text/html');
  expect(res.text).toBeUndefined();
});

it('serves built assets with immutable caching', async () => {
  const res = await request(app).get('/assets/app-hash.js');
  expect(res.status).toBe(200);
  expect(res.text).toContain('console.log');
  expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
});

it('keeps index.html revalidatable', async () => {
  const res = await request(app).get('/index.html');
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('no-cache');
});

it('does not replace health JSON with the SPA', async () => {
  const res = await request(app).get('/health').set('Accept', 'text/html');
  expect(res.body).toEqual({ status: 'ok' });
});

it.each([
  '/api', '/api/unknown', '/api/v1/unknown', '/API/unknown',
  '/api/leak.html', '/api%2Fleak.html', '/%61pi/unknown',
  '/health/missing', '/HEALTH/missing', '/%68ealth/missing',
  '/assets/missing.js', '/assets/missing', '/missing.css', '/favicon.ico',
  '/.env', '/%2eenv', '/nested/%2e%2e%2flogin', '/login%ZZ',
])('returns JSON 404 instead of static files or SPA for %s', async url => {
  const res = await request(app).get(url).set('Accept', 'text/html');
  expect(res.status).toBe(404);
  expect(res.type).toBe('application/json');
});

it.each(['application/json', 'text/event-stream', '*/*', 'text/html;q=0'])(
  'does not use SPA fallback for Accept: %s', async accept => {
    const res = await request(app).get('/login').set('Accept', accept);
    expect(res.status).toBe(404);
    expect(res.type).toBe('application/json');
  },
);

it('does not use SPA fallback without an Accept header', async () => {
  expect((await request(app).get('/login')).status).toBe(404);
});

it.each(['post', 'put', 'delete', 'options'] as const)(
  'does not use SPA fallback for %s', async method => {
    const res = await request(app)[method]('/login').set('Accept', 'text/html');
    expect(res.status).toBe(404);
  },
);

it('fails explicitly when the frontend build is missing', () => {
  expect(() => frontendMiddleware(path.join(directory, 'missing'))).toThrow(/ENOENT/);
});
