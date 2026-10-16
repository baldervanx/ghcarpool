import { randomUUID } from 'crypto';
import type { Response } from 'express';
import bcrypt from 'bcrypt';
import request from 'supertest';
import prisma from '../db/prisma';
import { subscribe, unsubscribe } from '../lib/sse';
import { loginAgent } from './helpers';
import { assertBookingTestDatabase } from './booking-test-database';

const prefix = `booking-mutations-${randomUUID()}`;
const ids = {
  actor: `${prefix}-actor`,
  creator: `${prefix}-creator`,
  removed: `${prefix}-removed`,
  added: `${prefix}-added`,
  other: `${prefix}-other`,
  outsider: `${prefix}-outsider`,
  admin: `${prefix}-admin`,
};
const carIds = [`${prefix}-car-a`, `${prefix}-car-b`];
const pastDate = '2001-01-15';
const targetDate = '2001-01-16';
const legacyRange = {
  recurringStartDate: '2001-01-01', recurringEndDate: '2001-12-31',
  recurringDays: [0, 1, 2, 3, 4, 5, 6],
};
let actor: request.Agent;
let creator: request.Agent;
let admin: request.Agent;
const subscriptions: ReturnType<typeof subscribe>[] = [];

beforeEach(() => {
  jest.replaceProperty(process, 'env', {
    ...process.env, NODE_ENV: 'development', ALLOW_PAST_BOOKINGS: 'true',
  });
});

beforeAll(async () => {
  await assertBookingTestDatabase();
  const passwordHash = await bcrypt.hash('booking-test-password', 4);
  await prisma.user.createMany({
    data: Object.entries(ids).map(([role, id]) => ({
      id, email: `${id}@test.com`, passwordHash, isAdmin: role === 'admin',
    })),
  });
  await prisma.car.createMany({
    data: carIds.map(id => ({ id, name: id, hasLog: true })),
  });
  actor = await loginAgent(`${ids.actor}@test.com`, 'booking-test-password');
  creator = await loginAgent(`${ids.creator}@test.com`, 'booking-test-password');
  admin = await loginAgent(`${ids.admin}@test.com`, 'booking-test-password');
});

afterEach(async () => {
  jest.restoreAllMocks();
  subscriptions.splice(0).forEach(unsubscribe);
  await prisma.dateCarBooking.deleteMany({ where: { carId: { in: carIds } } });
  await prisma.recurrence.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.destination.deleteMany({ where: { name: { startsWith: prefix } } });
});

