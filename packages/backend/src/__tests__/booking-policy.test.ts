import express from 'express';
import request from 'supertest';
import { format } from 'date-fns';
import { allowsPastBookings, canBookDate } from '../lib/booking-policy';

jest.mock('../db/prisma', () => ({
  __esModule: true,
  default: { $transaction: jest.fn() },
}));
jest.mock('../lib/booking-events', () => ({
  bookingInclude: {},
  touchBookingParents: jest.fn(),
  publishBookingParent: jest.fn(),
}));

import prisma from '../db/prisma';
import bookings from '../routes/bookings';
import general from '../routes/general';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 'tester', email: 'tester@example.com', isAdmin: false };
  next();
});
app.use('/bookings', bookings);
app.use('/', general);

const parent = {
  id: 'parent', date: '2001-01-15', carId: 'car', bookings: [], updatedAt: new Date(),
};
const existing = {
  id: 'booking', parentId: parent.id, parent, users: [], byUserId: 'tester', logged: null,
};
const tx = {
  $queryRaw: jest.fn(),
  dateCarBooking: { findUnique: jest.fn(), findMany: jest.fn() },
  booking: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  bookingUser: { deleteMany: jest.fn() },
};
const payload = {
  date: parent.date, carId: parent.carId, startTime: 480, endTime: 540, userIds: ['tester'],
};

beforeEach(() => {
  jest.replaceProperty(process, 'env', {
    ...process.env, NODE_ENV: 'development', ALLOW_PAST_BOOKINGS: 'false',
  });
  jest.clearAllMocks();
  tx.$queryRaw.mockResolvedValue([{ id: 'car' }]);
  tx.dateCarBooking.findUnique.mockResolvedValue(parent);
  tx.dateCarBooking.findMany.mockResolvedValue([parent]);
  tx.booking.findUnique.mockResolvedValue(existing);
  jest.mocked(prisma.$transaction).mockImplementation(async callback => {
    if (typeof callback !== 'function') throw new Error('Expected interactive transaction');
    return callback(tx as unknown as Parameters<typeof callback>[0]);
  });
});

afterEach(() => jest.restoreAllMocks());

it.each([
  ['development', undefined, false],
  ['development', 'false', false],
  ['development', 'TRUE', false],
  ['development', '1', false],
  ['development', 'true', true],
  ['production', 'true', false],
  ['test', 'true', false],
  [undefined, 'true', false],
])('gates runtime config and POST with NODE_ENV=%s and flag=%s', async (environment, flag, allowed) => {
  process.env.NODE_ENV = environment;
  if (environment === undefined) delete process.env.NODE_ENV;
  if (flag === undefined) delete process.env.ALLOW_PAST_BOOKINGS;
  else process.env.ALLOW_PAST_BOOKINGS = flag;
  expect(allowsPastBookings()).toBe(allowed);

  const config = await request(app).get('/config');
  expect(config.body).toEqual({ allowPastBookings: allowed });
  expect(config.headers['cache-control']).toBe('no-store');
  const response = await request(app).post('/bookings').send(payload);
  expect(response.status).toBe(allowed ? 201 : 400);
  expect(tx.booking.create).toHaveBeenCalledTimes(allowed ? 1 : 0);
  if (!allowed) expect(prisma.$transaction).not.toHaveBeenCalled();
});

it.each([format(new Date(), 'yyyy-MM-dd'), '2099-01-15'])('accepts %s without enabling test mode', async date => {
  expect(canBookDate(date)).toBe(true);
  expect(canBookDate('2001-01-15')).toBe(false);
  const response = await request(app).post('/bookings').send({ ...payload, date });
  expect(response.status).toBe(201);
  expect(tx.booking.create).toHaveBeenCalledTimes(1);
});

it('ignores client-supplied test mode flags', async () => {
  process.env.NODE_ENV = 'production';
  const response = await request(app).post('/bookings').send({ ...payload, allowPastBookings: true });
  expect(response.status).toBe(400);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

it.each([false, true])('also rejects historical series when isMultiDay=%s without test mode', async isMultiDay => {
  const response = await request(app).post('/bookings').send({
    ...payload, recurrenceId: 'series', isMultiDay,
    recurringStartDate: parent.date, recurringEndDate: '2001-01-17', recurringDays: [0, 1, 2],
  });
  expect(response.status).toBe(400);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

it('preserves edits on the original historical date', async () => {
  const response = await request(app).post('/bookings').send({
    ...payload, existingBookingId: existing.id, existingParentId: parent.id,
  });
  expect(response.status).toBe(200);
  expect(tx.booking.update).toHaveBeenCalledTimes(1);
});

it('rejects moving an existing booking to a different historical date', async () => {
  const response = await request(app).post('/bookings').send({
    ...payload, date: '2001-01-16', existingBookingId: existing.id, existingParentId: parent.id,
  });
  expect(response.status).toBe(400);
  expect(tx.booking.update).not.toHaveBeenCalled();
});

it('keeps logged bookings read-only even in development test mode', async () => {
  process.env.ALLOW_PAST_BOOKINGS = 'true';
  tx.booking.findUnique.mockResolvedValue({ ...existing, logged: 'trip' });
  const response = await request(app).post('/bookings').send({
    ...payload, existingBookingId: existing.id, existingParentId: parent.id,
  });
  expect(response.status).toBe(409);
  expect(tx.booking.update).not.toHaveBeenCalled();
});

it('rejects invalid calendar dates even in development test mode', async () => {
  process.env.ALLOW_PAST_BOOKINGS = 'true';
  const response = await request(app).post('/bookings').send({ ...payload, date: '2001-02-30' });
  expect(response.status).toBe(400);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
