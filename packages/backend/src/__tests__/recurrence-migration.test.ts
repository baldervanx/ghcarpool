import { randomUUID } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { Client } from 'pg';
import prisma from '../db/prisma';
import { assertBookingTestDatabase } from './booking-test-database';
import { restoreLegacyRecurrence, inferLegacyRecurrenceMetadata } from '../lib/recurrence';
import { serializeDateCarBooking } from '../lib/serializers';
import { bookingInclude } from '../lib/booking-events';

const migrations = path.resolve(__dirname, '../../prisma/migrations');
const migrationName = '20260914000000_restore_recurrence';
const migrationSql = readFileSync(path.join(migrations, migrationName, 'migration.sql'), 'utf8');
const schema = `recurrence_migration_${randomUUID().replace(/-/g, '')}`;
const client = new Client({ connectionString: process.env.DATABASE_URL });
const prefix = `recurrence-import-${randomUUID()}`;

beforeAll(async () => {
  await assertBookingTestDatabase();
  await client.connect();
});

afterAll(async () => {
  await client.end();
  await prisma.dateCarBooking.deleteMany({ where: { carId: `${prefix}-car` } });
  await prisma.car.deleteMany({ where: { id: `${prefix}-car` } });
  await prisma.user.deleteMany({ where: { id: `${prefix}-user` } });
  await prisma.recurrence.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.$disconnect();
});