afterAll(async () => {
  await prisma.car.deleteMany({ where: { id: { in: carIds } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await prisma.$disconnect();
});

async function seedBooking(overrides: {
  date?: string;
  carId?: string;
  logged?: string;
  recurrenceId?: string;
  isMultiDay?: boolean | null;
  startTime?: number;
  endTime?: number;
  byUserId?: string;
  userIds?: string[];
} = {}) {
  if (overrides.recurrenceId) {
    await prisma.recurrence.upsert({
      where: { id: overrides.recurrenceId },
      create: {
        id: overrides.recurrenceId,
        isMultiDay: overrides.isMultiDay === undefined ? false : overrides.isMultiDay,
        ...legacyRange,
      },
      update: {},
    });
  }
  const parent = await prisma.dateCarBooking.upsert({
    where: { date_carId: { date: overrides.date ?? pastDate, carId: overrides.carId ?? carIds[0] } },
    create: { date: overrides.date ?? pastDate, carId: overrides.carId ?? carIds[0] },
    update: {},
  });
  return prisma.booking.create({
    data: {
      parentId: parent.id,
      startTime: overrides.startTime ?? 480,
      endTime: overrides.endTime ?? 540,
      byUserId: overrides.byUserId ?? ids.creator,
      logged: overrides.logged,
      recurrenceId: overrides.recurrenceId,
      comment: 'original',
      users: { create: (overrides.userIds ?? [ids.removed]).map(userId => ({ userId })) },
    },
  });
}

function editPayload(booking: { id: string; parentId: string }, extra: object = {}) {
  return {
    date: pastDate, carId: carIds[0], startTime: 600, endTime: 660,
    userIds: [ids.added], existingBookingId: booking.id,
    existingParentId: booking.parentId, comment: 'edited', ...extra,
  };
}

function createPayload(extra: object = {}) {
  const series = extra as { recurrenceId?: unknown; isMultiDay?: unknown };
  return {
    date: targetDate, carId: carIds[0], startTime: 480, endTime: 540,
    userIds: [ids.added],
    ...(typeof series.recurrenceId === 'string' && typeof series.isMultiDay === 'boolean' ? legacyRange : {}),
    ...extra,
  };
}

function listen(userId: string) {
  const write = jest.fn();
  const res = { setHeader: jest.fn(), flushHeaders: jest.fn(), write } as unknown as Response;
  subscriptions.push(subscribe(`bookings:${userId}`, res));
  return () => write.mock.calls
    .map(([payload]) => String(payload))
    .filter(payload => !payload.startsWith('event: heartbeat'))
    .map(payload => ({
      event: payload.match(/^event: (.+)$/m)![1],
      data: JSON.parse(payload.match(/^data: (.+)$/m)![1]),
    }));
}

describe('atomic booking mutations', () => {
  it.each([
    { recurringStartDate: undefined, recurringEndDate: undefined, recurringDays: undefined },
    { recurringStartDate: undefined },
    { recurringEndDate: undefined },
    { recurringDays: undefined },
    { recurringStartDate: undefined, recurringEndDate: undefined },
    { recurringStartDate: undefined, recurringDays: undefined },
    { recurringEndDate: undefined, recurringDays: undefined },
  ])('requires every range field for a new series %j without any writes', async range => {
    const events = listen(ids.actor);
    const response = await actor.post('/api/v1/bookings').send(createPayload({
      recurrenceId: `${prefix}-missing-range`, isMultiDay: false, ...range,
      destinationId: `${prefix}-missing-range-destination`,
    }));
    expect(response.status).toBe(400);
    expect(await prisma.booking.count({ where: { parent: { carId: { in: carIds } } } })).toBe(0);
    expect(await prisma.dateCarBooking.count({ where: { carId: { in: carIds } } })).toBe(0);
    expect(await prisma.recurrence.count({ where: { id: { startsWith: prefix } } })).toBe(0);
    expect(await prisma.destination.count({ where: { name: { startsWith: prefix } } })).toBe(0);
    expect(events()).toEqual([]);
  });

  it.each([
    { recurringStartDate: '2001-1-01' },
    { recurringStartDate: '2001-01-01T00:00:00Z' },
    { recurringStartDate: '2001-02-29' },
    { recurringStartDate: '2001-02-31' },
    { recurringStartDate: '2001-13-01' },
    { recurringStartDate: '0000-01-01' },
    { recurringStartDate: null },
    { recurringEndDate: 'not-a-date' },
    { recurringEndDate: '2001-04-31' },
    { recurringEndDate: 20011231 },
    { recurringStartDate: '2001-02-01', recurringEndDate: '2001-01-01' },
    { recurringDays: [-1, 1] },
    { recurringDays: [1, 7] },
    { recurringDays: [1.5] },
    { recurringDays: [1, 1] },
    { recurringDays: ['1'] },
    { recurringDays: null },
    { recurringDays: {} },
    { recurringDays: [] },
  ])('rejects invalid range/day metadata %j before booking or metadata writes', async range => {
    const recurrenceId = `${prefix}-invalid-range`;
    const existing = await seedBooking({ recurrenceId });
    const original = await prisma.booking.findUniqueOrThrow({ where: { id: existing.id }, include: { users: true } });
    const metadata = await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } });
    const parents = await prisma.dateCarBooking.findMany({ where: { carId: { in: carIds } } });
    const events = listen(ids.actor);
    for (const id of [`${prefix}-invalid-new-range`, recurrenceId]) {
      const response = await actor.post('/api/v1/bookings').send(createPayload({
        recurrenceId: id, isMultiDay: false, ...range, destinationId: `${prefix}-invalid-range-destination`,
      }));
      expect(response.status).toBe(400);
      expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } })).toEqual(metadata);
      expect(await prisma.recurrence.findUnique({ where: { id: `${prefix}-invalid-new-range` } })).toBeNull();
      expect(await prisma.booking.findUniqueOrThrow({ where: { id: existing.id }, include: { users: true } })).toEqual(original);
      expect(await prisma.booking.count({ where: { parent: { carId: { in: carIds } } } })).toBe(1);
      expect(await prisma.dateCarBooking.findMany({ where: { carId: { in: carIds } } })).toEqual(parents);
      expect(await prisma.destination.count({ where: { name: { startsWith: prefix } } })).toBe(0);
      expect(events()).toEqual([]);
    }
  });

  it.each(['recurringStartDate', 'recurringEndDate', 'recurringDays'] as const)(
    'rejects a partial existing metadata update containing only %s', async field => {
      const recurrenceId = `${prefix}-partial-existing`;
      const booking = await seedBooking({ recurrenceId });
      const metadata = await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } });
      const original = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { users: true } });
      const events = listen(ids.actor);
      const response = await actor.post('/api/v1/bookings').send(editPayload(booking, {
        recurrenceId, [field]: legacyRange[field],
      }));
      expect(response.status).toBe(400);
      expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } })).toEqual(metadata);
      expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { users: true } })).toEqual(original);
      expect(events()).toEqual([]);
    },
  );

  it.each([
    { date: '2001-01-15', recurringStartDate: '2001-01-16', recurringEndDate: '2001-01-31', recurringDays: [0, 1] },
    { date: '2001-02-01', recurringStartDate: '2001-01-01', recurringEndDate: '2001-01-31', recurringDays: [3] },
    { date: '2001-01-16', recurringStartDate: '2001-01-01', recurringEndDate: '2001-01-31', recurringDays: [0] },
    { date: '2001-01-14', recurringStartDate: '2001-01-01', recurringEndDate: '2001-01-31', recurringDays: [0] },
  ])('rejects out-of-range or unselected weekday booking %j without writes', async range => {
    const recurrenceId = `${prefix}-range-mismatch`;
    const booking = await seedBooking({ recurrenceId });
    const metadata = await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } });
    const original = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { users: true } });
    const parents = await prisma.dateCarBooking.findMany({ where: { carId: { in: carIds } } });
    const events = listen(ids.actor);
    for (const operation of ['new', 'edit']) {
      const extra = { ...range, recurrenceId: operation === 'new' ? `${prefix}-new-mismatch` : recurrenceId, isMultiDay: false };
      const response = await actor.post('/api/v1/bookings').send(operation === 'new'
        ? createPayload(extra) : editPayload(booking, extra));
      expect(response.status).toBe(400);
      expect(await prisma.recurrence.findUnique({ where: { id: `${prefix}-new-mismatch` } })).toBeNull();
      expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } })).toEqual(metadata);
      expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { users: true } })).toEqual(original);
      expect(await prisma.dateCarBooking.findMany({ where: { carId: { in: carIds } } })).toEqual(parents);
      expect(events()).toEqual([]);
    }
  });

  it.each([
    { date: '2001-01-15', recurringDays: [0], isMultiDay: false },
    { date: '2001-01-21', recurringDays: [6], isMultiDay: false },
    { date: '2000-02-29', recurringDays: [1], isMultiDay: false },
    { date: '2001-01-16', recurringDays: [], isMultiDay: true },
  ])('uses Monday=0 through Sunday=6 and permits empty weekdays only for multi-day %j', async extra => {
    const recurrenceId = `${prefix}-valid-day`;
    const range = { recurringStartDate: extra.date, recurringEndDate: extra.date, recurringDays: extra.recurringDays };
    const events = listen(ids.added);
    const response = await actor.post('/api/v1/bookings').send(createPayload({ recurrenceId, ...extra, ...range }));
    expect(response.status).toBe(201);
    expect(response.body.bookings).toEqual([expect.objectContaining({
      recurrence: { id: recurrenceId, isMultiDay: extra.isMultiDay, ...range },
    })]);
    expect(events()).toEqual([{ event: 'add', data: response.body }]);
  });

  it.each([
    { recurrenceId: `${prefix}-missing-kind` },
    { recurrenceId: `${prefix}-null-kind`, isMultiDay: null },
    { recurrenceId: `${prefix}-string-kind`, isMultiDay: 'true' },
    { recurrenceId: `${prefix}-number-kind`, isMultiDay: 1 },
    { recurrenceId: `${prefix}-object-kind`, isMultiDay: {} },
    { recurrenceId: `${prefix}-array-kind`, isMultiDay: [] },
    { isMultiDay: true },
    { isMultiDay: false },
  ])('rejects incomplete or malformed new series metadata %j without writes or SSE', async extra => {
    const events = listen(ids.actor);
    const response = await actor.post('/api/v1/bookings').send(createPayload({
      ...extra, destinationId: `${prefix}-invalid-series-destination`,
    }));
    expect(response.status).toBe(400);
    expect(await prisma.booking.count({ where: { parent: { carId: { in: carIds } } } })).toBe(0);
    expect(await prisma.dateCarBooking.count({ where: { carId: { in: carIds } } })).toBe(0);
    expect(await prisma.recurrence.count({ where: { id: { startsWith: prefix } } })).toBe(0);
    expect(await prisma.destination.count({ where: { name: { startsWith: prefix } } })).toBe(0);
    expect(events()).toEqual([]);
  });

  it.each([false, true])('persists and serializes isMultiDay=%s in saves, GET and SSE', async isMultiDay => {
    const recurrenceId = `${prefix}-created-series`;
    const events = listen(ids.added);
    const response = await actor.post('/api/v1/bookings').send(createPayload({ recurrenceId, isMultiDay }));
    expect(response.status).toBe(201);
    const recurrence = { id: recurrenceId, isMultiDay, ...legacyRange };
    expect(response.body.bookings).toEqual([expect.objectContaining({ recurrenceId, isMultiDay, recurrence })]);
    expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } }))
      .toEqual(expect.objectContaining({ ...recurrence, createdAt: expect.any(Date), updatedAt: expect.any(Date) }));
    expect(events()).toEqual([{ event: 'add', data: response.body }]);
    const saved = response.body.bookings[0];
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: saved.id } }))
      .toEqual(expect.objectContaining({ recurrenceId }));
    const edited = await actor.post('/api/v1/bookings').send(editPayload(
      { id: saved.id, parentId: response.body.id },
      { date: targetDate, recurrenceId, isMultiDay },
    ));
    expect(edited.status).toBe(200);
    expect(edited.body.bookings).toEqual([expect.objectContaining({ recurrenceId, isMultiDay, recurrence })]);
    expect(events()).toEqual([
      { event: 'add', data: response.body },
      { event: 'update', data: edited.body },
    ]);
    const result = await actor.get('/api/v1/bookings').query({ startDate: pastDate, endDate: targetDate });
    expect(result.status).toBe(200);
    expect(result.body.bookings.find((parent: { id: string }) => parent.id === response.body.id).bookings)
      .toEqual([expect.objectContaining({ id: saved.id, recurrenceId, isMultiDay, recurrence })]);
  });

  it('omits recurrence metadata for an ordinary create beside a persisted series', async () => {
    await seedBooking({ recurrenceId: `${prefix}-separate-series`, isMultiDay: true });
    const events = listen(ids.added);
    const response = await actor.post('/api/v1/bookings').send(createPayload());
    expect(response.status).toBe(201);
    expect(response.body.bookings).toHaveLength(1);
    expect(response.body.bookings[0]).not.toHaveProperty('recurrenceId');
    expect(response.body.bookings[0]).not.toHaveProperty('isMultiDay');
    expect(response.body.bookings[0].recurrence).toBeNull();
    expect(events()).toEqual([{ event: 'add', data: response.body }]);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: response.body.bookings[0].id } })).recurrenceId)
      .toBeNull();
    expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: `${prefix}-separate-series` } }))
      .toEqual(expect.objectContaining({ id: `${prefix}-separate-series`, isMultiDay: true, ...legacyRange }));
    const result = await actor.get('/api/v1/bookings').query({ startDate: pastDate, endDate: targetDate });
    expect(result.status).toBe(200);
    const saved = result.body.bookings.find((parent: { id: string }) => parent.id === response.body.id).bookings[0];
    expect(saved.recurrence).toBeNull();
    expect(saved).not.toHaveProperty('isMultiDay');
  });

  it.each([
    { isMultiDay: false, conflicting: true },
    { isMultiDay: true, conflicting: false },
  ])('rejects immutable series kind conflicts %j on create and edit with full rollback', async ({ isMultiDay, conflicting }) => {
    const recurrenceId = `${prefix}-immutable-series`;
    const booking = await seedBooking({ recurrenceId, isMultiDay });
    const original = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { users: true } });
    const parents = await prisma.dateCarBooking.findMany({ where: { carId: { in: carIds } }, orderBy: { id: 'asc' } });
    const events = listen(ids.actor);
    for (const operation of ['create', 'edit']) {
      const extra = {
        recurrenceId, isMultiDay: conflicting, destinationId: `${prefix}-kind-conflict-destination`,
      };
      const response = await actor.post('/api/v1/bookings').send(operation === 'create'
        ? createPayload(extra)
        : editPayload(booking, { date: targetDate, ...extra }));
      expect(response.status).toBe(409);
      expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { users: true } })).toEqual(original);
      expect(await prisma.booking.count({ where: { recurrenceId } })).toBe(1);
      expect(await prisma.dateCarBooking.findMany({ where: { carId: { in: carIds } }, orderBy: { id: 'asc' } })).toEqual(parents);
      expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } }))
        .toEqual(expect.objectContaining({ id: recurrenceId, isMultiDay, ...legacyRange }));
      expect(await prisma.destination.count({ where: { name: { startsWith: prefix } } })).toBe(0);
      expect(events()).toEqual([]);
    }
  });

  it.each([
    { operation: 'edit', kind: false }, { operation: 'edit', kind: true },
    { operation: 'create', kind: false }, { operation: 'create', kind: true },
  ])('resolves legacy null to $kind exactly once via $operation without changing logged history', async ({ operation, kind }) => {
    const recurrenceId = `${prefix}-resolve-kind`;
    const historical = await seedBooking({
      recurrenceId, isMultiDay: null, date: '2001-01-14',
      logged: `${prefix}-historical-trip`, byUserId: ids.other, userIds: [ids.other],
    });
    const booking = await seedBooking({ recurrenceId, isMultiDay: null });
    const history = await prisma.booking.findUniqueOrThrow({ where: { id: historical.id }, include: { users: true } });
    const original = await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } });
    const since = new Date('2000-01-01T00:00:00Z');
    await prisma.dateCarBooking.updateMany({
      where: { carId: carIds[0] }, data: { updatedAt: since },
    });
    const actorEvents = listen(ids.actor);
    const historyEvents = listen(ids.other);
    const extra = { recurrenceId, isMultiDay: kind };
    const response = await actor.post('/api/v1/bookings').send(operation === 'edit'
      ? editPayload(booking, extra) : createPayload(extra));
    expect(response.status).toBe(operation === 'edit' ? 200 : 201);
    expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } })).toEqual(expect.objectContaining({
      ...original, isMultiDay: kind, updatedAt: expect.any(Date),
    }));
    expect(response.body.bookings[0].recurrence).toEqual({ id: recurrenceId, isMultiDay: kind, ...legacyRange });
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: historical.id }, include: { users: true } })).toEqual(history);
    const events = actorEvents();
    expect(events).toHaveLength(operation === 'edit' ? 2 : 3);
    expect(historyEvents()).toHaveLength(1);
    expect(historyEvents()[0].event).toBe('update');
    expect(historyEvents()[0].data.id).toBe(historical.parentId);
    for (const event of events) {
      expect(new Date(event.data.updatedAt).getTime()).toBeGreaterThan(since.getTime());
      expect(event.data.bookings[0].recurrence).toEqual({ id: recurrenceId, isMultiDay: kind, ...legacyRange });
    }
    const resolved = await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } });
    const rejected = await actor.post('/api/v1/bookings').send(editPayload(booking, {
      recurrenceId, isMultiDay: !kind,
    }));
    expect(rejected.status).toBe(409);
    expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } })).toEqual(resolved);
    expect(actorEvents()).toEqual(events);
  });

  it('rolls back null-kind resolution and every historical timestamp if the booking save collides', async () => {
    const recurrenceId = `${prefix}-rollback-resolution`;
    const booking = await seedBooking({ recurrenceId, isMultiDay: null });
    await seedBooking({ date: targetDate, recurrenceId, isMultiDay: null, logged: `${prefix}-logged` });
    await seedBooking({ date: '2001-01-17', startTime: 600, endTime: 660 });
    const original = await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } });
    const parents = await prisma.dateCarBooking.findMany({ where: { carId: carIds[0] }, orderBy: { id: 'asc' } });
    const events = listen(ids.actor);
    const response = await actor.post('/api/v1/bookings').send(editPayload(booking, {
      date: '2001-01-17', recurrenceId, isMultiDay: false,
    }));
    expect(response.status).toBe(409);
    expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } })).toEqual(original);
    expect(await prisma.dateCarBooking.findMany({ where: { carId: carIds[0] }, orderBy: { id: 'asc' } })).toEqual(parents);
    expect(events()).toEqual([]);
  });

  it('serializes competing null-kind resolutions so only one boolean is persisted', async () => {
    const recurrenceId = `${prefix}-concurrent-resolution`;
    const booking = await seedBooking({ recurrenceId, isMultiDay: null });
    const responses = await Promise.all([false, true].map(isMultiDay =>
      actor.post('/api/v1/bookings').send(editPayload(booking, { recurrenceId, isMultiDay })),
    ));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const success = responses.find(response => response.status === 200)!;
    expect((await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } })).isMultiDay)
      .toBe(success.body.bookings[0].recurrence.isMultiDay);
  });

  it('cannot resolve legacy metadata by editing a logged booking', async () => {
    const recurrenceId = `${prefix}-logged-resolution`;
    const booking = await seedBooking({ recurrenceId, isMultiDay: null, logged: `${prefix}-historical-trip` });
    const original = await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } });
    const events = listen(ids.actor);
    const response = await actor.post('/api/v1/bookings').send(editPayload(booking, { isMultiDay: false }));
    expect(response.status).toBe(409);
    expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } })).toEqual(original);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toEqual(booking);
    expect(events()).toEqual([]);
  });

  it('rolls back kind resolution if the requested instance is outside the intended range', async () => {
    const recurrenceId = `${prefix}-invalid-resolution`;
    const booking = await seedBooking({ recurrenceId, isMultiDay: null });
    const original = await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } });
    const parent = await prisma.dateCarBooking.findUniqueOrThrow({ where: { id: booking.parentId } });
    const events = listen(ids.actor);
    const response = await actor.post('/api/v1/bookings').send(editPayload(booking, {
      isMultiDay: false, date: '2002-01-01',
    }));
    expect(response.status).toBe(400);
    expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } })).toEqual(original);
    expect(await prisma.dateCarBooking.findUniqueOrThrow({ where: { id: booking.parentId } })).toEqual(parent);
    expect(events()).toEqual([]);
  });

  it.each([false, true, null])('allows omitted existing series kind %s without resolving or changing it', async isMultiDay => {
    const recurrenceId = `${prefix}-existing-series`;
    await seedBooking({ recurrenceId, isMultiDay });
    const events = listen(ids.added);
    const response = await actor.post('/api/v1/bookings').send(createPayload({ recurrenceId }));
    expect(response.status).toBe(201);
    expect(response.body.bookings).toEqual([expect.objectContaining({ recurrenceId, isMultiDay })]);
    expect(events()).toEqual([{ event: 'add', data: response.body }]);
    expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } }))
      .toEqual(expect.objectContaining({ id: recurrenceId, isMultiDay, ...legacyRange }));
    const result = await actor.get('/api/v1/bookings').query({ startDate: pastDate, endDate: targetDate });
    expect(result.status).toBe(200);
    const parents = result.body.bookings.filter((parent: { car: { id: string } }) => parent.car.id === carIds[0]);
    expect(parents).toHaveLength(2);
    for (const parent of parents) {
      expect(parent.bookings).toEqual([expect.objectContaining({ recurrenceId, isMultiDay })]);
    }
  });

  it('preserves the existing recurrence link when an edit omits both recurrence fields', async () => {
    const recurrenceId = `${prefix}-retained-omitted`;
    const booking = await seedBooking({ recurrenceId, isMultiDay: false });
    const metadata = await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } });
    const response = await actor.post('/api/v1/bookings').send(editPayload(booking));
    expect(response.status).toBe(200);
    expect(response.body.bookings).toEqual([expect.objectContaining({
      recurrenceId, isMultiDay: false, recurrence: { id: recurrenceId, isMultiDay: false, ...legacyRange },
    })]);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).recurrenceId).toBe(recurrenceId);
    expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } })).toEqual(metadata);
  });

  it('edits future range metadata while preserving logged history and refreshing every linked container', async () => {
    const recurrenceId = `${prefix}-edited-range`;
    const historical = await seedBooking({
      recurrenceId, logged: `${prefix}-historical-trip`, byUserId: ids.other, userIds: [ids.other],
    });
    const futureDate = '2099-01-05';
    const future = await seedBooking({ recurrenceId, date: futureDate });
    const untouched = await seedBooking({ date: '2001-01-17' });
    const history = await prisma.booking.findUniqueOrThrow({ where: { id: historical.id }, include: { users: true } });
    const since = new Date('2000-01-01T00:00:00Z');
    await prisma.dateCarBooking.updateMany({ where: { carId: { in: carIds } }, data: { updatedAt: since } });
    await prisma.recurrence.update({ where: { id: recurrenceId }, data: { updatedAt: since } });
    const metadata = await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } });
    const listeners = Object.fromEntries(Object.entries(ids).map(([role, id]) => [role, listen(id)]));
    const range = {
      recurringStartDate: futureDate, recurringEndDate: '2099-02-01',
      recurringDays: [0, 1, 2, 3, 4, 5, 6],
    };
    const recurrence = { id: recurrenceId, isMultiDay: false, ...range };
    const response = await actor.post('/api/v1/bookings').send(editPayload(future, {
      date: futureDate, recurrenceId, ...range,
    }));
    expect(response.status).toBe(200);
    expect(response.body.bookings).toEqual([expect.objectContaining({ id: future.id, recurrence })]);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: historical.id }, include: { users: true } })).toEqual(history);
    expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } })).toEqual(expect.objectContaining({
      ...recurrence, createdAt: metadata.createdAt, updatedAt: expect.any(Date),
    }));
    expect((await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } })).updatedAt.getTime())
      .toBeGreaterThan(since.getTime());
    for (const parentId of [historical.parentId, future.parentId]) {
      expect((await prisma.dateCarBooking.findUniqueOrThrow({ where: { id: parentId } })).updatedAt.getTime())
        .toBeGreaterThan(since.getTime());
      const event = listeners.actor().find(event => event.data.id === parentId)!;
      expect(event).toBeDefined();
      expect(event.event).toBe('update');
      expect(event.data.bookings).toEqual([expect.objectContaining({ recurrence })]);
      expect(new Date(event.data.updatedAt).getTime()).toBeGreaterThan(since.getTime());
    }
    expect(listeners.actor()).toHaveLength(2);
    for (const [role, parentId] of [
      ['other', historical.parentId], ['creator', future.parentId], ['removed', future.parentId], ['added', future.parentId],
    ]) {
      expect(listeners[role]()).toEqual(expect.arrayContaining([
        { event: 'update', data: expect.objectContaining({ id: parentId, bookings: [expect.objectContaining({ recurrence })] }) },
      ]));
    }
    expect(listeners.outsider()).toEqual([]);
    expect((await prisma.dateCarBooking.findUniqueOrThrow({ where: { id: untouched.parentId } })).updatedAt).toEqual(since);
    const result = await actor.get('/api/v1/bookings').query({ startDate: pastDate, endDate: futureDate, since: since.toISOString() });
    expect(result.status).toBe(200);
    for (const parentId of [historical.parentId, future.parentId]) {
      expect(result.body.bookings.find((parent: { id: string }) => parent.id === parentId).bookings)
        .toEqual([expect.objectContaining({ recurrence })]);
    }
  });

  it('rolls back range metadata and all historical container timestamps when an edited booking collides', async () => {
    const recurrenceId = `${prefix}-rollback-range`;
    const historical = await seedBooking({ recurrenceId, logged: `${prefix}-history` });
    const booking = await seedBooking({ date: targetDate, recurrenceId });
    await seedBooking({ date: targetDate, startTime: 600, endTime: 660 });
    const metadata = await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } });
    const history = await prisma.booking.findUniqueOrThrow({ where: { id: historical.id }, include: { users: true } });
    const original = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { users: true } });
    const parents = await prisma.dateCarBooking.findMany({ where: { carId: { in: carIds } }, orderBy: { id: 'asc' } });
    const events = listen(ids.actor);
    const response = await actor.post('/api/v1/bookings').send(editPayload(booking, {
      date: targetDate, recurrenceId, recurringStartDate: targetDate,
      recurringEndDate: '2001-01-31', recurringDays: [1],
      destinationId: `${prefix}-rollback-range-destination`,
    }));
    expect(response.status).toBe(409);
    expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } })).toEqual(metadata);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { users: true } })).toEqual(original);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: historical.id }, include: { users: true } })).toEqual(history);
    expect(await prisma.dateCarBooking.findMany({ where: { carId: { in: carIds } }, orderBy: { id: 'asc' } })).toEqual(parents);
    expect(await prisma.destination.count({ where: { name: { startsWith: prefix } } })).toBe(0);
    expect(events()).toEqual([]);
  });

  it('serializes concurrent saves of identical new range metadata without losing linked instances', async () => {
    const recurrenceId = `${prefix}-concurrent-range`;
    const range = { recurringStartDate: pastDate, recurringEndDate: '2001-01-21', recurringDays: [0, 1, 2] };
    const events = listen(ids.actor);
    const responses = await Promise.all([pastDate, targetDate, '2001-01-17'].map(date =>
      actor.post('/api/v1/bookings').send(createPayload({ date, recurrenceId, isMultiDay: false, ...range })),
    ));
    expect(responses.map(response => response.status)).toEqual([201, 201, 201]);
    const recurrence = { id: recurrenceId, isMultiDay: false, ...range };
    expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } }))
      .toEqual(expect.objectContaining({ ...recurrence, createdAt: expect.any(Date), updatedAt: expect.any(Date) }));
    expect(await prisma.booking.count({ where: { recurrenceId } })).toBe(3);
    expect(await prisma.dateCarBooking.count({ where: { carId: { in: carIds } } })).toBe(3);
    for (const response of responses) {
      expect(response.body.bookings).toEqual([expect.objectContaining({ recurrence })]);
      expect(events()).toEqual(expect.arrayContaining([{ event: 'add', data: response.body }]));
    }
  });

  it('serializes conflicting new series creation across cars without orphaned metadata or mixed-kind bookings', async () => {
    const recurrenceId = `${prefix}-concurrent-kind`;
    const responses = await Promise.all(carIds.map((carId, index) =>
      actor.post('/api/v1/bookings').send(createPayload({ carId, recurrenceId, isMultiDay: index === 0 })),
    ));
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    const success = responses.find(response => response.status === 201)!;
    const kind = success.body.bookings[0].isMultiDay;
    expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } }))
      .toEqual(expect.objectContaining({ id: recurrenceId, isMultiDay: kind, ...legacyRange }));
    expect(await prisma.booking.count({ where: { recurrenceId } })).toBe(1);
    expect(await prisma.dateCarBooking.count({ where: { carId: { in: carIds } } })).toBe(1);
  });

  it('rolls back new recurrence metadata when the booking collides with an existing interval', async () => {
    const booking = await seedBooking({ date: targetDate });
    const recurrenceId = `${prefix}-overlapping-new-series`;
    const response = await actor.post('/api/v1/bookings').send(createPayload({ recurrenceId, isMultiDay: true }));
    expect(response.status).toBe(409);
    expect(await prisma.recurrence.findUnique({ where: { id: recurrenceId } })).toBeNull();
    expect(await prisma.booking.count({ where: { parentId: booking.parentId } })).toBe(1);
  });

  it.each([false, true, null])('rejects joining an existing %s series on another car with no writes', async isMultiDay => {
    const recurrenceId = `${prefix}-single-car-series`;
    const booking = await seedBooking({ recurrenceId, isMultiDay });
    await seedBooking({ date: '2001-01-17', recurrenceId, isMultiDay });
    const original = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    const events = listen(ids.actor);
    for (const operation of ['create', 'edit']) {
      const extra = { carId: carIds[1], recurrenceId, destinationId: `${prefix}-wrong-car-destination` };
      const response = await actor.post('/api/v1/bookings').send(operation === 'create'
        ? createPayload(extra)
        : editPayload(booking, { date: targetDate, ...extra }));
      expect(response.status).toBe(409);
      expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toEqual(original);
      expect(await prisma.booking.count({ where: { recurrenceId } })).toBe(2);
      expect(await prisma.dateCarBooking.count({ where: { carId: { in: carIds } } })).toBe(2);
      expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } }))
        .toEqual(expect.objectContaining({ id: recurrenceId, isMultiDay, ...legacyRange }));
      expect(await prisma.destination.count({ where: { name: { startsWith: prefix } } })).toBe(0);
      expect(events()).toEqual([]);
    }
  });

  it('allows another authenticated user to edit a past unlogged booking without changing its creator', async () => {
    const booking = await seedBooking();
    const response = await actor.post('/api/v1/bookings').send(editPayload(booking));
    expect(response.status).toBe(200);
    expect(response.body.bookings).toEqual([expect.objectContaining({
      id: booking.id, comment: 'edited', byUser: { id: ids.creator }, users: [{ id: ids.added }],
    })]);
    expect(await prisma.booking.count({ where: { parent: { carId: { in: carIds } } } })).toBe(1);
  });

  it.each(['edit', 'delete'] as const)('rejects %s of a logged booking without destination/container writes or SSE', async (operation) => {
    const booking = await seedBooking({ logged: `${prefix}-historical-trip` });
    const original = await prisma.booking.findUnique({ where: { id: booking.id }, include: { users: true } });
    const parent = await prisma.dateCarBooking.findUnique({ where: { id: booking.parentId } });
    const events = listen(ids.creator);
    const response = operation === 'edit'
      ? await actor.post('/api/v1/bookings').send(editPayload(booking, {
        date: targetDate, carId: carIds[1], destinationId: `${prefix}-rejected-destination`,
      }))
      : await creator.delete(`/api/v1/bookings/${booking.parentId}/${booking.id}`);
    expect(response.status).toBe(409);
    expect(await prisma.booking.findUnique({ where: { id: booking.id }, include: { users: true } })).toEqual(original);
    expect(await prisma.dateCarBooking.findUnique({ where: { id: booking.parentId } })).toEqual(parent);
    expect(await prisma.dateCarBooking.count({ where: { carId: { in: carIds } } })).toBe(1);
    expect(await prisma.destination.count({ where: { name: { startsWith: prefix } } })).toBe(0);
    expect(events()).toEqual([]);
  });

  it.each([
    { operation: 'edit', isMultiDay: false },
    { operation: 'delete', isMultiDay: false },
    { operation: 'edit', isMultiDay: true },
    { operation: 'delete', isMultiDay: true },
    { operation: 'edit', isMultiDay: null },
    { operation: 'delete', isMultiDay: null },
  ])('preserves historical logged relations and series metadata during $operation with kind $isMultiDay', async ({ operation, isMultiDay }) => {
    const recurrenceId = `${prefix}-series`;
    const historical = await seedBooking({ logged: `${prefix}-trip`, recurrenceId, isMultiDay });
    const unlogged = await seedBooking({ date: targetDate, recurrenceId, isMultiDay });
    const original = await prisma.booking.findUnique({ where: { id: historical.id }, include: { users: true } });
    const historicalParent = await prisma.dateCarBooking.findUnique({ where: { id: historical.parentId } });
    const response = operation === 'edit'
      ? await actor.post('/api/v1/bookings').send(editPayload(unlogged, { date: targetDate, recurrenceId }))
      : await creator.delete(`/api/v1/bookings/${unlogged.parentId}/${unlogged.id}`);
    expect(response.status).toBe(200);
    expect(await prisma.booking.findUnique({ where: { id: historical.id }, include: { users: true } })).toEqual(original);
    expect(await prisma.dateCarBooking.findUnique({ where: { id: historical.parentId } })).toEqual(historicalParent);
    expect(await prisma.booking.findUnique({ where: { id: unlogged.id } })).toEqual(
      operation === 'delete' ? null : expect.objectContaining({ comment: 'edited', recurrenceId }),
    );
    expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } }))
      .toEqual(expect.objectContaining({ id: recurrenceId, isMultiDay, ...legacyRange }));
    if (operation === 'edit') {
      expect(response.body.bookings).toEqual([expect.objectContaining({ recurrenceId, isMultiDay })]);
    }
  });

  it.each([
    { operation: 'edit', isMultiDay: false },
    { operation: 'delete', isMultiDay: false },
    { operation: 'edit', isMultiDay: true },
    { operation: 'delete', isMultiDay: true },
    { operation: 'edit', isMultiDay: null },
    { operation: 'delete', isMultiDay: null },
  ])('retains immutable metadata after $operation removes the last relation with kind $isMultiDay', async ({ operation, isMultiDay }) => {
    const recurrenceId = `${prefix}-retained-series`;
    const booking = await seedBooking({ recurrenceId, isMultiDay });
    const response = operation === 'edit'
      ? await actor.post('/api/v1/bookings').send(editPayload(booking, { recurrenceId: null }))
      : await creator.delete(`/api/v1/bookings/${booking.parentId}/${booking.id}`);
    expect(response.status).toBe(200);
    expect(await prisma.booking.count({ where: { recurrenceId } })).toBe(0);
    expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } }))
      .toEqual(expect.objectContaining({ id: recurrenceId, isMultiDay, ...legacyRange }));
    if (operation === 'edit') {
      expect(response.body.bookings[0]).not.toHaveProperty('isMultiDay');
      expect(response.body.bookings[0].recurrence).toBeNull();
    }
    if (isMultiDay === null) {
      const resolved = await actor.post('/api/v1/bookings').send(createPayload({ recurrenceId, isMultiDay: false }));
      expect(resolved.status).toBe(201);
      expect(resolved.body.bookings[0].recurrence).toEqual({
        id: recurrenceId, isMultiDay: false, ...legacyRange,
      });
      return;
    }
    const conflicting = await actor.post('/api/v1/bookings').send(createPayload({
      recurrenceId, isMultiDay: isMultiDay === true ? false : true,
    }));
    expect(conflicting.status).toBe(409);
    expect(await prisma.booking.count({ where: { recurrenceId } })).toBe(0);
    expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } }))
      .toEqual(expect.objectContaining({ id: recurrenceId, isMultiDay, ...legacyRange }));
    const rejoined = await actor.post('/api/v1/bookings').send(createPayload({ recurrenceId }));
    expect(rejoined.status).toBe(201);
    expect(rejoined.body.bookings).toEqual([expect.objectContaining({ recurrenceId, isMultiDay })]);
  });

  it('cannot detach or reassign the recurrence relation of a logged booking', async () => {
    const recurrenceId = `${prefix}-logged-series`;
    const booking = await seedBooking({ recurrenceId, isMultiDay: true, logged: `${prefix}-historical-trip` });
    const original = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { users: true } });
    const events = listen(ids.creator);
    for (const extra of [{}, { recurrenceId: `${prefix}-replacement-series`, isMultiDay: false, ...legacyRange }]) {
      const response = await actor.post('/api/v1/bookings').send(editPayload(booking, extra));
      expect(response.status).toBe(409);
      expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { users: true } })).toEqual(original);
      expect(await prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } }))
        .toEqual(expect.objectContaining({ id: recurrenceId, isMultiDay: true, ...legacyRange }));
      expect(await prisma.recurrence.findUnique({ where: { id: `${prefix}-replacement-series` } })).toBeNull();
      expect(events()).toEqual([]);
    }
  });

  it.each(['missing-parent', 'wrong-parent', 'missing-booking'] as const)('rejects %s edit IDs without accidentally creating a booking', async (kind) => {
    const booking = await seedBooking();
    const wrong = await seedBooking({ date: targetDate, carId: carIds[1] });
    const original = await prisma.booking.findUnique({ where: { id: booking.id }, include: { users: true } });
    const response = await actor.post('/api/v1/bookings').send(editPayload(booking, {
      date: '2001-01-17',
      destinationId: `${prefix}-invalid-ids-destination`,
      ...(kind === 'missing-parent' ? { existingParentId: undefined } : {}),
      ...(kind === 'wrong-parent' ? { existingParentId: wrong.parentId } : {}),
      ...(kind === 'missing-booking' ? { existingBookingId: `${prefix}-absent` } : {}),
    }));
    expect(response.status).toBe(kind === 'missing-parent' ? 400 : 404);
    expect(await prisma.booking.findUnique({ where: { id: booking.id }, include: { users: true } })).toEqual(original);
    expect(await prisma.booking.count({ where: { parent: { carId: { in: carIds } } } })).toBe(2);
    expect(await prisma.dateCarBooking.count({ where: { carId: { in: carIds } } })).toBe(2);
    expect(await prisma.destination.count({ where: { name: { startsWith: prefix } } })).toBe(0);
  });

  it('retains parent-only create compatibility for added recurrence dates', async () => {
    const booking = await seedBooking({ recurrenceId: `${prefix}-series` });
    const response = await actor.post('/api/v1/bookings').send({
      date: targetDate, carId: carIds[0], startTime: 480, endTime: 540,
      userIds: [ids.added], recurrenceId: `${prefix}-series`,
      existingParentId: booking.parentId,
    });
    expect(response.status).toBe(201);
    expect(response.body.id).not.toBe(booking.parentId);
    expect(await prisma.booking.count({ where: { recurrenceId: `${prefix}-series` } })).toBe(2);
  });

  it('rejects a mismatched deletion parent without modifying either container', async () => {
    const booking = await seedBooking();
    const wrong = await seedBooking({ date: targetDate, carId: carIds[1] });
    const parents = await prisma.dateCarBooking.findMany({
      where: { carId: { in: carIds } }, orderBy: { id: 'asc' },
    });
    const events = listen(ids.creator);
    const response = await creator.delete(`/api/v1/bookings/${wrong.parentId}/${booking.id}`);
    expect(response.status).toBe(404);
    expect(await prisma.booking.count({ where: { parent: { carId: { in: carIds } } } })).toBe(2);
    expect(await prisma.dateCarBooking.findMany({
      where: { carId: { in: carIds } }, orderBy: { id: 'asc' },
    })).toEqual(parents);
    expect(events()).toEqual([]);
  });

  it('moves an unlogged booking across date/car, touches both parents and publishes committed snapshots to affected users', async () => {
    const booking = await seedBooking();
    const sourceOther = await seedBooking({
      startTime: 720, endTime: 780, byUserId: ids.other, userIds: [ids.other],
    });
    const targetOther = await seedBooking({
      date: targetDate, carId: carIds[1], startTime: 720, endTime: 780,
      byUserId: ids.other, userIds: [ids.other],
    });
    const since = new Date('2000-01-01T00:00:00Z');
    await prisma.dateCarBooking.updateMany({
      where: { carId: { in: carIds } }, data: { updatedAt: since },
    });
    const listeners = Object.fromEntries(Object.entries(ids).map(([role, id]) => [role, listen(id)]));
    const response = await actor.post('/api/v1/bookings').send(editPayload(booking, {
      date: targetDate, carId: carIds[1],
    }));
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(targetOther.parentId);
    expect(await prisma.booking.findUnique({ where: { id: booking.id } })).toEqual(
      expect.objectContaining({ parentId: targetOther.parentId, byUserId: ids.creator }),
    );
    for (const role of ['actor', 'creator', 'removed', 'other']) {
      const events = listeners[role]();
      expect(events).toHaveLength(2);
      expect(events.map(event => event.data.id).sort()).toEqual([booking.parentId, targetOther.parentId].sort());
      for (const event of events) {
        expect(event.event).toBe('update');
        expect(new Date(event.data.updatedAt).getTime()).toBeGreaterThan(since.getTime());
        const persisted = await prisma.dateCarBooking.findUnique({
          where: { id: event.data.id }, include: { bookings: true },
        });
        expect(event.data.bookings.map((b: { id: string }) => b.id).sort())
          .toEqual(persisted!.bookings.map(b => b.id).sort());
      }
      expect(listeners.added()).toEqual([{ event: 'update', data: response.body }]);
    }
    expect(listeners.outsider()).toEqual([]);
    const sourceEvents = listeners.removed().find(event => event.data.id === booking.parentId)!;
    expect(sourceEvents.data.bookings.map((b: { id: string }) => b.id)).toEqual([sourceOther.id]);
    const delta = await actor.get('/api/v1/bookings').query({
      startDate: pastDate, endDate: targetDate, since: since.toISOString(),
    });
    expect(delta.body.bookings.filter((p: { car: { id: string } }) => carIds.includes(p.car.id))).toHaveLength(2);
  });

  it('rolls back a conflicting move, including a newly resolved destination', async () => {
    const booking = await seedBooking();
    await seedBooking({ date: targetDate, carId: carIds[1], startTime: 600, endTime: 660 });
    const original = await prisma.booking.findUnique({ where: { id: booking.id }, include: { users: true } });
    const response = await actor.post('/api/v1/bookings').send(editPayload(booking, {
      date: targetDate, carId: carIds[1], destinationId: `${prefix}-conflict-destination`,
    }));
    expect(response.status).toBe(409);
    expect(await prisma.booking.findUnique({ where: { id: booking.id }, include: { users: true } })).toEqual(original);
    expect(await prisma.destination.count({ where: { name: { startsWith: prefix } } })).toBe(0);
  });

  it('keeps deletion restricted to creator/admin and notifies actor, removed users and remaining container users', async () => {
    const booking = await seedBooking();
    const remaining = await seedBooking({
      startTime: 720, endTime: 780, byUserId: ids.other, userIds: [ids.other],
    });
    const listeners = Object.fromEntries(Object.entries(ids).map(([role, id]) => [role, listen(id)]));
    expect((await actor.delete(`/api/v1/bookings/${booking.parentId}/${booking.id}`)).status).toBe(403);
    expect(listeners.creator()).toEqual([]);
    const response = await admin.delete(`/api/v1/bookings/${booking.parentId}/${booking.id}`);
    expect(response.status).toBe(200);
    expect(response.body.bookings.map((b: { id: string }) => b.id)).toEqual([remaining.id]);
    for (const role of ['admin', 'creator', 'removed', 'other']) {
      expect(listeners[role]()).toEqual([{ event: 'update', data: response.body }]);
    }
    expect(listeners.actor()).toEqual([]);
    expect(listeners.outsider()).toEqual([]);
  });

  it('publishes an empty, touched parent after deleting the last booking', async () => {
    const booking = await seedBooking();
    const events = listen(ids.removed);
    const response = await creator.delete(`/api/v1/bookings/${booking.parentId}/${booking.id}`);
    expect(response.status).toBe(200);
    expect(response.body.bookings).toEqual([]);
    expect(events()).toEqual([{ event: 'update', data: response.body }]);
    expect((await prisma.dateCarBooking.findUnique({ where: { id: booking.parentId } }))!.updatedAt.toISOString())
      .toBe(response.body.updatedAt);
  });

  it.each(['edit', 'delete'] as const)('waits for the shared car lock before rejecting a concurrently logged %s', async (operation) => {
    const booking = await seedBooking();
    let acquired!: () => void;
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const logging = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Car" WHERE id = ${carIds[0]} FOR UPDATE`;
      acquired();
      await released;
      await tx.booking.update({ where: { id: booking.id }, data: { logged: `${prefix}-concurrent-trip` } });
    });
    await locked;
    let settled = false;
    const mutation = (operation === 'edit'
      ? actor.post('/api/v1/bookings').send(editPayload(booking))
      : creator.delete(`/api/v1/bookings/${booking.parentId}/${booking.id}`))
      .then(response => { settled = true; return response; });
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(settled).toBe(false);
    } finally {
      release();
      await logging;
    }
    expect((await mutation).status).toBe(409);
    expect(await prisma.booking.findUnique({ where: { id: booking.id } })).toEqual(
      expect.objectContaining({ logged: `${prefix}-concurrent-trip`, comment: 'original' }),
    );
  });
});
