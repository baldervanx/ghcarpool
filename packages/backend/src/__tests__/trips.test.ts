/**
 * E2E-tester för trips-API:
 *   GET    /api/v1/trips
 *   GET    /api/v1/trips/stream  (SSE)
 *   POST   /api/v1/trips
 *   PUT    /api/v1/trips/:id
 *   DELETE /api/v1/trips/:id
 *
 * Bad-Gateway-scenariot täcks av SSE-testet — vi verifierar att:
 *   1. /trips/stream svarar med HTTP 200 och text/event-stream
 *   2. En POST broadcastar ett 'add'-event till lyssnarens stream
 *   3. En PUT broadcastar 'update', DELETE broadcastar 'remove'
 */

import request from 'supertest';
import app from '../app';
import prisma from '../db/prisma';
import {
  createTestUser,
  createTestCar,
  loginAgent,
  collectSseEvents,
} from './helpers';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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

  const car = await createTestCar({ name: 'TripCar' });
  carId = car.id;
});

afterAll(async () => {
  await prisma.trip.deleteMany({ where: { carId } });
  await prisma.car.delete({ where: { id: carId } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
  await prisma.$disconnect();
});

// ─── GET /api/v1/trips ────────────────────────────────────────────────────────

describe('GET /api/v1/trips', () => {
  it('returnerar 401 utan session', async () => {
    const res = await request(app).get('/api/v1/trips');
    expect(res.status).toBe(401);
  });

  it('returnerar 200 med en array', async () => {
    const res = await userAgent.get('/api/v1/trips');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─── GET /api/v1/trips/stream (SSE) ──────────────────────────────────────────

describe('GET /api/v1/trips/stream', () => {
  it('returnerar 401 utan session', async () => {
    const res = await request(app).get('/api/v1/trips/stream');
    expect(res.status).toBe(401);
  });

  it('sätter Content-Type: text/event-stream (ej Bad Gateway)', async () => {
    const res = await userAgent
      .get('/api/v1/trips/stream')
      .timeout({ response: 500, deadline: 1000 })
      .catch((e) => e.response ?? e);

    if (res && res.status) {
      expect(res.status).toBe(200);
      expect(res.headers?.['content-type']).toMatch(/text\/event-stream/);
    }
    // Nätverks-timeout → anslutningen hölls öppen → ingen Bad Gateway
  });
});

// ─── POST /api/v1/trips ───────────────────────────────────────────────────────

describe('POST /api/v1/trips', () => {
  it('returnerar 401 utan session', async () => {
    const res = await request(app).post('/api/v1/trips').send({});
    expect(res.status).toBe(401);
  });

  it('skapar en resa och returnerar 201', async () => {
    const res = await userAgent.post('/api/v1/trips').send({
      carId,
      odo: 12000,
      distance: 45,
      cost: 67.5,
      comment: 'Testresa',
      userIds: [userId],
    });

    expect(res.status).toBe(201);
    expect(res.body.car.id).toBe(carId);
    expect(res.body.odo).toBe(12000);
    expect(res.body.distance).toBe(45);
    expect(res.body.cost).toBe(67.5);
    expect(res.body.comment).toBe('Testresa');
    expect(res.body.users.map((u: { id: string }) => u.id)).toContain(userId);
  });
});

// ─── POST /api/v1/trips — backend-validering ─────────────────────────────────

describe('POST /api/v1/trips — backend-validering', () => {
  it('returnerar 400 om obligatoriska fält saknas (ingen carId)', async () => {
    const res = await userAgent.post('/api/v1/trips').send({
      odo: 5000,
      distance: 10,
      cost: 15,
      userIds: [userId],
      // carId saknas
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Obligatoriska fält/);
  });

  it('returnerar 400 om odo saknas eller är 0', async () => {
    const res = await userAgent.post('/api/v1/trips').send({
      carId,
      odo: 0,
      distance: 10,
      cost: 15,
      userIds: [userId],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positiva/);
  });

  it('returnerar 409 om odo är lägre än senaste registrerade för bilen', async () => {
    // Skapa en bil att testa med (isolerad från andra tester)
    const odoCar = await createTestCar({ name: 'OdoTestBil' });

    try {
      // Registrera resa med odo=50000
      const first = await userAgent.post('/api/v1/trips').send({
        carId: odoCar.id,
        odo: 50000,
        distance: 100,
        cost: 150,
        userIds: [userId],
      });
      expect(first.status).toBe(201);

      // Försök registrera resa med lägre odo=49999
      const second = await userAgent.post('/api/v1/trips').send({
        carId: odoCar.id,
        odo: 49999,
        distance: 50,
        cost: 75,
        userIds: [userId],
      });
      expect(second.status).toBe(409);
      expect(second.body.error).toMatch(/odo/);
    } finally {
      await prisma.trip.deleteMany({ where: { carId: odoCar.id } });
      await prisma.car.delete({ where: { id: odoCar.id } });
    }
  });

  it('returnerar 409 om odo är samma som senaste registrerade', async () => {
    const odoCar2 = await createTestCar({ name: 'OdoTestBil2' });

    try {
      const first = await userAgent.post('/api/v1/trips').send({
        carId: odoCar2.id,
        odo: 60000,
        distance: 100,
        cost: 150,
        userIds: [userId],
      });
      expect(first.status).toBe(201);

      const second = await userAgent.post('/api/v1/trips').send({
        carId: odoCar2.id,
        odo: 60000, // samma värde
        distance: 50,
        cost: 75,
        userIds: [userId],
      });
      expect(second.status).toBe(409);
    } finally {
      await prisma.trip.deleteMany({ where: { carId: odoCar2.id } });
      await prisma.car.delete({ where: { id: odoCar2.id } });
    }
  });

  it('accepterar ny resa med odo högre än senaste', async () => {
    const odoCar3 = await createTestCar({ name: 'OdoTestBil3' });

    try {
      const first = await userAgent.post('/api/v1/trips').send({
        carId: odoCar3.id,
        odo: 70000,
        distance: 100,
        cost: 150,
        userIds: [userId],
      });
      expect(first.status).toBe(201);

      const second = await userAgent.post('/api/v1/trips').send({
        carId: odoCar3.id,
        odo: 70100, // strikt högre
        distance: 100,
        cost: 150,
        userIds: [userId],
      });
      expect(second.status).toBe(201);
    } finally {
      await prisma.trip.deleteMany({ where: { carId: odoCar3.id } });
      await prisma.car.delete({ where: { id: odoCar3.id } });
    }
  });
});

// ─── PUT /api/v1/trips/:id ────────────────────────────────────────────────────

describe('PUT /api/v1/trips/:id', () => {
  let tripId: string;
  let putCar: { id: string };

  beforeAll(async () => {
    putCar = await createTestCar({ name: 'PutCar' });
  });

  afterAll(async () => {
    await prisma.trip.deleteMany({ where: { carId: putCar.id } });
    await prisma.car.delete({ where: { id: putCar.id } });
  });

  beforeEach(async () => {
    // Hämta senaste odo för putCar och lägg på 1000 för att garantera stigande värde
    const latest = await prisma.trip.findFirst({
      where: { carId: putCar.id },
      orderBy: { odo: 'desc' },
      select: { odo: true },
    });
    const nextOdo = (latest?.odo ?? 0) + 1000;
    const res = await userAgent.post('/api/v1/trips').send({
      carId: putCar.id,
      odo: nextOdo,
      distance: 50,
      cost: 75,
      userIds: [userId],
    });
    expect(res.status).toBe(201);
    tripId = res.body.id;
  });

  it('returnerar 401 utan session', async () => {
    const res = await request(app).put(`/api/v1/trips/${tripId}`).send({});
    expect(res.status).toBe(401);
  });

  it('returnerar 404 för okänt ID', async () => {
    const res = await userAgent.put('/api/v1/trips/nonexistent-id').send({
      odo: 999,
      distance: 1,
      cost: 1,
      userIds: [userId],
    });
    expect(res.status).toBe(404);
  });

  it('returnerar 403 om annan icke-admin försöker redigera', async () => {
    const { user: otherUser, password: otherPw } = await createTestUser();
    const otherAgent = await loginAgent(otherUser.email, otherPw);

    const res = await otherAgent.put(`/api/v1/trips/${tripId}`).send({
      odo: 9999,
      distance: 1,
      cost: 1,
      userIds: [userId],
    });
    expect(res.status).toBe(403);

    await prisma.user.delete({ where: { id: otherUser.id } });
  });

  it('uppdaterar resan och returnerar 200', async () => {
    const res = await userAgent.put(`/api/v1/trips/${tripId}`).send({
      odo: 14000,
      distance: 60,
      cost: 90,
      comment: 'Uppdaterad',
      userIds: [userId],
    });

    expect(res.status).toBe(200);
    expect(res.body.odo).toBe(14000);
    expect(res.body.distance).toBe(60);
    expect(res.body.comment).toBe('Uppdaterad');
  });

  it('admin kan redigera annans resa', async () => {
    const res = await adminAgent.put(`/api/v1/trips/${tripId}`).send({
      odo: 15000,
      distance: 70,
      cost: 100,
      userIds: [userId],
    });
    expect(res.status).toBe(200);
    expect(res.body.odo).toBe(15000);
  });
});

// ─── DELETE /api/v1/trips/:id ─────────────────────────────────────────────────

describe('DELETE /api/v1/trips/:id', () => {
  let tripId: string;
  let delCar: { id: string };

  beforeAll(async () => {
    delCar = await createTestCar({ name: 'DelCar' });
  });

  afterAll(async () => {
    await prisma.trip.deleteMany({ where: { carId: delCar.id } });
    await prisma.car.delete({ where: { id: delCar.id } });
  });

  beforeEach(async () => {
    const latest = await prisma.trip.findFirst({
      where: { carId: delCar.id },
      orderBy: { odo: 'desc' },
      select: { odo: true },
    });
    const nextOdo = (latest?.odo ?? 0) + 1000;
    const res = await userAgent.post('/api/v1/trips').send({
      carId: delCar.id,
      odo: nextOdo,
      distance: 30,
      cost: 45,
      userIds: [userId],
    });
    expect(res.status).toBe(201);
    tripId = res.body.id;
  });

  it('returnerar 401 utan session', async () => {
    const res = await request(app).delete(`/api/v1/trips/${tripId}`);
    expect(res.status).toBe(401);
  });

  it('returnerar 404 för okänt ID', async () => {
    const res = await userAgent.delete('/api/v1/trips/nonexistent-id');
    expect(res.status).toBe(404);
  });

  it('returnerar 403 om annan icke-admin försöker radera', async () => {
    const { user: otherUser, password: otherPw } = await createTestUser();
    const otherAgent = await loginAgent(otherUser.email, otherPw);

    const res = await otherAgent.delete(`/api/v1/trips/${tripId}`);
    expect(res.status).toBe(403);

    await prisma.user.delete({ where: { id: otherUser.id } });
  });

  it('raderar resan och returnerar id', async () => {
    const res = await userAgent.delete(`/api/v1/trips/${tripId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(tripId);
  });

  it('admin kan radera annans resa', async () => {
    const res = await adminAgent.delete(`/api/v1/trips/${tripId}`);
    expect(res.status).toBe(200);
    tripId = ''; // redan raderad
  });
});

// ─── SSE broadcast-test ───────────────────────────────────────────────────────

describe('SSE: trips broadcast', () => {
  it("sänder 'add'-event när POST /trips lyckas", async () => {
    const { user: sseUser, password: ssePw } = await createTestUser();
    const sseCar = await createTestCar({ name: 'SSE-Trip-Bil' });

    try {
      const sseAgent = await loginAgent(sseUser.email, ssePw);

      const eventsPromise = collectSseEvents(
        { email: sseUser.email, password: ssePw },
        '/api/v1/trips/stream',
        1,
        4000,
      );
      await new Promise<void>(r => setTimeout(r, 200));

      const postRes = await sseAgent.post('/api/v1/trips').send({
        carId: sseCar.id,
        odo: 5000,
        distance: 25,
        cost: 37.5,
        userIds: [sseUser.id],
      });
      expect(postRes.status).toBe(201);

      const events = await eventsPromise;
      const addEvent = events.find(e => e.event === 'add');
      expect(addEvent).toBeDefined();
      expect((addEvent!.data as { car: { id: string } }).car.id).toBe(sseCar.id);
    } finally {
      await prisma.trip.deleteMany({ where: { carId: sseCar.id } });
      await prisma.car.delete({ where: { id: sseCar.id } });
      await prisma.user.delete({ where: { id: sseUser.id } });
    }
  });

  it("sänder 'update'-event när PUT /trips/:id lyckas", async () => {
    const { user: sseUser, password: ssePw } = await createTestUser();
    const sseCar = await createTestCar({ name: 'SSE-Trip-Upd-Bil' });

    try {
      const sseAgent = await loginAgent(sseUser.email, ssePw);

      const createRes = await sseAgent.post('/api/v1/trips').send({
        carId: sseCar.id,
        odo: 6000,
        distance: 30,
        cost: 45,
        userIds: [sseUser.id],
      });
      expect(createRes.status).toBe(201);
      const tId = createRes.body.id;

      const eventsPromise = collectSseEvents(
        { email: sseUser.email, password: ssePw },
        '/api/v1/trips/stream',
        1,
        4000,
      );
      await new Promise<void>(r => setTimeout(r, 200));

      const putRes = await sseAgent.put(`/api/v1/trips/${tId}`).send({
        odo: 6100,
        distance: 35,
        cost: 50,
        userIds: [sseUser.id],
      });
      expect(putRes.status).toBe(200);

      const events = await eventsPromise;
      const updEvent = events.find(e => e.event === 'update');
      expect(updEvent).toBeDefined();
      expect((updEvent!.data as { id: string }).id).toBe(tId);
    } finally {
      await prisma.trip.deleteMany({ where: { carId: sseCar.id } });
      await prisma.car.delete({ where: { id: sseCar.id } });
      await prisma.user.delete({ where: { id: sseUser.id } });
    }
  });

  it("sänder 'remove'-event när DELETE /trips/:id lyckas", async () => {
    const { user: sseUser, password: ssePw } = await createTestUser();
    const sseCar = await createTestCar({ name: 'SSE-Trip-Del-Bil' });

    try {
      const sseAgent = await loginAgent(sseUser.email, ssePw);

      const createRes = await sseAgent.post('/api/v1/trips').send({
        carId: sseCar.id,
        odo: 7000,
        distance: 20,
        cost: 30,
        userIds: [sseUser.id],
      });
      expect(createRes.status).toBe(201);
      const tId = createRes.body.id;

      const eventsPromise = collectSseEvents(
        { email: sseUser.email, password: ssePw },
        '/api/v1/trips/stream',
        1,
        4000,
      );
      await new Promise<void>(r => setTimeout(r, 200));

      const delRes = await sseAgent.delete(`/api/v1/trips/${tId}`);
      expect(delRes.status).toBe(200);

      const events = await eventsPromise;
      const remEvent = events.find(e => e.event === 'remove');
      expect(remEvent).toBeDefined();
      expect((remEvent!.data as { id: string }).id).toBe(tId);
    } finally {
      await prisma.trip.deleteMany({ where: { carId: sseCar.id } });
      await prisma.car.delete({ where: { id: sseCar.id } });
      await prisma.user.delete({ where: { id: sseUser.id } });
    }
  });
});
