import request from 'supertest';
import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import prisma from '../db/prisma';

// Mocka firebase-admin modulen
jest.mock('../lib/firebase-admin', () => ({
  firebaseAuth: {
    verifyIdToken: jest.fn(),
  },
}));

import { firebaseAuth } from '../lib/firebase-admin';
const mockVerify = firebaseAuth.verifyIdToken as jest.Mock;

// Testapp
const app = express();
app.use(express.json());

app.get('/protected', requireAuth, (req, res) => {
  res.json({ userId: req.user!.id, email: req.user!.email });
});

app.get('/admin-only', requireAuth, requireAdmin, (_req, res) => {
  res.json({ ok: true });
});

describe('requireAuth middleware', () => {
  const TEST_EMAIL = `auth-test-${Date.now()}@example.com`;

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: 'auth-test-' } } });
    await prisma.$disconnect();
  });

  it('returnerar 401 om Authorization-header saknas', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Saknar/);
  });

  it('returnerar 401 vid ogiltig token', async () => {
    mockVerify.mockRejectedValueOnce(new Error('invalid token'));
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer bad-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Ogiltig token');
  });

  it('skapar användare och tillåter åtkomst med giltig token', async () => {
    mockVerify.mockResolvedValueOnce({ uid: 'uid-123', email: TEST_EMAIL });
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer valid-token`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(TEST_EMAIL);

    const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
    expect(user).not.toBeNull();
  });

  it('returnerar samma användare vid andra anropet (upsert idempotent)', async () => {
    mockVerify.mockResolvedValueOnce({ uid: 'uid-123', email: TEST_EMAIL });
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer valid-token`);
    expect(res.status).toBe(200);

    const count = await prisma.user.count({ where: { email: TEST_EMAIL } });
    expect(count).toBe(1);
  });
});

describe('requireAdmin middleware', () => {
  const ADMIN_EMAIL = `admin-test-${Date.now()}@example.com`;
  const USER_EMAIL = `user-test-${Date.now()}@example.com`;

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [ADMIN_EMAIL, USER_EMAIL] } },
    });
  });

  it('returnerar 403 för icke-admin', async () => {
    mockVerify.mockResolvedValueOnce({ uid: 'uid-user', email: USER_EMAIL });
    const res = await request(app)
      .get('/admin-only')
      .set('Authorization', 'Bearer user-token');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Åtkomst nekad');
  });

  it('tillåter åtkomst för admin-användare', async () => {
    // Skapa en admin-användare direkt i DB
    await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      create: { email: ADMIN_EMAIL, isAdmin: true },
      update: { isAdmin: true },
    });

    mockVerify.mockResolvedValueOnce({ uid: 'uid-admin', email: ADMIN_EMAIL });
    const res = await request(app)
      .get('/admin-only')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
