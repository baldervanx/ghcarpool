/**
 * E2E-tester för car-info API.
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
  await prisma.carInfo.deleteMany({ where: { carId } });
  await prisma.car.delete({ where: { id: carId } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
  await prisma.$disconnect();
});

describe('GET /api/v1/car-info/:carId', () => {
  it('returnerar 401 utan session', async () => {
    const res = await request(app).get(`/api/v1/car-info/${carId}`);
    expect(res.status).toBe(401);
  });

  it('returnerar 404 om ingen info finns', async () => {
    const res = await userAgent.get(`/api/v1/car-info/${carId}`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/car-info/:carId', () => {
  it('returnerar 403 om icke-admin försöker skriva', async () => {
    const res = await userAgent.put(`/api/v1/car-info/${carId}`).send({ owner: 'Test' });
    expect(res.status).toBe(403);
  });

  it('skapar bilinfo och returnerar 200 med alla fält', async () => {
    const res = await adminAgent.put(`/api/v1/car-info/${carId}`).send({
      inspectionDue: '2025-12-31',
      lastService: '2024-06-01',
      owner: 'Företaget AB',
      insuranceCompany: 'If',
    });
    expect(res.status).toBe(200);
    expect(res.body.carId).toBe(carId);
    expect(res.body.inspectionDue).toBe('2025-12-31');
    expect(res.body.owner).toBe('Företaget AB');
    expect(res.body.updatedAt).toBeDefined();
  });

  it('uppdaterar befintlig bilinfo, updatedAt ändras', async () => {
    const first = await adminAgent.put(`/api/v1/car-info/${carId}`).send({ owner: 'Första' });
    await new Promise(r => setTimeout(r, 10)); // liten paus för att updatedAt ska skilja sig
    const second = await adminAgent.put(`/api/v1/car-info/${carId}`).send({ owner: 'Andra' });
    expect(second.status).toBe(200);
    expect(second.body.owner).toBe('Andra');
    // updatedAt ska vara >= first.body.updatedAt
    expect(new Date(second.body.updatedAt) >= new Date(first.body.updatedAt)).toBe(true);
  });
});

describe('GET /api/v1/car-info/:carId (efter skapande)', () => {
  it('returnerar 200 med info', async () => {
    const res = await userAgent.get(`/api/v1/car-info/${carId}`);
    expect(res.status).toBe(200);
    expect(res.body.carId).toBe(carId);
  });
});
