/**
 * E2E-tester för expenses API.
 */
import request from 'supertest';
import app from '../app';
import prisma from '../db/prisma';
import { createTestUser, createTestCar, loginAgent } from './helpers';

let userAgent: request.Agent;
let adminAgent: request.Agent;
let userId: string;
let adminId: string;
let carId: string;
let otherAgent: request.Agent;
let otherId: string;

beforeAll(async () => {
  const { user, password } = await createTestUser();
  userId = user.id;
  userAgent = await loginAgent(user.email, password);

  const { user: admin, password: adminPw } = await createTestUser({ isAdmin: true });
  adminId = admin.id;
  adminAgent = await loginAgent(admin.email, adminPw);

  const { user: other, password: otherPw } = await createTestUser();
  otherId = other.id;
  otherAgent = await loginAgent(other.email, otherPw);

  const car = await createTestCar();
  carId = car.id;
});

afterAll(async () => {
  await prisma.expense.deleteMany({ where: { carId } });
  await prisma.car.delete({ where: { id: carId } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, adminId, otherId] } } });
  await prisma.$disconnect();
});

describe('GET /api/v1/expenses', () => {
  it('returnerar 401 utan session', async () => {
    const res = await request(app).get('/api/v1/expenses');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/expenses', () => {
  it('returnerar 400 om carId saknas', async () => {
    const res = await userAgent
      .post('/api/v1/expenses')
      .field('amount', '100')
      .field('description', 'test');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/carId/);
  });

  it('returnerar 400 om amount är 0', async () => {
    const res = await userAgent
      .post('/api/v1/expenses')
      .field('carId', carId)
      .field('amount', '0')
      .field('description', 'test');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/amount/);
  });

  it('returnerar 400 om amount är negativ', async () => {
    const res = await userAgent
      .post('/api/v1/expenses')
      .field('carId', carId)
      .field('amount', '-10')
      .field('description', 'test');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/amount/);
  });

  it('skapar utlägg utan bild och returnerar 201 med hasReceipt: false', async () => {
    const res = await userAgent
      .post('/api/v1/expenses')
      .field('carId', carId)
      .field('amount', '250')
      .field('description', 'Vindrutetvätt');
    expect(res.status).toBe(201);
    expect(res.body.hasReceipt).toBe(false);
    expect(res.body.amount).toBe(250);
  });

  it('skapar utlägg med bild och returnerar 201 med hasReceipt: true', async () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // minimal JPEG header
    const res = await userAgent
      .post('/api/v1/expenses')
      .field('carId', carId)
      .field('amount', '500')
      .field('description', 'Bränsle')
      .attach('receipt', fakeJpeg, { filename: 'kvitto.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(201);
    expect(res.body.hasReceipt).toBe(true);
  });
});

describe('GET /api/v1/expenses/:id/receipt', () => {
  let expenseId: string;

  beforeAll(async () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const res = await userAgent
      .post('/api/v1/expenses')
      .field('carId', carId)
      .field('amount', '100')
      .field('description', 'Kvittotest')
      .attach('receipt', fakeJpeg, { filename: 'k.jpg', contentType: 'image/jpeg' });
    expenseId = res.body.id;
  });

  it('returnerar 200 och rätt Content-Type', async () => {
    const res = await userAgent.get(`/api/v1/expenses/${expenseId}/receipt`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
  });
});

describe('PATCH /api/v1/expenses/:id', () => {
  let expenseId: string;

  beforeAll(async () => {
    const res = await userAgent
      .post('/api/v1/expenses')
      .field('carId', carId)
      .field('amount', '75')
      .field('description', 'Parkeringsavgift');
    expenseId = res.body.id;
  });

  it('ändrar status till PAID och returnerar 200', async () => {
    const res = await userAgent.patch(`/api/v1/expenses/${expenseId}`).send({ status: 'PAID' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PAID');
  });
});

describe('DELETE /api/v1/expenses/:id', () => {
  it('returnerar 403 om annan icke-admin försöker radera', async () => {
    const createRes = await userAgent
      .post('/api/v1/expenses')
      .field('carId', carId)
      .field('amount', '50')
      .field('description', 'Annat utlägg');
    const res = await otherAgent.delete(`/api/v1/expenses/${createRes.body.id}`);
    expect(res.status).toBe(403);
  });

  it('returnerar 200 om ägaren raderar', async () => {
    const createRes = await userAgent
      .post('/api/v1/expenses')
      .field('carId', carId)
      .field('amount', '30')
      .field('description', 'Raderas av ägare');
    const res = await userAgent.delete(`/api/v1/expenses/${createRes.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
