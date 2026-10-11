import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import { inspect } from 'node:util';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import bcrypt from 'bcrypt';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';

const issuer = 'https://issuer.example.com';
const redirectUri = 'https://app.example.com/api/v1/auth/oidc/callback';
process.env.OIDC_ISSUER = issuer;
process.env.OIDC_CLIENT_ID = 'test-client';
process.env.OIDC_CLIENT_SECRET = 'test-client-secret';
process.env.OIDC_REDIRECT_URI = redirectUri;
process.env.FRONTEND_URL = 'https://app.example.com';
const testDatabaseUrl = process.env.OIDC_TEST_DATABASE_URL;
if (testDatabaseUrl) {
  const url = new URL(testDatabaseUrl);
  if (url.hostname !== '127.0.0.1' || !url.pathname.startsWith('/ghcarpool_oidc_test_')) {
    throw new Error('OIDC integration requires an isolated local ghcarpool_oidc_test_ database');
  }
}
process.env.DATABASE_URL = testDatabaseUrl ?? 'postgresql://unused:unused@localhost:1/unused';
process.env.GOOGLE_CLIENT_ID = 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
process.env.GOOGLE_CALLBACK_URL = 'https://app.example.com/api/v1/auth/google/callback';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const users = [
  { id: 'LOCAL', email: 'local@example.com', isAdmin: false },
  { id: 'ADMIN', email: 'admin@example.com', isAdmin: true },
  { id: 'AUTHELIA', email: 'authelia@example.com', isAdmin: false },
  { id: 'PROFILE', email: 'profile@example.com', isAdmin: false },
];
const initialUserCount = users.length;
const identities = new Map<string, { issuer: string; subject: string; userId: string }>();
interface Grant {
  nonce: string;
  challenge: string;
  claims?: Record<string, unknown>;
  invalidSignature?: boolean;
  noIdToken?: boolean;
  tokenFailure?: boolean;
  userInfo?: Record<string, unknown>;
  userInfoFailure?: boolean;
  userInfoTransportFailure?: boolean;
  used?: boolean;
}
const grants = new Map<string, Grant>();
const accessTokens = new Map<string, Grant>();
const store = new session.MemoryStore();
let prisma: typeof import('../db/prisma').default;
let pgPool: Pool | undefined;
let pgStore: InstanceType<ReturnType<typeof connectPgSimple>> | undefined;
let app: express.Express;
let tokenRequests = 0;
let discoveryFailure = false;
let userInfoRequests = 0;

function privateAccessToken(code: string): string {
  return `private-access-token-${code}`;
}

function jwt(payload: Record<string, unknown>, invalidSignature = false): string {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), keys.privateKey);
  if (invalidSignature) signature[0] ^= 1;
  return `${head}.${body}.${signature.toString('base64url')}`;
}

