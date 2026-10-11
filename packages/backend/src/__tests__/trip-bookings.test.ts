import { randomUUID } from 'crypto';
import type { Response } from 'express';
import bcrypt from 'bcrypt';
import request from 'supertest';
import prisma from '../db/prisma';
import { subscribe, unsubscribe } from '../lib/sse';
import { loginAgent } from './helpers';
import { assertBookingTestDatabase } from './booking-test-database';

const prefix = `trip-bookings-${randomUUID()}`;
const ids = {
  actor: `${prefix}-actor`, creator: `${prefix}-creator`, rider: `${prefix}-rider`,
  other: `${prefix}-other`, outsider: `${prefix}-outsider`,
};
const carIds = [`${prefix}-car`, `${prefix}-other-car`, `${prefix}-trailer`];
let agent: request.Agent;
const subscriptions: ReturnType<typeof subscribe>[] = [];

beforeAll(async () => {
  await assertBookingTestDatabase();
  const passwordHash = await bcrypt.hash('trip-test-password', 4);
  await prisma.user.createMany({
    data: Object.values(ids).map(id => ({ id, email: `${id}@test.com`, passwordHash })),
  });
  await prisma.car.createMany({
    data: carIds.map((id, index) => ({ id, name: id, hasLog: index !== 2 })),
  });
  agent = await loginAgent(`${ids.actor}@test.com`, 'trip-test-password');
});

afterEach(async () => {
  subscriptions.splice(0).forEach(unsubscribe);
  await prisma.dateCarBooking.deleteMany({ where: { carId: { in: carIds } } });
  await prisma.trip.deleteMany({ where: { carId: { in: carIds } } });
  await prisma.recurrence.deleteMany({ where: { id: { startsWith: prefix } } });
});

