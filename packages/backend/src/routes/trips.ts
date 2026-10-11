import { Router, Request, Response } from 'express';
import type { Prisma } from '../generated/prisma/client';
import prisma from '../db/prisma';
import { requireAuth } from '../middleware/auth';
import { serializeTrip } from '../lib/serializers';
import { subscribe, unsubscribe, sendEvent } from '../lib/sse';
import { bookingInclude, touchBookingParents, publishBookingParent } from '../lib/booking-events';
import { lockRecurrences } from '../lib/recurrence';

const router = Router();
router.use(requireAuth);

const tripInclude = { users: true } as const;
const linkedBookingInclude = { parent: true, users: true, recurrence: true } as const;
type BookingWithParentAndUsers = Prisma.BookingGetPayload<{ include: typeof linkedBookingInclude }>;

const TRIPS_CHANNEL = 'trips';

router.get('/', async (req: Request, res: Response) => {
  const { since: sinceParam } = req.query as { since?: string };
  let since: Date;

  if (sinceParam) {
    const parsed = new Date(sinceParam);
    if (isNaN(parsed.getTime())) {
      res.status(400).json({ error: 'Ogiltigt since-format. Förväntar ISO 8601.' });
      return;
    }
    since = parsed;
  } else {
    since = new Date();
    since.setDate(since.getDate() - 30);
  }

  const trips = await prisma.trip.findMany({
    where: { timestamp: { gt: since } },
    include: tripInclude,
    orderBy: { odo: 'desc' },
  });
  res.json(trips.map(serializeTrip));
});

router.get('/stream', (req: Request, res: Response) => {
  const client = subscribe(TRIPS_CHANNEL, res);
  req.on('close', () => unsubscribe(client));
});