describe('non-destructive legacy recurrence backfill', () => {
  beforeEach(async () => {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    for (const name of readdirSync(migrations).filter(name => name < migrationName && /^\d/.test(name)).sort()) {
      await client.query(readFileSync(path.join(migrations, name, 'migration.sql'), 'utf8'));
    }
    await client.query(`INSERT INTO "User" (id, email) VALUES ('legacy-user', 'legacy@test.com')`);
    await client.query(`INSERT INTO "Car" (id, name) VALUES ('car-a', 'Car A'), ('car-b', 'Car B')`);
  });

  afterEach(async () => {
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  });

  it('preserves bookings, logged history and users; classifies clear series and retains ambiguous/invalid kinds as null', async () => {
    type Entry = { date: string; start: number; end: number; car?: string };
    const day = (date: string, start = 480, end = 600, car = 'car-a'): Entry => ({ date, start, end, car });
    const fixtures: { id: string | null; expected?: boolean | null; days?: number[]; entries: Entry[] }[] = [
      { id: 'normal', expected: false, days: [0, 1], entries: [day('2001-01-15'), day('2001-01-16'), day('2001-01-22')] },
      { id: 'varying-normal', expected: false, days: [3, 4], entries: [day('2001-02-01'), day('2001-02-02', 600, 720)] },
      { id: 'single-normal', expected: false, days: [5], entries: [day('2001-02-03')] },
      { id: 'midnight-normal', expected: false, days: [0, 6], entries: [day('2001-02-04', 0, 600), day('2001-02-05', 0, 600)] },
      { id: 'multi-two', expected: true, days: [3, 4], entries: [day('2001-03-01', 480, 1440), day('2001-03-02', 0, 600)] },
      { id: 'multi-three', expected: true, days: [0, 1, 2], entries: [
        day('2000-02-28', 480, 1440), day('2000-02-29', 0, 1440), day('2000-03-01', 0, 600),
      ] },
      { id: 'full-day-ambiguous', expected: null, days: [0, 6], entries: [day('2001-04-01', 0, 1440), day('2001-04-02', 0, 1440)] },
      { id: 'single-fragment', expected: null, days: [1], entries: [day('2001-04-03', 480, 1440)] },
      { id: 'gapped-fragments', expected: null, days: [2, 4], entries: [day('2001-04-04', 480, 1440), day('2001-04-06', 0, 600)] },
      { id: 'invalid-middle', expected: null, days: [1, 2, 3], entries: [
        day('2001-05-01', 480, 1440), day('2001-05-02'), day('2001-05-03', 0, 600),
      ] },
      { id: 'mixed-cars', expected: null, days: [4, 5], entries: [day('2001-06-01'), day('2001-06-02', 480, 600, 'car-b')] },
      { id: 'duplicate-day', expected: null, days: [6], entries: [day('2001-07-01'), day('2001-07-01', 720, 780)] },
      { id: 'invalid-date', expected: null, days: [], entries: [day('2001-02-31'), day('not-a-date')] },
      { id: 'invalid-month', expected: null, days: [], entries: [day('2001-13-01')] },
      { id: 'invalid-year', expected: null, days: [], entries: [day('0000-01-01')] },
      { id: 'mixed-valid-invalid-date', expected: null, days: [0], entries: [day('2001-01-15'), day('2001-02-31')] },
      { id: 'invalid-time', expected: null, days: [2], entries: [day('2001-08-01', -10, 1500)] },
      { id: '', expected: null, days: [3], entries: [day('2001-08-02')] },
      { id: null, entries: [day('2001-09-01')] },
    ];
    let index = 0;
    for (const fixture of fixtures) {
      for (const entry of fixture.entries) {
        const parentId = `parent-${entry.car}-${entry.date}`;
        await client.query(
          `INSERT INTO "DateCarBooking" (id,date,"carId","updatedAt") VALUES ($1,$2,$3,'2000-01-01')
           ON CONFLICT (id) DO NOTHING`,
          [parentId, entry.date, entry.car],
        );
        const bookingId = `booking-${index++}`;
        await client.query(
          `INSERT INTO "Booking" (id,"parentId","startTime","endTime","recurrenceId",logged,"byUserId",comment)
           VALUES ($1,$2,$3,$4,$5,$6,'legacy-user','historical comment')`,
          [bookingId, parentId, entry.start, entry.end, fixture.id, index % 2 === 0 ? 'historical-trip' : null],
        );
        await client.query(`INSERT INTO "BookingUser" ("bookingId","userId") VALUES ($1,'legacy-user')`, [bookingId]);
      }
    }
    const originalBookings = (await client.query(`SELECT * FROM "Booking" ORDER BY id`)).rows;
    const originalUsers = (await client.query(`SELECT * FROM "BookingUser" ORDER BY "bookingId"`)).rows;
    const originalNonRecurringParent = (await client.query(`SELECT * FROM "DateCarBooking" WHERE date='2001-09-01'`)).rows[0];
    await client.query(migrationSql);
    expect((await client.query(`SELECT * FROM "Booking" ORDER BY id`)).rows).toEqual(originalBookings);
    expect((await client.query(`SELECT * FROM "BookingUser" ORDER BY "bookingId"`)).rows).toEqual(originalUsers);
    const recurrenceRows = (await client.query(`SELECT * FROM "Recurrence" ORDER BY id`)).rows;
    expect(recurrenceRows).toEqual(fixtures.filter(f => f.id !== null)
      .sort((a, b) => a.id!.localeCompare(b.id!))
      .map(f => expect.objectContaining({
        id: f.id, isMultiDay: f.expected,
        recurringStartDate: f.entries.map(entry => entry.date).sort()[0],
        recurringEndDate: f.entries.map(entry => entry.date).sort().slice(-1)[0],
        recurringDays: f.days, createdAt: expect.any(Date), updatedAt: expect.any(Date),
      })));
    for (const fixture of fixtures.filter(f => !!f.id)) {
      expect(inferLegacyRecurrenceMetadata(fixture.entries.map(entry => ({
        date: entry.date, carId: entry.car!, startTime: entry.start, endTime: entry.end,
      })))).toEqual({
        isMultiDay: fixture.expected,
        recurringStartDate: fixture.entries.map(entry => entry.date).sort()[0],
        recurringEndDate: fixture.entries.map(entry => entry.date).sort().slice(-1)[0],
        recurringDays: fixture.days,
      });
    }
    expect((await client.query(
      `SELECT COUNT(*)::INTEGER AS count FROM "DateCarBooking" p
       WHERE "updatedAt" > '2000-01-01' AND EXISTS
       (SELECT 1 FROM "Booking" b WHERE b."parentId"=p.id AND b."recurrenceId" IS NOT NULL)`,
    )).rows[0].count).toBe(new Set(fixtures.filter(f => f.id !== null)
      .flatMap(f => f.entries.map(entry => `parent-${entry.car}-${entry.date}`))).size);
    expect((await client.query(`SELECT * FROM "DateCarBooking" WHERE date='2001-09-01'`)).rows[0])
      .toEqual(originalNonRecurringParent);
    await expect(client.query(`DELETE FROM "Recurrence" WHERE id='normal'`)).rejects.toMatchObject({ code: '23503' });
    await expect(client.query(`UPDATE "Booking" SET "recurrenceId"='missing' WHERE id='booking-0'`))
      .rejects.toMatchObject({ code: '23503' });
  });

  it('migrates an empty database without manufacturing series metadata', async () => {
    await client.query(migrationSql);
    expect((await client.query(`SELECT COUNT(*)::INTEGER AS count FROM "Recurrence"`)).rows[0].count).toBe(0);
  });
});

