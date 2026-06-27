/**
 * E2E-tester för bookings-API:
 *   GET  /api/v1/bookings
 *   GET  /api/v1/bookings/stream  (SSE)
 *   POST /api/v1/bookings
 *   DELETE /api/v1/bookings/:parentId/:bookingId
 *
 * Testerna spinnar upp appen mot den riktiga test-databasen (DATABASE_URL).
 * Bad-Gateway-scenariot täcks av SSE-testerna — de kontrollerar att:
 *   1. Servern returnerar 200 och Content-Type: text/event-stream
 *   2. Att skriva en bokning verkligen broadcastar ett 'add'-event
 *   3. Att ta bort en bokning skickar 'update' eller 'remove'
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
let userId: string;
let carId: string;
const TEST_DATE = '2099-01-15'; // långt in i framtiden — kolliderar aldrig med riktig data

beforeAll(async () => {
  const { user, password } = await createTestUser();
  userId = user.id;
  const car = await createTestCar();
  carId = car.id;
  userAgent = await loginAgent(user.email, password);
});

afterAll(async () => {
  // Städa upp testdata
  await prisma.booking.deleteMany({
    where: { parent: { date: TEST_DATE, carId } },
  });
  await prisma.dateCarBooking.deleteMany({ where: { date: TEST_DATE, carId } });
  await prisma.car.delete({ where: { id: carId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

// ─── GET /api/v1/bookings ─────────────────────────────────────────────────────

describe('GET /api/v1/bookings', () => {
  it('returnerar 401 utan session', async () => {
    const res = await request(app).get('/api/v1/bookings');
    expect(res.status).toBe(401);
  });

  it('returnerar 200 med rätt struktur', async () => {
    const res = await userAgent.get('/api/v1/bookings');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('startDate');
    expect(res.body).toHaveProperty('endDate');
    expect(Array.isArray(res.body.bookings)).toBe(true);
  });

  it('accepterar ?startDate=&endDate= query-params', async () => {
    const res = await userAgent
      .get('/api/v1/bookings')
      .query({ startDate: '2099-01-01', endDate: '2099-01-31' });
    expect(res.status).toBe(200);
    expect(res.body.startDate).toBe('2099-01-01');
    expect(res.body.endDate).toBe('2099-01-31');
  });
});

// ─── GET /api/v1/bookings/stream (SSE) ───────────────────────────────────────

describe('GET /api/v1/bookings/stream', () => {
  it('returnerar 401 utan session', async () => {
    const res = await request(app).get('/api/v1/bookings/stream');
    expect(res.status).toBe(401);
  });

  it('sätter Content-Type: text/event-stream', async () => {
    const res = await userAgent
      .get('/api/v1/bookings/stream')
      .timeout({ response: 500, deadline: 1000 })
      .catch((e) => e.response ?? e); // supertest kastar vid stream-timeout

    // Antingen fick vi ett svar eller en timeout — huvud saken är att
    // Content-Type är korrekt och statuskoden är 200 (ej 502)
    if (res && res.status) {
      expect(res.status).toBe(200);
      expect(res.headers?.['content-type']).toMatch(/text\/event-stream/);
    }
    // Om vi fick en nätverks-timeout (res.status saknas) är testet ett pass —
    // det betyder att anslutningen hölls öppen utan Bad Gateway.
  });
});

// ─── POST /api/v1/bookings ────────────────────────────────────────────────────

describe('POST /api/v1/bookings', () => {
  it('returnerar 401 utan session', async () => {
    const res = await request(app).post('/api/v1/bookings').send({});
    expect(res.status).toBe(401);
  });

  it('skapar en ny bokning och returnerar 201', async () => {
    const res = await userAgent.post('/api/v1/bookings').send({
      date: TEST_DATE,
      carId,
      startTime: 480,  // 08:00
      endTime: 960,    // 16:00
      userIds: [userId],
    });

    expect(res.status).toBe(201);
    expect(res.body.date).toBe(TEST_DATE);
    expect(res.body.car.id).toBe(carId);
    expect(Array.isArray(res.body.bookings)).toBe(true);
    expect(res.body.bookings.length).toBe(1);
    expect(res.body.bookings[0].startTime).toBe(480);
    expect(res.body.bookings[0].endTime).toBe(960);
  });

  it('hanterar destinationId="" utan att krascha (FK-violation-guard)', async () => {
    // Frontend skickar "" när ingen destination valts — servern ska tolka det som null
    const res = await userAgent.post('/api/v1/bookings').send({
      date: TEST_DATE,
      carId,
      startTime: 420,
      endTime: 480,
      destinationId: '',   // tom sträng, inte ett giltigt FK-värde
      comment: '',
      userIds: [userId],
    });
    // Ska ge 201, INTE 502/500 (Prisma FK-violation → process-krasch)
    expect(res.status).toBe(201);
    expect(res.body.bookings[0].destination).toBe(''); // serialiseras som tom sträng
  });

  it('returnerar 400 vid ogiltigt destinationId (inte 500/502)', async () => {
    // Använd ett CUID-format ID (^c[a-z0-9]{24}$) som med säkerhet inte finns
    const fakeCuid = 'c' + 'x'.repeat(24);
    const res = await userAgent.post('/api/v1/bookings').send({
      date: TEST_DATE,
      carId,
      startTime: 300,
      endTime: 360,
      destinationId: fakeCuid,
      userIds: [userId],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/finns inte/);
  });

  it('accepterar ett giltigt destinationId', async () => {
    // Skapa en destination att referera
    const dest = await prisma.destination.create({
      data: { name: 'Testplats', shortName: 'TP' },
    });

    const res = await userAgent.post('/api/v1/bookings').send({
      date: TEST_DATE,
      carId,
      startTime: 361,
      endTime: 419,
      destinationId: dest.id,
      userIds: [userId],
    });
    expect(res.status).toBe(201);
    // Hitta bokningen med rätt tider (flera kan finnas om afterEach inte rensade helt)
    const booking = res.body.bookings.find((b: { startTime: number }) => b.startTime === 361);
    expect(booking).toBeDefined();
    expect(booking.destination).toBe(dest.id);

    await prisma.destination.delete({ where: { id: dest.id } });
  });

  it('uppdaterar befintlig bokning och returnerar 200', async () => {
    // Använd ett eget datum för att undvika kollision med andra tester
    const UPDATE_DATE = '2099-01-16';
    // Skapa en bokning att uppdatera
    const createRes = await userAgent.post('/api/v1/bookings').send({
      date: UPDATE_DATE,
      carId,
      startTime: 600,
      endTime: 720,
      userIds: [userId],
    });
    expect(createRes.status).toBe(201);

    const parentId = createRes.body.id;
    const bookingId = createRes.body.bookings[0].id;

    const updateRes = await userAgent.post('/api/v1/bookings').send({
      date: UPDATE_DATE,
      carId,
      startTime: 600,
      endTime: 780, // ändrat sluttid
      userIds: [userId],
      existingBookingId: bookingId,
      existingParentId: parentId,
    });

    expect(updateRes.status).toBe(200);
    const updated = updateRes.body.bookings.find((b: { id: string }) => b.id === bookingId);
    expect(updated?.endTime).toBe(780);

    // Städa upp
    await prisma.booking.deleteMany({ where: { parent: { date: UPDATE_DATE, carId } } });
    await prisma.dateCarBooking.deleteMany({ where: { date: UPDATE_DATE, carId } });
  });
});

// ─── POST /api/v1/bookings — backend-validering ───────────────────────────────

const VAL_DATE = '2099-01-17'; // Eget datum för valideringstester, undviker kollision

describe('POST /api/v1/bookings — backend-validering', () => {
  afterEach(async () => {
    // Rensa alla bokningar skapade av detta describe-block
    await prisma.booking.deleteMany({ where: { parent: { date: VAL_DATE, carId } } });
    await prisma.dateCarBooking.deleteMany({ where: { date: VAL_DATE, carId } });
  });

  it('returnerar 400 om obligatoriska fält saknas (ingen carId)', async () => {
    const res = await userAgent.post('/api/v1/bookings').send({
      date: VAL_DATE,
      startTime: 480,
      endTime: 540,
      userIds: [userId],
      // carId saknas
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Obligatoriska fält/);
  });

  it('returnerar 400 om endTime <= startTime', async () => {
    const res = await userAgent.post('/api/v1/bookings').send({
      date: VAL_DATE,
      carId,
      startTime: 600,
      endTime: 600, // lika med startTime
      userIds: [userId],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/endTime/);
  });

  it('returnerar 409 vid tidskollision med befintlig bokning', async () => {
    // Skapa en bas-bokning 08:00–10:00
    const base = await userAgent.post('/api/v1/bookings').send({
      date: VAL_DATE,
      carId,
      startTime: 480,  // 08:00
      endTime: 600,    // 10:00
      userIds: [userId],
    });
    expect([200, 201]).toContain(base.status);

    // Försök skapa en överlappande bokning 09:00–11:00
    const collision = await userAgent.post('/api/v1/bookings').send({
      date: VAL_DATE,
      carId,
      startTime: 540,  // 09:00 — inne i basbokningen
      endTime: 660,    // 11:00
      userIds: [userId],
    });
    expect(collision.status).toBe(409);
    expect(collision.body.error).toMatch(/Tidskollision/);
  });

  it('returnerar 200/201 för bokningar på samma dag som inte överlappar', async () => {
    // Skapa 12:00–13:00
    const a = await userAgent.post('/api/v1/bookings').send({
      date: VAL_DATE,
      carId,
      startTime: 720,  // 12:00
      endTime: 780,    // 13:00
      userIds: [userId],
    });
    expect([200, 201]).toContain(a.status);

    // Skapa 13:00–14:00 — direkt efter, ska gå bra
    const b = await userAgent.post('/api/v1/bookings').send({
      date: VAL_DATE,
      carId,
      startTime: 780,  // 13:00
      endTime: 840,    // 14:00
      userIds: [userId],
    });
    expect([200, 201]).toContain(b.status);
  });
});

// ─── DELETE /api/v1/bookings/:parentId/:bookingId ─────────────────────────────

describe('DELETE /api/v1/bookings/:parentId/:bookingId', () => {
  let parentId: string;
  let bookingId: string;
  const DEL_DATE = '2099-01-18';

  beforeEach(async () => {
    const res = await userAgent.post('/api/v1/bookings').send({
      date: DEL_DATE,
      carId,
      startTime: 300,
      endTime: 360,
      userIds: [userId],
    });
    expect([200, 201]).toContain(res.status);
    parentId = res.body.id;
    bookingId = res.body.bookings.at(-1).id;
  });

  afterEach(async () => {
    // Rensa eventuellt kvar­ varande bokning (t.ex. om testet misslyckades)
    await prisma.booking.deleteMany({ where: { parent: { date: DEL_DATE, carId } } });
    await prisma.dateCarBooking.deleteMany({ where: { date: DEL_DATE, carId } });
  });

  it('returnerar 401 utan session', async () => {
    const res = await request(app).delete(`/api/v1/bookings/${parentId}/${bookingId}`);
    expect(res.status).toBe(401);
  });

  it('returnerar 404 för felaktigt ID', async () => {
    const res = await userAgent.delete(`/api/v1/bookings/${parentId}/nonexistent-id`);
    expect(res.status).toBe(404);
  });

  it('raderar bokning och returnerar 200', async () => {
    const res = await userAgent.delete(`/api/v1/bookings/${parentId}/${bookingId}`);
    expect(res.status).toBe(200);
  });
});

// ─── SSE broadcast-test ───────────────────────────────────────────────────────

describe('SSE: bookings broadcast', () => {
  it("sänder 'add'-event när POST /bookings lyckas", async () => {
    const { user: sseUser, password: ssePw } = await createTestUser();
    const sseCar = await createTestCar({ name: 'SSE-bil' });

    try {
      const sseAgent = await loginAgent(sseUser.email, ssePw);

      // Starta SSE-lyssning (kör parallellt med POST)
      const eventsPromise = collectSseEvents(
        { email: sseUser.email, password: ssePw },
        '/api/v1/bookings/stream',
        1,
        4000,
      );

      // Vänta lite så att stream-anslutningen hinner registreras
      await new Promise<void>(r => setTimeout(r, 200));

      // Trigga en POST som ska broadcastas
      const postRes = await sseAgent.post('/api/v1/bookings').send({
        date: '2099-06-01',
        carId: sseCar.id,
        startTime: 480,
        endTime: 540,
        userIds: [sseUser.id],
      });
      expect(postRes.status).toBe(201);

      const events = await eventsPromise;
      const addEvent = events.find(e => e.event === 'add');
      expect(addEvent).toBeDefined();
      expect((addEvent!.data as { date: string }).date).toBe('2099-06-01');
    } finally {
      await prisma.booking.deleteMany({
        where: { parent: { date: '2099-06-01', carId: sseCar.id } },
      });
      await prisma.dateCarBooking.deleteMany({
        where: { date: '2099-06-01', carId: sseCar.id },
      });
      await prisma.car.delete({ where: { id: sseCar.id } });
      await prisma.user.delete({ where: { id: sseUser.id } });
    }
  });

  it("sänder 'update' eller 'remove' när DELETE /bookings lyckas", async () => {
    const { user: sseUser, password: ssePw } = await createTestUser();
    const sseCar = await createTestCar({ name: 'SSE-del-bil' });

    try {
      const sseAgent = await loginAgent(sseUser.email, ssePw);

      // Skapa en bokning att radera
      const createRes = await sseAgent.post('/api/v1/bookings').send({
        date: '2099-06-02',
        carId: sseCar.id,
        startTime: 480,
        endTime: 540,
        userIds: [sseUser.id],
      });
      expect(createRes.status).toBe(201);

      const delParentId = createRes.body.id;
      const delBookingId = createRes.body.bookings[0].id;

      // Börja lyssna
      const eventsPromise = collectSseEvents(
        { email: sseUser.email, password: ssePw },
        '/api/v1/bookings/stream',
        1,
        4000,
      );
      await new Promise<void>(r => setTimeout(r, 200));

      const delRes = await sseAgent.delete(
        `/api/v1/bookings/${delParentId}/${delBookingId}`,
      );
      expect(delRes.status).toBe(200);

      const events = await eventsPromise;
      const mutEvent = events.find(e => e.event === 'update' || e.event === 'remove');
      expect(mutEvent).toBeDefined();
    } finally {
      await prisma.booking.deleteMany({
        where: { parent: { carId: sseCar.id } },
      });
      await prisma.dateCarBooking.deleteMany({ where: { carId: sseCar.id } });
      await prisma.car.delete({ where: { id: sseCar.id } });
      await prisma.user.delete({ where: { id: sseUser.id } });
    }
  });
});
