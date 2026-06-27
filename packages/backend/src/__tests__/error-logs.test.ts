/**
 * E2E-tester för error-logs API.
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

beforeAll(async () => {
  const { user, password } = await createTestUser();
  userId = user.id;
  userAgent = await loginAgent(user.email, password);

  const { user: admin, password: adminPw } = await createTestUser({ isAdmin: true });
  adminId = admin.id;
  adminAgent = await loginAgent(admin.email, adminPw);

  const car = await createTestCar();
  carId = car.id;
});

afterAll(async () => {
  await prisma.errorLogComment.deleteMany({ where: { byUserId: { in: [userId, adminId] } } });
  await prisma.errorLog.deleteMany({ where: { carId } });
  await prisma.car.delete({ where: { id: carId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.user.delete({ where: { id: adminId } });
  await prisma.$disconnect();
});

describe('GET /api/v1/error-logs', () => {
  it('returnerar 401 utan session', async () => {
    const res = await request(app).get('/api/v1/error-logs');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/error-logs', () => {
  it('returnerar 400 om carId saknas', async () => {
    const res = await userAgent.post('/api/v1/error-logs').send({ description: 'test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/carId/);
  });

  it('returnerar 400 om description saknas', async () => {
    const res = await userAgent.post('/api/v1/error-logs').send({ carId });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/description/);
  });

  it('skapar fellogg och returnerar 201 med rätt fält', async () => {
    const res = await userAgent.post('/api/v1/error-logs').send({
      carId,
      description: 'Däcket är platt',
    });
    expect(res.status).toBe(201);
    expect(res.body.carId).toBe(carId);
    expect(res.body.description).toBe('Däcket är platt');
    expect(res.body.status).toBe('OPEN');
    expect(Array.isArray(res.body.comments)).toBe(true);
  });
});

describe('PATCH /api/v1/error-logs/:id', () => {
  let logId: string;

  beforeAll(async () => {
    const res = await userAgent.post('/api/v1/error-logs').send({
      carId,
      description: 'Motorljud',
    });
    logId = res.body.id;
  });

  it('ändrar status till IN_PROGRESS och returnerar 200', async () => {
    const res = await userAgent.patch(`/api/v1/error-logs/${logId}`).send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_PROGRESS');
  });
});

describe('POST /api/v1/error-logs/:id/comments', () => {
  let logId: string;

  beforeAll(async () => {
    const res = await userAgent.post('/api/v1/error-logs').send({
      carId,
      description: 'Bromsar gnisslar',
    });
    logId = res.body.id;
  });

  it('lägger till kommentar och returnerar 201', async () => {
    const res = await userAgent.post(`/api/v1/error-logs/${logId}/comments`).send({ text: 'Kontrollerad' });
    expect(res.status).toBe(201);
    expect(res.body.comments.length).toBeGreaterThan(0);
    expect(res.body.comments[0].text).toBe('Kontrollerad');
  });
});

describe('DELETE /api/v1/error-logs/:id', () => {
  it('returnerar 403 om icke-admin försöker radera', async () => {
    const createRes = await userAgent.post('/api/v1/error-logs').send({
      carId,
      description: 'Ska ej raderas av vanlig user',
    });
    const res = await userAgent.delete(`/api/v1/error-logs/${createRes.body.id}`);
    expect(res.status).toBe(403);
  });

  it('returnerar 200 om admin raderar', async () => {
    const createRes = await adminAgent.post('/api/v1/error-logs').send({
      carId,
      description: 'Admin raderar denna',
    });
    const res = await adminAgent.delete(`/api/v1/error-logs/${createRes.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
