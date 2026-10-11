import express from 'express';
import cors from 'cors';
import session from 'express-session';
import request from 'supertest';
import { parseTrustProxy, proxyConfiguration, type TrustProxy } from '../middleware/proxy';

describe('TRUST_PROXY validation', () => {
  it.each<[string | undefined, TrustProxy]>([
    [undefined, false], ['false', false], ['0', false], ['1', 1], ['2', 2],
    ['127.0.0.1', ['127.0.0.1']], ['::1/128', ['::1/128']],
    ['10.0.0.0/24, 192.168.1.2', ['10.0.0.0/24', '192.168.1.2']],
    ['loopback,linklocal,uniquelocal', ['loopback', 'linklocal', 'uniquelocal']],
  ])('parses %s', (value, expected) => {
    expect(parseTrustProxy(value)).toEqual(expected);
  });

  it.each([
    '', 'true', '-1', '1.5', '01', '9007199254740992', 'all', 'localhost',
    '127.0.0.1,', '10.0.0.1/33', '::1/129', '10.0.0.1/-1', '::1/foo',
    '10.0.0.1/24/1', 'false,loopback',
  ])('rejects invalid or blanket trust: %s', value => {
    expect(() => parseTrustProxy(value)).toThrow(/TRUST_PROXY/);
  });
});

describe('origin and cookie configuration', () => {
  it('defaults to local credentialed Vite CORS and no proxy trust', () => {
    expect(proxyConfiguration({})).toEqual({
      trustProxy: false,
      corsOptions: { origin: 'http://localhost:5173', credentials: true },
    });
  });

  it('disables CORS in same-origin production', () => {
    expect(proxyConfiguration({
      NODE_ENV: 'production', FRONTEND_URL: 'https://carpool.example',
      COOKIE_SECURE: 'true', TRUST_PROXY: '10.0.0.2',
    })).toEqual({ trustProxy: ['10.0.0.2'], corsOptions: undefined });
  });

  it.each([
    { NODE_ENV: 'production' },
    { FRONTEND_URL: 'not-a-url' },
    { FRONTEND_URL: 'ftp://carpool.example' },
    { FRONTEND_URL: 'http://user:password@carpool.example' },
    { FRONTEND_URL: 'http://carpool.example/path' },
    { FRONTEND_URL: 'http://carpool.example?query=1' },
    { FRONTEND_URL: 'http://carpool.example#fragment' },
    { COOKIE_SECURE: 'yes' },
    { COOKIE_SECURE: 'true', FRONTEND_URL: 'http://localhost:3001' },
    { NODE_ENV: 'production', FRONTEND_URL: 'https://carpool.example', COOKIE_SECURE: 'false' },
  ])('rejects invalid origin/cookie configuration: %j', env => {
    expect(() => proxyConfiguration(env)).toThrow(/FRONTEND_URL|COOKIE_SECURE/);
  });
});

function proxyApp(trust: string, production = true) {
  const app = express();
  const config = proxyConfiguration({
    NODE_ENV: production ? 'production' : 'development',
    FRONTEND_URL: 'https://carpool.example',
    COOKIE_SECURE: 'true',
    TRUST_PROXY: trust,
  });
  app.set('trust proxy', config.trustProxy);
  if (config.corsOptions) app.use(cors(config.corsOptions));
  app.use(session({
    secret: 'a-long-random-test-secret-for-proxy-tests',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true, httpOnly: true, sameSite: 'lax' },
  }));
  app.get('/session', (req, res) => {
    Object.assign(req.session, { authenticated: true });
    req.session.cookie.maxAge = 60_000;
    res.json({ secure: req.secure, ip: req.ip });
  });
  return app;
}

it('sets a Secure session cookie when a trusted proxy forwards HTTPS', async () => {
  const res = await request(proxyApp('loopback')).get('/session')
    .set('X-Forwarded-Proto', 'https').set('X-Forwarded-For', '192.0.2.10');
  expect(res.body).toEqual({ secure: true, ip: '192.0.2.10' });
  expect(res.headers['set-cookie'][0]).toMatch(/; Secure/);
  expect(res.headers['set-cookie'][0]).toMatch(/; HttpOnly/);
  expect(res.headers['set-cookie'][0]).toMatch(/; SameSite=Lax/);
});

it.each(['false', '192.0.2.1'])('ignores spoofed forwarding headers with trust %s', async trust => {
  const res = await request(proxyApp(trust)).get('/session')
    .set('X-Forwarded-Proto', 'https').set('X-Forwarded-For', '192.0.2.10');
  expect(res.body.secure).toBe(false);
  expect(res.body.ip).not.toBe('192.0.2.10');
  expect(res.headers['set-cookie']).toBeUndefined();
});

it('does not emit broad CORS headers in production', async () => {
  const res = await request(proxyApp('loopback')).get('/session').set('Origin', 'https://other.example');
  expect(res.headers['access-control-allow-origin']).toBeUndefined();
  expect(res.headers['access-control-allow-credentials']).toBeUndefined();
});

it('supports credentialed local Vite preflight', async () => {
  const app = express();
  app.use(cors(proxyConfiguration({}).corsOptions));
  const res = await request(app).options('/api/v1/auth/login')
    .set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST');
  expect(res.status).toBe(204);
  expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  expect(res.headers['access-control-allow-credentials']).toBe('true');
});