afterAll(async () => {
  await prisma.car.deleteMany({ where: { id: { in: carIds } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await prisma.$disconnect();
});

async function seedBooking(date = '2001-01-15', extra: {
  carId?: string; startTime?: number; endTime?: number; recurrenceId?: string; logged?: string;
  byUserId?: string; userIds?: string[];
  isMultiDay?: boolean | null;
} = {}) {
  if (extra.recurrenceId) {
    await prisma.recurrence.upsert({
      where: { id: extra.recurrenceId },
      create: {
        id: extra.recurrenceId, isMultiDay: extra.isMultiDay === undefined ? false : extra.isMultiDay,
        recurringStartDate: '2001-01-01', recurringEndDate: '2001-12-31', recurringDays: [0, 1, 2, 3, 4, 5, 6],
      },
      update: {},
    });
  }
  const parent = await prisma.dateCarBooking.upsert({
    where: { date_carId: { date, carId: extra.carId ?? carIds[0] } },
    create: { date, carId: extra.carId ?? carIds[0] }, update: {},
  });
  return prisma.booking.create({
    data: {
      parentId: parent.id, startTime: extra.startTime ?? 480, endTime: extra.endTime ?? 600,
      recurrenceId: extra.recurrenceId, logged: extra.logged, byUserId: extra.byUserId ?? ids.creator,
      users: { create: (extra.userIds ?? [ids.rider]).map(userId => ({ userId })) },
    },
  });
}

function payload(extra: object = {}) {
  return { carId: carIds[0], odo: 10000, distance: 50, cost: 75, userIds: [ids.actor], ...extra };
}

function listen(channel: string) {
  const write = jest.fn();
  const response = { setHeader: jest.fn(), flushHeaders: jest.fn(), write } as unknown as Response;
  subscriptions.push(subscribe(channel, response));
  return () => write.mock.calls.map(([data]) => String(data))
    .filter(data => !data.startsWith('event: heartbeat'))
    .map(data => ({
      event: data.match(/^event: (.+)$/m)![1],
      data: JSON.parse(data.match(/^data: (.+)$/m)![1]),
    }));
}

describe('authoritative atomic trip booking linkage', () => {
  it('rejects a vehicle without a log and leaves its bookable trailer unchanged', async () => {
    const booking = await seedBooking(undefined, { carId: carIds[2] });
    const response = await agent.post('/api/v1/trips').send(payload({
      carId: carIds[2], bookingId: booking.id, parentId: booking.parentId,
    }));
    expect(response.status).toBe(400);
    expect(await prisma.trip.count({ where: { carId: { in: carIds } } })).toBe(0);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).logged).toBeNull();
  });

  it.each(['unknown-booking', 'wrong-car', 'wrong-parent', 'parent-only', 'empty-booking'] as const)(
    'rejects %s without creating a trip, changing parents or publishing events', async kind => {
      const booking = await seedBooking();
      const parent = await prisma.dateCarBooking.findUniqueOrThrow({ where: { id: booking.parentId } });
      const trips = listen('trips');
      const bookings = listen(`bookings:${ids.actor}`);
      const extra = {
        bookingId: kind === 'unknown-booking' ? `${prefix}-missing` : booking.id,
        parentId: booking.parentId,
        ...(kind === 'wrong-car' ? { carId: carIds[1] } : {}),
        ...(kind === 'wrong-parent' ? { parentId: `${prefix}-wrong` } : {}),
        ...(kind === 'parent-only' ? { bookingId: undefined } : {}),
        ...(kind === 'empty-booking' ? { bookingId: '' } : {}),
      };
      const response = await agent.post('/api/v1/trips').send(payload(extra));
      expect(response.status).toBe(400);
      expect(await prisma.trip.count({ where: { carId: { in: carIds } } })).toBe(0);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).logged).toBeNull();
      expect(await prisma.dateCarBooking.findUniqueOrThrow({ where: { id: booking.parentId } })).toEqual(parent);
      expect(trips()).toEqual([]);
      expect(bookings()).toEqual([]);
    },
  );

  it('logs someone else’s single booking using its authoritative parent when parentId is omitted', async () => {
    const booking = await seedBooking();
    const other = await seedBooking(undefined, { startTime: 720, endTime: 780, byUserId: ids.other, userIds: [ids.other] });
    const response = await agent.post('/api/v1/trips').send(payload({ bookingId: booking.id, userIds: [ids.rider] }));
    expect(response.status).toBe(201);
    expect(response.body.byUser.id).toBe(ids.actor);
    expect(response.body.users).toEqual([{ id: ids.rider }]);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).logged).toBe(response.body.id);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: other.id } })).logged).toBeNull();
  });

  it('only logs the chosen instance of a normal daily recurrence', async () => {
    const series = await Promise.all(['2001-01-15', '2001-01-16', '2001-01-17'].map(
      date => seedBooking(date, { recurrenceId: prefix }),
    ));
    const response = await agent.post('/api/v1/trips').send(payload({ bookingId: series[1].id }));
    expect(response.status).toBe(201);
    for (const [index, booking] of series.entries()) {
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).logged)
        .toBe(index === 1 ? response.body.id : null);
    }
  });

  it.each([false, true])('uses explicit isMultiDay=%s for consecutive full-day entries', async isMultiDay => {
    const first = await seedBooking('2001-01-15', { recurrenceId: prefix, isMultiDay, startTime: 0, endTime: 1440 });
    const last = await seedBooking('2001-01-16', { recurrenceId: prefix, isMultiDay, startTime: 0, endTime: 1440 });
    const events = listen(`bookings:${ids.actor}`);
    const response = await agent.post('/api/v1/trips').send(payload({ bookingId: first.id }));
    expect(response.status).toBe(201);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: first.id } })).logged).toBe(response.body.id);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: last.id } })).logged)
      .toBe(isMultiDay ? response.body.id : null);
    expect(events()).toHaveLength(isMultiDay ? 2 : 1);
    for (const event of events()) {
      expect(event.data.bookings).toEqual([expect.objectContaining({
        recurrenceId: prefix, isMultiDay, logged: response.body.id,
        recurrence: {
          id: prefix, isMultiDay, recurringStartDate: '2001-01-01',
          recurringEndDate: '2001-12-31', recurringDays: [0, 1, 2, 3, 4, 5, 6],
        },
      })]);
    }
  });

  it.each([false, true])('logs the correct full-day instances after explicit legacy resolution to %s', async isMultiDay => {
    const first = await seedBooking('2001-01-15', {
      recurrenceId: prefix, isMultiDay: null, startTime: 0, endTime: 1440,
    });
    const last = await seedBooking('2001-01-16', {
      recurrenceId: prefix, isMultiDay: null, startTime: 0, endTime: 1440,
    });
    const saved = await agent.post('/api/v1/bookings').send({
      date: '2001-01-15', carId: carIds[0], startTime: 0, endTime: 1440,
      existingBookingId: first.id, existingParentId: first.parentId,
      userIds: [ids.rider], recurrenceId: prefix, isMultiDay,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.bookings[0].recurrence.isMultiDay).toBe(isMultiDay);
    const response = await agent.post('/api/v1/trips').send(payload({ bookingId: first.id }));
    expect(response.status).toBe(201);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: first.id } })).logged).toBe(response.body.id);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: last.id } })).logged)
      .toBe(isMultiDay ? response.body.id : null);
  });

  it.each([
    { startTime: 0, endTime: 1440 },
    { startTime: 480, endTime: 600 },
  ])('rejects unresolved legacy metadata regardless of geometry %j', async times => {
    const first = await seedBooking('2001-01-15', { recurrenceId: prefix, isMultiDay: null, ...times });
    const last = await seedBooking('2001-01-16', { recurrenceId: prefix, isMultiDay: null, ...times });
    const events = listen('trips');
    const bookingEvents = listen(`bookings:${ids.actor}`);
    const response = await agent.post('/api/v1/trips').send(payload({ bookingId: first.id }));
    expect(response.status).toBe(409);
    expect(await prisma.trip.count({ where: { carId: carIds[0] } })).toBe(0);
    for (const booking of [first, last]) {
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).logged).toBeNull();
    }
    expect(events()).toEqual([]);
    expect(bookingEvents()).toEqual([]);
    expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: prefix } }))
      .toEqual(expect.objectContaining({
        id: prefix, isMultiDay: null, recurringStartDate: '2001-01-01',
        recurringEndDate: '2001-12-31', recurringDays: [0, 1, 2, 3, 4, 5, 6],
        createdAt: expect.any(Date), updatedAt: expect.any(Date),
      }));
  });

  it.each(['invalid-middle', 'date-gap'] as const)(
    'only logs the chosen explicitly ordinary %s recurrence instance', async kind => {
      const first = await seedBooking('2001-01-15', { recurrenceId: prefix, endTime: 1440 });
      const middle = await seedBooking('2001-01-16', {
        recurrenceId: prefix, startTime: kind === 'invalid-middle' ? 480 : 0,
        endTime: kind === 'invalid-middle' ? 600 : 1440,
      });
      const last = await seedBooking(kind === 'date-gap' ? '2001-01-18' : '2001-01-17', {
        recurrenceId: prefix, startTime: 0, endTime: 600,
      });
      const response = await agent.post('/api/v1/trips').send(payload({ bookingId: last.id }));
      expect(response.status).toBe(201);
      for (const booking of [first, middle]) {
        expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).logged).toBeNull();
      }
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: last.id } })).logged).toBe(response.body.id);
    },
  );

  it.each([false, true])('rejects an explicit isMultiDay=%s series spanning different cars without partial logging', async isMultiDay => {
    const first = await seedBooking('2001-01-15', { recurrenceId: prefix, isMultiDay, endTime: 1440 });
    const last = await seedBooking('2001-01-16', {
      recurrenceId: prefix, isMultiDay, carId: carIds[1], startTime: 0,
    });
    const trips = listen('trips');
    const bookings = listen(`bookings:${ids.actor}`);
    const response = await agent.post('/api/v1/trips').send(payload({ bookingId: first.id }));
    expect(response.status).toBe(409);
    expect(await prisma.trip.count({ where: { carId: { in: carIds } } })).toBe(0);
    for (const booking of [first, last]) {
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).logged).toBeNull();
    }
    expect(trips()).toEqual([]);
    expect(bookings()).toEqual([]);
  });

  it.each([2, 3])('logs every day of a %i-day journey and publishes exact committed containers to affected users', async days => {
    const series = [];
    for (let index = 0; index < days; index++) {
      series.push(await seedBooking(`2001-01-${15 + index}`, {
        recurrenceId: prefix, isMultiDay: true, startTime: index === 0 ? 480 : 0, endTime: index === days - 1 ? 600 : 1440,
      }));
    }
    await seedBooking('2001-01-15', { startTime: 60, endTime: 120, byUserId: ids.other, userIds: [ids.other] });
    const since = new Date('2000-01-01T00:00:00Z');
    await prisma.dateCarBooking.updateMany({ where: { carId: carIds[0] }, data: { updatedAt: since } });
    const listeners = Object.fromEntries(Object.entries(ids).map(([role, id]) => [role, listen(`bookings:${id}`)]));
    const trips = listen('trips');
    const response = await agent.post('/api/v1/trips').send(payload({ bookingId: series[days - 1].id }));
    expect(response.status).toBe(201);
    expect(trips()).toEqual([{ event: 'add', data: response.body }]);
    const parents = await prisma.dateCarBooking.findMany({ where: { carId: carIds[0] } });
    for (const booking of series) {
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).logged).toBe(response.body.id);
    }
    for (const role of ['actor', 'creator', 'rider']) {
      const events = listeners[role]();
      expect(events).toHaveLength(days);
      expect(events.map(event => event.data.id).sort()).toEqual(parents.map(parent => parent.id).sort());
      for (const event of events) {
        expect(event.event).toBe('update');
        const parent = parents.find(p => p.id === event.data.id)!;
        expect(event.data.updatedAt).toBe(parent.updatedAt.toISOString());
        expect(parent.updatedAt.getTime()).toBeGreaterThan(since.getTime());
        expect(event.data.bookings.filter((b: { recurrenceId?: string }) => b.recurrenceId === prefix))
          .toEqual([expect.objectContaining({ logged: response.body.id, isMultiDay: true })]);
        for (const booking of event.data.bookings.filter((b: { recurrenceId?: string }) => !b.recurrenceId)) {
          expect(booking).not.toHaveProperty('isMultiDay');
        }
      }
    }
    expect(listeners.other()).toHaveLength(1);
    expect(listeners.other()[0].data.id).toBe(series[0].parentId);
    expect(listeners.outsider()).toEqual([]);
    const delta = await agent.get('/api/v1/bookings').query({
      startDate: '2001-01-15', endDate: '2001-01-17', since: since.toISOString(),
    });
    expect(delta.body.bookings.filter((p: { car: { id: string } }) => p.car.id === carIds[0])).toHaveLength(days);
  });

  it.each(['selected', 'another-day'] as const)('rejects an already logged %s without overwriting history', async kind => {
    const first = await seedBooking('2001-01-15', {
      recurrenceId: prefix, isMultiDay: true, endTime: 1440, logged: `${prefix}-historical-trip`,
    });
    const last = await seedBooking('2001-01-16', { recurrenceId: prefix, isMultiDay: true, startTime: 0 });
    const response = await agent.post('/api/v1/trips').send(payload({
      bookingId: kind === 'selected' ? first.id : last.id,
    }));
    expect(response.status).toBe(409);
    expect(await prisma.trip.count({ where: { carId: carIds[0] } })).toBe(0);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: first.id } })).logged).toBe(`${prefix}-historical-trip`);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: last.id } })).logged).toBeNull();
  });

  it('rolls back the created trip and every series update when one day cannot be claimed', async () => {
    const first = await seedBooking('2001-01-15', { recurrenceId: prefix, isMultiDay: true, endTime: 1440 });
    const booking = await seedBooking('2001-01-16', { recurrenceId: prefix, isMultiDay: true, startTime: 0 });
    const parents = await prisma.dateCarBooking.findMany({
      where: { carId: carIds[0] }, orderBy: { id: 'asc' },
    });
    const trigger = `${prefix}-trigger`.replace(/-/g, '_');
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RETURN NULL; END $$;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${trigger}" BEFORE UPDATE ON "Booking"
      FOR EACH ROW WHEN (OLD.id = '${booking.id}') EXECUTE FUNCTION "${trigger}"();
    `);
    try {
      const events = listen('trips');
      const response = await agent.post('/api/v1/trips').send(payload({ bookingId: booking.id }));
      expect(response.status).toBe(409);
      expect(await prisma.trip.count({ where: { carId: carIds[0] } })).toBe(0);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).logged).toBeNull();
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: first.id } })).logged).toBeNull();
      expect(await prisma.dateCarBooking.findMany({
        where: { carId: carIds[0] }, orderBy: { id: 'asc' },
      })).toEqual(parents);
      expect(events()).toEqual([]);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON "Booking"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${trigger}"()`);
    }
  });

  it('rejects invalid odometer and unknown passengers without changing the linked booking', async () => {
    const booking = await seedBooking();
    expect((await agent.post('/api/v1/trips').send(payload())).status).toBe(201);
    for (const extra of [{ odo: 9999 }, { odo: 10001, userIds: [`${prefix}-missing`] }]) {
      const response = await agent.post('/api/v1/trips').send(payload({ bookingId: booking.id, ...extra }));
      expect([400, 409]).toContain(response.status);
    }
    expect(await prisma.trip.count({ where: { carId: carIds[0] } })).toBe(1);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).logged).toBeNull();
  });

  it.each([{ odo: 10.5 }, { distance: 2.5 }, { cost: '75' }, { userIds: [ids.actor, ids.actor] }])(
    'rejects malformed trip input %j', async extra => {
      expect((await agent.post('/api/v1/trips').send(payload(extra))).status).toBe(400);
      expect(await prisma.trip.count({ where: { carId: carIds[0] } })).toBe(0);
    },
  );

  it('serializes simultaneous logging of the same booking so only one trip is created', async () => {
    const booking = await seedBooking();
    const responses = await Promise.all([10000, 10001].map(odo =>
      agent.post('/api/v1/trips').send(payload({ bookingId: booking.id, odo })),
    ));
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect(await prisma.trip.count({ where: { carId: carIds[0] } })).toBe(1);
    const success = responses.find(response => response.status === 201)!;
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).logged).toBe(success.body.id);
  });

  it('serializes simultaneous logging from different days of the same multiday journey', async () => {
    const first = await seedBooking('2001-01-15', { recurrenceId: prefix, isMultiDay: true, endTime: 1440 });
    const last = await seedBooking('2001-01-16', { recurrenceId: prefix, isMultiDay: true, startTime: 0 });
    const responses = await Promise.all([first, last].map((booking, index) =>
      agent.post('/api/v1/trips').send(payload({ bookingId: booking.id, odo: 10000 + index })),
    ));
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect(await prisma.trip.count({ where: { carId: carIds[0] } })).toBe(1);
    const success = responses.find(response => response.status === 201)!;
    for (const booking of [first, last]) {
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).logged).toBe(success.body.id);
    }
  });
});