describe('authoritative Firebase/seed recurrence metadata restoration', () => {
  it('restores original explicit metadata, resolves only legacy nulls, and never overwrites a known conflicting kind', async () => {
    const id = `${prefix}-series`;
    const initial = {
      isMultiDay: null, recurringStartDate: '2001-01-01', recurringEndDate: '2001-12-31',
      recurringDays: [0, 1, 2, 3, 4, 5, 6],
      createdAt: new Date('1999-01-01T01:02:03Z'), updatedAt: new Date('2000-01-01T04:05:06Z'),
    };
    expect(await prisma.$transaction(tx => restoreLegacyRecurrence(tx, id, initial)))
      .toEqual({ id, ...initial });
    await prisma.user.create({ data: { id: `${prefix}-user`, email: `${prefix}@test.com` } });
    await prisma.car.create({ data: { id: `${prefix}-car`, name: 'Legacy source car' } });
    const parent = await prisma.dateCarBooking.create({
      data: { date: '2001-01-15', carId: `${prefix}-car`, updatedAt: new Date('2000-01-01T00:00:00Z') },
    });
    const booking = await prisma.booking.create({
      data: {
        parentId: parent.id, recurrenceId: id, startTime: 480, endTime: 1440,
        byUserId: `${prefix}-user`, logged: `${prefix}-historical-trip`,
        users: { create: { userId: `${prefix}-user` } },
      },
      include: { users: true },
    });
    const source = {
      isMultiDay: true, recurringStartDate: '1998-01-01', recurringEndDate: '1999-12-31',
      recurringDays: [0, 4], createdAt: new Date('1997-01-01T01:02:03Z'),
      updatedAt: new Date('1999-12-31T04:05:06Z'),
    };
    expect(await prisma.$transaction(tx => restoreLegacyRecurrence(tx, id, source))).toEqual({ id, ...source });
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { users: true } })).toEqual(booking);
    const restoredParent = await prisma.dateCarBooking.findUniqueOrThrow({
      where: { id: parent.id }, include: bookingInclude,
    });
    expect(restoredParent.updatedAt.getTime()).toBeGreaterThan(parent.updatedAt.getTime());
    expect(serializeDateCarBooking(restoredParent).bookings[0].isMultiDay).toBe(true);
    expect(serializeDateCarBooking(restoredParent).bookings[0].recurrence).toEqual({
      id, isMultiDay: true, recurringStartDate: source.recurringStartDate,
      recurringEndDate: source.recurringEndDate, recurringDays: source.recurringDays,
    });
    expect(await prisma.$transaction(tx => restoreLegacyRecurrence(tx, id, { ...source, isMultiDay: null })))
      .toEqual({ id, ...source });
    expect(await prisma.$transaction(tx => restoreLegacyRecurrence(tx, id, source))).toEqual({ id, ...source });
    await expect(prisma.$transaction(tx => restoreLegacyRecurrence(tx, id, { ...source, isMultiDay: false })))
      .rejects.toThrow(/conflicts/);
    expect(await prisma.recurrence.findUniqueOrThrow({ where: { id } })).toEqual({ id, ...source });
    expect(await prisma.dateCarBooking.findUniqueOrThrow({ where: { id: parent.id }, include: bookingInclude }))
      .toEqual(restoredParent);
  });
});
