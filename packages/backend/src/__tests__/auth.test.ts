import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../app';
import prisma from '../db/prisma';

const TEST_EMAIL = `auth-test-${Date.now()}@example.com`;
const TEST_PASSWORD = 'testlösenord123';
const ADMIN_EMAIL = `admin-test-${Date.now()}@example.com`;

beforeAll(async () => {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: TEST_EMAIL },
    create: { id: `TAUTH${Date.now().toString(36).slice(-4).toUpperCase()}`, email: TEST_EMAIL, passwordHash },
    update: { passwordHash },
  });
  const adminHash = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: { id: `TADM${Date.now().toString(36).slice(-4).toUpperCase()}`, email: ADMIN_EMAIL, isAdmin: true, passwordHash: adminHash },
    update: { isAdmin: true, passwordHash: adminHash },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { in: [TEST_EMAIL, ADMIN_EMAIL] } },
  });
  await prisma.$disconnect();
});

// ── POST /api/v1/auth/login ───────────────────────────────────────────────────

describe('POST /api/v1/auth/login', () => {
  it('returnerar 401 utan body', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({});
    expect(res.status).toBe(401);
  });

  it('returnerar 401 med fel lösenord', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_EMAIL, password: 'fel-lösenord' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Fel e-post eller lösenord/);
  });

  it('returnerar 401 för okänd e-post', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'okänd@example.com', password: TEST_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('returnerar 200 med rätt inloggning', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(TEST_EMAIL);
    expect(res.body).not.toHaveProperty('passwordHash');
  });
});

// ── GET /api/v1/auth/me ───────────────────────────────────────────────────────

describe('GET /api/v1/auth/me', () => {
  it('returnerar 401 utan session', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('returnerar inloggad användare med giltig session', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/v1/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const res = await agent.get('/api/v1/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(TEST_EMAIL);
  });
});

// ── POST /api/v1/auth/logout ──────────────────────────────────────────────────

describe('POST /api/v1/auth/logout', () => {
  it('loggar ut och invaliderar sessionen', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/v1/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const logoutRes = await agent.post('/api/v1/auth/logout');
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.ok).toBe(true);

    // /me ska nu returnera 401
    const meRes = await agent.get('/api/v1/auth/me');
    expect(meRes.status).toBe(401);
  });
});

// ── requireAuth + requireAdmin via skyddade routes ────────────────────────────

describe('requireAuth middleware', () => {
  it('returnerar 401 på skyddad route utan session', async () => {
    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(401);
  });

  it('tillåter åtkomst med giltig session', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/v1/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const res = await agent.get('/api/v1/users');
    expect(res.status).toBe(200);
  });
});

describe('requireAdmin middleware', () => {
  it('returnerar 403 för icke-admin', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/v1/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const res = await agent.get('/api/v1/admin/users');
    expect(res.status).toBe(403);
  });

  it('tillåter åtkomst för admin', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'admin123' });

    const res = await agent.get('/api/v1/admin/users');
    expect(res.status).toBe(200);
  });
});