router.post('/', async (req: Request, res: Response) => {
  const { carId, odo, distance, cost, comment, userIds, bookingId, parentId } = req.body as {
    carId: string; odo: number; distance: number; cost: number; comment?: string;
    userIds: string[]; bookingId?: string; parentId?: string;
  };
  const byUserId = req.user!.id;

  if (typeof carId !== 'string' || !carId || !Array.isArray(userIds) || userIds.length === 0
    || userIds.some(id => typeof id !== 'string' || !id) || new Set(userIds).size !== userIds.length) {
    res.status(400).json({ error: 'Obligatoriska fält saknas: carId, userIds' });
    return;
  }
  if (!Number.isSafeInteger(odo) || !Number.isSafeInteger(distance) || !Number.isFinite(cost)) {
    res.status(400).json({ error: 'odo, distance och cost måste vara tal' });
    return;
  }
  if (odo <= 0 || distance <= 0) {
    res.status(400).json({ error: 'odo och distance måste vara positiva' });
    return;
  }
  if ((bookingId !== undefined && (typeof bookingId !== 'string' || !bookingId))
    || (parentId !== undefined && (typeof parentId !== 'string' || !parentId || !bookingId))) {
    res.status(400).json({ error: 'Ogiltigt bookingId eller parentId' });
    return;
  }
  if (comment !== undefined && typeof comment !== 'string') {
    res.status(400).json({ error: 'comment måste vara text' });
    return;
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      // Booking edits/deletes use the same lock, so validation stays valid until commit.
      await tx.$queryRaw`SELECT id FROM "Car" WHERE id = ${carId} FOR UPDATE`;
      const car = await tx.car.findUnique({ where: { id: carId }, select: { hasLog: true } });
      if (!car) throw Object.assign(new Error('Fordonet hittades inte'), { httpStatus: 404 });
      if (!car.hasLog) throw Object.assign(new Error('Fordonet saknar körjournal'), { httpStatus: 400 });

      let bookingToLog: BookingWithParentAndUsers | null = null;
      if (bookingId) {
        bookingToLog = await tx.booking.findUnique({ where: { id: bookingId }, include: linkedBookingInclude });
        if (!bookingToLog || (parentId !== undefined && bookingToLog.parentId !== parentId)
          || bookingToLog.parent.carId !== carId) {
          throw Object.assign(new Error('Bokningen hör inte till angivet fordon och datum'), { httpStatus: 400 });
        }
        if (bookingToLog.logged) throw Object.assign(new Error('Bokningen är redan loggad'), { httpStatus: 409 });
      }

      let bookingsToLog = bookingToLog ? [bookingToLog] : [];
      if (bookingToLog && bookingToLog.recurrenceId !== null) {
        await lockRecurrences(tx, [bookingToLog.recurrenceId]);
        const recurrence = await tx.recurrence.findUniqueOrThrow({
          where: { id: bookingToLog.recurrenceId },
        });
        if (recurrence.isMultiDay === null) {
          throw Object.assign(new Error('Bokningsseriens typ är okänd och måste fastställas före loggning'), { httpStatus: 409 });
        }
        const recurrenceBookings = await tx.booking.findMany({
          where: { recurrenceId: bookingToLog.recurrenceId },
          include: linkedBookingInclude,
        });
        if (recurrenceBookings.some(booking => booking.parent.carId !== carId)) {
          throw Object.assign(new Error('Bokningsserien omfattar flera fordon'), { httpStatus: 409 });
        }
        if (recurrence.isMultiDay) bookingsToLog = recurrenceBookings;
      }
      if (bookingsToLog.some(booking => booking.logged)) {
        throw Object.assign(new Error('Bokningen är redan loggad'), { httpStatus: 409 });
      }
      const users = await tx.user.count({ where: { id: { in: userIds } } });
      if (users !== userIds.length) {
        throw Object.assign(new Error('Användare hittades inte'), { httpStatus: 400 });
      }

      const latestTrip = await tx.trip.findFirst({
        where: { carId }, orderBy: { odo: 'desc' }, select: { odo: true },
      });
      if (latestTrip && odo <= latestTrip.odo) {
        throw Object.assign(
          new Error(`Nytt odo-värde (${odo}) måste vara högre än senast registrerade (${latestTrip.odo})`),
          { httpStatus: 409 },
        );
      }

      const created = await tx.trip.create({
        data: {
          carId, odo, distance, cost, comment: comment ?? null, byUserId,
          users: { create: userIds.map(uid => ({ userId: uid })) },
        },
        include: tripInclude,
      });

      const parentIds = [...new Set(bookingsToLog.map(booking => booking.parentId))];
      if (bookingsToLog.length) {
        const updated = await tx.booking.updateMany({
          where: { id: { in: bookingsToLog.map(booking => booking.id) }, logged: null },
          data: { logged: created.id },
        });
        if (updated.count !== bookingsToLog.length) {
          throw Object.assign(new Error('Bokningen är redan loggad'), { httpStatus: 409 });
        }
        await touchBookingParents(tx, parentIds);
      }

      const parents = await tx.dateCarBooking.findMany({
        where: { id: { in: parentIds } }, include: bookingInclude,
      });
      return { trip: created, parents };
    });
  } catch (err: unknown) {
    const e = err as Error & { httpStatus?: number };
    if (e.httpStatus) {
      res.status(e.httpStatus).json({ error: e.message });
      return;
    }
    throw err;
  }

  const serialized = serializeTrip(result.trip);
  sendEvent(TRIPS_CHANNEL, 'add', serialized);

  for (const parent of result.parents) publishBookingParent(parent, 'update', [byUserId, ...userIds]);

  res.status(201).json(serialized);
});

router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { odo, distance, cost, comment, userIds } = req.body as {
    odo: number; distance: number; cost: number; comment?: string; userIds: string[];
  };
  const existing = await prisma.trip.findUnique({ where: { id } });
  if (!existing) { res.status(404).json({ error: 'Resa hittades inte' }); return; }
  if (existing.byUserId !== req.user!.id && !req.user!.isAdmin) {
    res.status(403).json({ error: 'Åtkomst nekad' }); return;
  }

  const trip = await prisma.$transaction(async (tx) => {
    await tx.tripUser.deleteMany({ where: { tripId: id } });
    return tx.trip.update({
      where: { id },
      data: { odo, distance, cost, comment: comment ?? null, users: { create: userIds.map(uid => ({ userId: uid })) } },
      include: tripInclude,
    });
  });
  const serialized = serializeTrip(trip);
  sendEvent(TRIPS_CHANNEL, 'update', serialized);
  res.json(serialized);
});

router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const existing = await prisma.trip.findUnique({ where: { id } });
  if (!existing) { res.status(404).json({ error: 'Resa hittades inte' }); return; }
  if (existing.byUserId !== req.user!.id && !req.user!.isAdmin) {
    res.status(403).json({ error: 'Åtkomst nekad' }); return;
  }
  await prisma.trip.delete({ where: { id } });
  sendEvent(TRIPS_CHANNEL, 'remove', { id });
  res.json({ id });
});

export default router;