before(async () => {
  // The protocol runs against the actual openid-client library with signed ID
  // tokens. OIDC_TEST_DATABASE_URL optionally exercises real PostgreSQL identity
  // constraints and connect-pg-simple sessions in an isolated test database.
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === 'object' && 'url' in input ? input.url : String(input));
    if (url.href === `${issuer}/.well-known/openid-configuration`) {
      if (discoveryFailure) return Response.json({ error: 'never-expose-this' }, { status: 503 });
      return Response.json({
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`, response_types_supported: ['code'],
        userinfo_endpoint: `${issuer}/userinfo`,
        subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (url.href === `${issuer}/jwks`) return Response.json({ keys: [jwk] });
    if (url.pathname === '/userinfo') {
      userInfoRequests++;
      assert.equal(url.origin, issuer);
      assert.equal(url.protocol, 'https:');
      assert.equal(url.search, '');
      assert.equal(init?.method, 'GET');
      assert.ok(init?.body === undefined || init?.body === null);
      const authorization = new Headers(init?.headers).get('authorization') ?? '';
      assert.ok(authorization.startsWith('Bearer '));
      const accessToken = authorization.slice('Bearer '.length);
      const grant = accessTokens.get(accessToken);
      assert.ok(grant);
      if (grant.userInfoTransportFailure) throw new Error(`UserInfo failure: ${accessToken}`);
      if (grant.userInfoFailure) {
        return Response.json({ error: 'server_error', error_description: accessToken }, { status: 503 });
      }
      return Response.json(grant.userInfo ?? { sub: grant.claims?.sub ?? 'subject-local' });
    }
    if (url.href !== `${issuer}/token`) throw new Error('Unexpected provider request');
    tokenRequests++;
    const body = new URLSearchParams(String(init?.body));
    const grant = grants.get(body.get('code') ?? '');
    if (!grant || grant.used) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    if (grant.tokenFailure) return Response.json({ error: 'server_error', error_description: 'never-expose-this' }, { status: 503 });
    assert.equal(body.get('redirect_uri'), redirectUri);
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(createHash('sha256').update(body.get('code_verifier') ?? '').digest('base64url'), grant.challenge);
    assert.ok(new Headers(init?.headers).get('authorization')?.startsWith('Basic '));
    grant.used = true;
    const accessToken = privateAccessToken(body.get('code')!);
    accessTokens.set(accessToken, grant);
    const now = Math.floor(Date.now() / 1000);
    const idToken = jwt({
      iss: issuer, sub: 'subject-local', aud: 'test-client', iat: now, exp: now + 300,
      nonce: grant.nonce, email: users[0].email, email_verified: true,
      groups: ['admins'], isAdmin: true, ...grant.claims,
    }, grant.invalidSignature);
    return Response.json({
      access_token: accessToken, token_type: 'Bearer', expires_in: 300,
      ...(grant.noIdToken ? {} : { id_token: idToken }),
    });
  });
  prisma = (await import('../db/prisma')).default;
  const { Prisma } = await import('../generated/prisma/client');
  const passwordHash = await bcrypt.hash('test-local-password', 4);
  if (testDatabaseUrl) {
    await prisma.user.createMany({ data: users.map((user) => ({ ...user, passwordHash })) });
  } else {
    // Prisma delegates expose proxy methods; replace them through their setters.
    Reflect.set(prisma.user, 'findUnique', mock.fn(async ({
      where, select,
    }: { where: { id?: string; email?: string }; select?: object }) => {
      const user = users.find((candidate) => where.id ? candidate.id === where.id : candidate.email === where.email);
      return user ? select ? { ...user } : { ...user, passwordHash } : null;
    }));
    Reflect.set(prisma.oidcIdentity, 'findUnique', mock.fn(async ({
      where,
    }: { where: { issuer_subject: { issuer: string; subject: string } } }) => {
      const identity = identities.get(`${where.issuer_subject.issuer}|${where.issuer_subject.subject}`);
      return identity ? { ...identity, user: users.find((user) => user.id === identity.userId) } : null;
    }));
    Reflect.set(prisma.oidcIdentity, 'create', mock.fn(async ({
      data,
    }: { data: { issuer: string; subject: string; userId: string } }) => {
      if (identities.has(`${data.issuer}|${data.subject}`) ||
          [...identities.values()].some((identity) => identity.issuer === data.issuer && identity.userId === data.userId)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint', { code: 'P2002', clientVersion: '7' });
      }
      identities.set(`${data.issuer}|${data.subject}`, data);
      return data;
    }));
  }
  const passport = (await import('../lib/passport')).default;
  const router = (await import('../routes/auth')).default;
  app = express();
  app.use(express.json());
  let sessionStore: session.Store = store;
  if (testDatabaseUrl) {
    pgPool = new Pool({ connectionString: testDatabaseUrl });
    const PgSession = connectPgSimple(session);
    pgStore = new PgSession({ pool: pgPool, tableName: 'session', createTableIfMissing: false });
    sessionStore = pgStore;
  }
  app.use(session({ secret: 'test-session-secret', store: sessionStore, resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.use('/api/v1/auth', router);
  app.get('/protected', (req, res) => res.status(req.user ? 200 : 401).json({ user: req.user ?? null }));
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });
});

after(async () => {
  mock.restoreAll();
  if (testDatabaseUrl) {
    pgStore?.close();
    await pgPool?.end();
    await prisma?.$disconnect();
  }
});

async function sessions(): Promise<Record<string, session.SessionData>> {
  if (!testDatabaseUrl) {
    return new Promise((resolve, reject) => store.all((err, result) => err ? reject(err) : resolve(result ?? {})));
  }
  const rows = await prisma.session.findMany();
  return Object.fromEntries(rows.map((row) => [row.sid, JSON.parse(JSON.stringify(row.sess))]));
}

async function saveSession(sid: string, data: session.SessionData) {
  if (testDatabaseUrl) {
    await prisma.session.update({ where: { sid }, data: { sess: JSON.parse(JSON.stringify(data)) } });
  } else {
    await new Promise<void>((resolve, reject) => store.set(sid, data, (err) => err ? reject(err) : resolve()));
  }
}

async function begin(returnTo = '/book-trip?car=ABC#details', grantOverrides: Partial<Grant> = {}) {
  const agent = request.agent(app);
  const response = await agent.get('/api/v1/auth/oidc').query({ returnTo });
  assert.equal(response.status, 302);
  const authorization = new URL(response.headers.location);
  const params = authorization.searchParams;
  assert.equal(params.get('redirect_uri'), redirectUri);
  assert.equal(params.get('response_type'), 'code');
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.equal(params.get('scope'), 'openid email profile');
  assert.ok(params.get('state'));
  assert.ok(params.get('nonce'));
  const code = `code-${grants.size}`;
  grants.set(code, {
    nonce: params.get('nonce')!, challenge: params.get('code_challenge')!, ...grantOverrides,
  });
  return { agent, code, state: params.get('state')!, response };
}

test('runtime config reveals enabled providers but no secrets', async () => {
  const response = await request(app).get('/api/v1/auth/config');
  assert.deepEqual(response.body, { local: true, google: true, oidc: true });
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('discovery failure is sanitized and can be retried without restarting', async () => {
  discoveryFailure = true;
  const response = await request(app).get('/api/v1/auth/oidc');
  discoveryFailure = false;
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: 'OIDC authentication failed' });
});

test('local and Google login remain available alongside OIDC', async () => {
  const agent = request.agent(app);
  const login = await agent.post('/api/v1/auth/login')
    .send({ email: users[0].email, password: 'test-local-password' });
  assert.equal(login.status, 200);
  assert.deepEqual(login.body, users[0]);
  assert.deepEqual((await agent.get('/api/v1/auth/me')).body, users[0]);
  const google = await request(app).get('/api/v1/auth/google');
  assert.equal(google.status, 302);
  const url = new URL(google.headers.location);
  assert.equal(url.hostname, 'accounts.google.com');
  assert.equal(url.searchParams.get('redirect_uri'), process.env.GOOGLE_CALLBACK_URL);
});

test('callback links an existing user, rotates login session, restores deep link and keeps local privileges', async () => {
  const { agent, code, state, response: initial } = await begin();
  const callback = await agent.get('/api/v1/auth/oidc/callback').query({ code, state })
    .set('Host', 'attacker.example.com').set('X-Forwarded-Host', 'attacker.example.com')
    .set('Remote-User', 'ADMIN').set('X-Forwarded-User', 'ADMIN');
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.location, 'https://app.example.com/book-trip?car=ABC#details');
  assert.notEqual(callback.headers['set-cookie'][0].split(';')[0], initial.headers['set-cookie'][0].split(';')[0]);
  const me = await agent.get('/api/v1/auth/me');
  assert.deepEqual(me.body, users[0]);
  assert.equal((await agent.get('/protected')).status, 200);
  if (testDatabaseUrl) assert.ok(await prisma.session.count());
  const oldCookie = initial.headers['set-cookie'][0].split(';')[0];
  assert.deepEqual((await request(app).get('/api/v1/auth/me').set('Cookie', oldCookie)).body, { user: null });
});

test('issuer+subject is authoritative even with missing or changed email', async () => {
  const count = userInfoRequests;
  const { agent, code, state } = await begin('/home', {
    claims: { email: users[1].email, email_verified: false }, userInfoFailure: true,
  });
  await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
  assert.deepEqual((await agent.get('/api/v1/auth/me')).body, users[0]);
  const missing = await begin('/home', {
    claims: { email: undefined, email_verified: undefined }, userInfoFailure: true,
  });
  await missing.agent.get('/api/v1/auth/oidc/callback').query({ code: missing.code, state: missing.state });
  assert.deepEqual((await missing.agent.get('/api/v1/auth/me')).body, users[0]);
  assert.equal(userInfoRequests, count);
});

test('a new subject cannot take over the linked email', async () => {
  const { agent, code, state } = await begin('/home', { claims: { sub: 'replacement-subject' } });
  const response = await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
  assert.equal(response.headers.location, 'https://app.example.com/login?error=oidc');
  assert.deepEqual((await agent.get('/api/v1/auth/me')).body, { user: null });
});

for (const [name, claims] of [
  ['missing email', { sub: 'new-missing', email: undefined }],
  ['unverified email', { sub: 'new-unverified', email_verified: false }],
  ['string email verification', { sub: 'new-string-verified', email_verified: 'true' }],
  ['nonexistent user', { sub: 'unknown-user', email: 'unknown@example.com' }],
  ['wrong issuer', { iss: 'https://other.example.com' }],
  ['wrong audience', { aud: 'other-client' }],
  ['wrong nonce', { nonce: 'incorrect-nonce' }],
  ['expired ID token', { exp: Math.floor(Date.now() / 1000) - 600 }],
] as const) {
  test(`rejects ${name} without creating a login session`, async () => {
    const { agent, code, state } = await begin('/home', { claims });
    const response = await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
    assert.equal(response.headers.location, 'https://app.example.com/login?error=oidc');
    assert.deepEqual((await agent.get('/api/v1/auth/me')).body, { user: null });
  });
}

for (const [name, override] of [
  ['invalid signature', { invalidSignature: true }],
  ['missing ID token', { noIdToken: true }],
  ['token endpoint failure', { tokenFailure: true }],
] as const) {
  test(`rejects ${name}`, async () => {
    const { agent, code, state } = await begin('/home', override);
    const response = await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
    assert.equal(response.headers.location, 'https://app.example.com/login?error=oidc');
    assert.deepEqual((await agent.get('/api/v1/auth/me')).body, { user: null });
  });
}

test('failed first links never create local users', async () => {
  assert.equal(testDatabaseUrl ? await prisma.user.count() : users.length, initialUserCount);
});

test('Authelia minimal signed ID token links through verified subject-bound UserInfo', async () => {
  const count = userInfoRequests;
  const { agent, code, state } = await begin('/book-trip?car=ABC#details', {
    claims: { sub: 'subject-authelia', email: undefined, email_verified: undefined },
    userInfo: {
      sub: 'subject-authelia', email: users[2].email, email_verified: true,
      iss: 'https://not-the-validated-issuer.example', groups: ['admins'], isAdmin: true,
    },
  });
  const response = await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
  assert.equal(response.headers.location, 'https://app.example.com/book-trip?car=ABC#details');
  assert.deepEqual((await agent.get('/api/v1/auth/me')).body, users[2]);
  assert.equal(userInfoRequests, count + 1);
  const accessToken = privateAccessToken(code);
  assert.ok(!JSON.stringify(response.headers).includes(accessToken));
  assert.ok(!response.text.includes(accessToken));
  assert.ok(!JSON.stringify(await sessions()).includes(accessToken));
});

test('first link with missing signed verification uses only UserInfo email and verification', async () => {
  const { agent, code, state } = await begin('/home', {
    claims: { sub: 'subject-profile', email: users[1].email, email_verified: undefined },
    userInfo: { sub: 'subject-profile', email: users[3].email, email_verified: true, isAdmin: true },
  });
  const response = await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
  assert.equal(response.headers.location, 'https://app.example.com/home');
  assert.deepEqual((await agent.get('/api/v1/auth/me')).body, users[3]);
});

test('linked Authelia subject requires neither email nor an available UserInfo endpoint', async () => {
  const count = userInfoRequests;
  const { agent, code, state } = await begin('/home', {
    claims: { sub: 'subject-authelia', email: undefined, email_verified: undefined },
    userInfoFailure: true,
  });
  const response = await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
  assert.equal(response.headers.location, 'https://app.example.com/home');
  assert.deepEqual((await agent.get('/api/v1/auth/me')).body, users[2]);
  assert.equal(userInfoRequests, count);
});

for (const [name, userInfo] of [
  ['mismatched subject', { sub: 'different-subject', email: users[2].email, email_verified: true }],
  ['missing subject', { email: users[2].email, email_verified: true }],
  ['unverified email', { email: users[2].email, email_verified: false }],
  ['string verification', { email: users[2].email, email_verified: 'true' }],
  ['missing email', { email_verified: true }],
  ['missing verification', { email: users[2].email }],
  ['unknown local user', { email: 'unknown-userinfo@example.com', email_verified: true }],
] as const) {
  test(`rejects UserInfo ${name} without linking or provisioning`, async () => {
    const subject = `userinfo-reject-${grants.size}`;
    const count = userInfoRequests;
    const { agent, code, state } = await begin('/home', {
      claims: { sub: subject, email: undefined, email_verified: undefined },
      userInfo: Object.assign({ sub: subject }, userInfo),
    });
    if (name === 'missing subject') delete grants.get(code)!.userInfo!.sub;
    const response = await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
    assert.equal(response.headers.location, 'https://app.example.com/login?error=oidc');
    assert.deepEqual((await agent.get('/api/v1/auth/me')).body, { user: null });
    assert.equal(userInfoRequests, count + 1);
    assert.equal(testDatabaseUrl ? await prisma.user.count() : users.length, initialUserCount);
  });
}

for (const email_verified of [false, 'false', 'true', null]) {
  test(`explicit ID-token verification ${email_verified} is not overridden through UserInfo`, async () => {
    const subject = `explicit-unverified-${grants.size}`;
    const count = userInfoRequests;
    const { agent, code, state } = await begin('/home', {
      claims: { sub: subject, email: undefined, email_verified },
      userInfo: { sub: subject, email: users[2].email, email_verified: true },
    });
    const response = await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
    assert.equal(response.headers.location, 'https://app.example.com/login?error=oidc');
    assert.equal(userInfoRequests, count);
  });
}

test('unknown complete signed email cannot be substituted with a UserInfo email', async () => {
  const count = userInfoRequests;
  const { agent, code, state } = await begin('/home', {
    claims: { sub: 'unknown-signed-email', email: 'unknown-signed@example.com', email_verified: true },
    userInfo: { sub: 'unknown-signed-email', email: users[2].email, email_verified: true },
  });
  const response = await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
  assert.equal(response.headers.location, 'https://app.example.com/login?error=oidc');
  assert.equal(userInfoRequests, count);
});

test('ID-token signature is validated before a missing email can trigger UserInfo', async () => {
  const count = userInfoRequests;
  const { agent, code, state } = await begin('/home', {
    claims: { sub: 'invalid-signed-authelia', email: undefined, email_verified: undefined },
    userInfo: { sub: 'invalid-signed-authelia', email: users[2].email, email_verified: true },
    invalidSignature: true,
  });
  const response = await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
  assert.equal(response.headers.location, 'https://app.example.com/login?error=oidc');
  assert.equal(userInfoRequests, count);
});

for (const failure of ['provider', 'transport'] as const) {
  test(`UserInfo ${failure} failure does not leak the private access token or create a session`, async (context) => {
    const errors = context.mock.method(console, 'error', () => {});
    const warnings = context.mock.method(console, 'warn', () => {});
    const logs = context.mock.method(console, 'log', () => {});
    const count = userInfoRequests;
    const { agent, code, state } = await begin('/home', {
      claims: { sub: `userinfo-failure-${failure}`, email: undefined, email_verified: undefined },
      userInfoFailure: failure === 'provider',
      userInfoTransportFailure: failure === 'transport',
    });
    const response = await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
    assert.equal(response.headers.location, 'https://app.example.com/login?error=oidc');
    assert.deepEqual((await agent.get('/api/v1/auth/me')).body, { user: null });
    assert.equal(userInfoRequests, count + 1);
    const accessToken = privateAccessToken(code);
    assert.ok(!response.text.includes(accessToken));
    assert.ok(!JSON.stringify(response.headers).includes(accessToken));
    assert.ok(!JSON.stringify(await sessions()).includes(accessToken));
    for (const logger of [errors, warnings, logs]) {
      assert.ok(!inspect(logger.mock.calls.map((call) => call.arguments), { depth: null }).includes(accessToken));
    }
  });
}

test('a new subject cannot use UserInfo to take over a linked local email', async () => {
  const { agent, code, state } = await begin('/home', {
    claims: { sub: 'userinfo-takeover', email: undefined, email_verified: undefined },
    userInfo: { sub: 'userinfo-takeover', email: users[2].email, email_verified: true },
  });
  const response = await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
  assert.equal(response.headers.location, 'https://app.example.com/login?error=oidc');
  assert.deepEqual((await agent.get('/api/v1/auth/me')).body, { user: null });
});

test('state mismatch and provider denial consume the transaction without a token exchange', async () => {
  const { agent, code, state } = await begin();
  const count = tokenRequests;
  const mismatch = await agent.get('/api/v1/auth/oidc/callback').query({ code, state: 'incorrect-state' });
  assert.equal(mismatch.headers.location, 'https://app.example.com/login?error=oidc');
  assert.equal(tokenRequests, count);
  const retry = await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
  assert.equal(retry.headers.location, 'https://app.example.com/login?error=oidc');
  assert.equal(tokenRequests, count);
  const denial = await begin();
  const denied = await denial.agent.get('/api/v1/auth/oidc/callback')
    .query({ state: denial.state, error: 'access_denied', error_description: 'never-expose-this' });
  assert.equal(denied.headers.location, 'https://app.example.com/login?error=oidc');
  assert.equal(tokenRequests, count);
});

test('missing session, missing code and forged identity headers cannot log in', async () => {
  for (const query of [{}, { code: 'fake-code', state: 'fake-state' }]) {
    const response = await request(app).get('/api/v1/auth/oidc/callback').query(query)
      .set('Remote-User', 'ADMIN').set('X-Forwarded-User', 'ADMIN');
    assert.equal(response.headers.location, 'https://app.example.com/login?error=oidc');
  }
  assert.equal((await request(app).get('/protected').set('Remote-User', 'ADMIN')).status, 401);
  const started = await begin();
  const count = tokenRequests;
  const missingCode = await started.agent.get('/api/v1/auth/oidc/callback').query({ state: started.state });
  assert.equal(missingCode.headers.location, 'https://app.example.com/login?error=oidc');
  assert.equal(tokenRequests, count);
});

test('external and normalized protocol-relative return targets are replaced with a same-origin home URL', async () => {
  for (const target of ['https://evil.example.com', '/a/..//evil.example.com']) {
    const { agent, code, state } = await begin(target);
    const response = await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
    assert.equal(response.headers.location, 'https://app.example.com/home');
  }
});

test('successful callback cannot be replayed', async () => {
  const { agent, code, state } = await begin();
  const callback = await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
  assert.equal(callback.headers.location, 'https://app.example.com/book-trip?car=ABC#details');
  const count = tokenRequests;
  const replay = await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
  assert.equal(replay.headers.location, 'https://app.example.com/login?error=oidc');
  assert.equal(tokenRequests, count);
});

test('expired authorization transaction is consumed without exchanging a code', async () => {
  const { agent, code, state } = await begin();
  for (const [sid, data] of Object.entries(await sessions())) {
    if (!data.oidc || data.oidc.state !== state) continue;
    data.oidc.createdAt = Date.now() - 11 * 60 * 1000;
    await saveSession(sid, data);
  }
  const count = tokenRequests;
  const response = await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
  assert.equal(response.headers.location, 'https://app.example.com/login?error=oidc');
  assert.equal(tokenRequests, count);
  assert.deepEqual((await agent.get('/api/v1/auth/me')).body, { user: null });
});

test('logout clears cookie, destroys local session and does not contact the provider', async () => {
  const { agent, code, state } = await begin();
  const callback = await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
  const loggedInCookie = callback.headers['set-cookie'][0].split(';')[0];
  const count = tokenRequests;
  const logout = await agent.post('/api/v1/auth/logout');
  assert.deepEqual(logout.body, { ok: true });
  assert.match(logout.headers['set-cookie'][0], /connect.sid=;/);
  assert.deepEqual((await agent.get('/api/v1/auth/me')).body, { user: null });
  assert.equal((await request(app).get('/protected').set('Cookie', loggedInCookie)).status, 401);
  assert.equal(tokenRequests, count);
});

test('expired local session cannot authenticate protected requests', async () => {
  const { agent, code, state } = await begin();
  await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
  if (testDatabaseUrl) {
    await prisma.session.updateMany({ data: { expire: new Date(Date.now() - 1000) } });
  } else {
    for (const [sid, data] of Object.entries(await sessions())) {
      data.cookie.expires = new Date(Date.now() - 1000);
      await saveSession(sid, data);
    }
  }
  assert.equal((await agent.get('/protected')).status, 401);
});

test('local DB privilege changes are reloaded and deleting the local user revokes access', async () => {
  const { agent, code, state } = await begin();
  await agent.get('/api/v1/auth/oidc/callback').query({ code, state });
  users[0].isAdmin = true;
  if (testDatabaseUrl) await prisma.user.update({ where: { id: users[0].id }, data: { isAdmin: true } });
  assert.equal((await agent.get('/api/v1/auth/me')).body.isAdmin, true);
  users[0].isAdmin = false;
  if (testDatabaseUrl) await prisma.user.update({ where: { id: users[0].id }, data: { isAdmin: false } });
  assert.equal((await agent.get('/api/v1/auth/me')).body.isAdmin, false);
  const removed = users.shift()!;
  if (testDatabaseUrl) await prisma.user.delete({ where: { id: removed.id } });
  try {
    assert.equal((await agent.get('/protected')).status, 401);
  } finally {
    users.unshift(removed);
    if (testDatabaseUrl) await prisma.user.create({ data: removed });
  }
});
