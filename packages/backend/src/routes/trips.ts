import { Router, Request, Response } from 'express';
import type { Prisma } from '../generated/prisma/client';
import prisma from '../db/prisma';
import { requireAuth } from '../middleware/auth';
import { serializeTrip, serializeDateCarBooking } from '../lib/serializers';
import { subscribe, unsubscribe, sendEvent } from '../lib/sse';

const router = Router();
router.use(requireAuth);

const tripInclude = { users: true } as const;
const linkedBookingInclude = { parent: true, users: true } as const;
type BookingWithParentAndUsers = Prisma.BookingGetPayload<{ include: typeof linkedBookingInclude }>;
type UpdatedParent = { id: string; userIds: string[] };

const TRIPS_CHANNEL = 'trips';
const bookingChannel = (userId: string) => `bookings:${userId}`;

function isContiguousMultiDaySeries(bookings: BookingWithParentAndUsers[]) {
  if (bookings.length < 2) return false;

  const sorted = [...bookings].sort((a, b) => a.parent.date.localeCompare(b.parent.date));
  if (sorted[0].endTime !== 1440 || sorted[sorted.length - 1].startTime !== 0) return false;

  return sorted.every((booking, index) => {
    if (index === 0) return true;
    const previous = new Date(`${sorted[index - 1].parent.date}T00:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() + 1);
    return previous.toISOString().slice(0, 10) === booking.parent.date;
  });
}

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

  if (!carId || !Array.isArray(userIds) || userIds.length === 0) {
    res.status(400).json({ error: 'Obligatoriska fält saknas: carId, userIds' });
    return;
  }
  if (typeof odo !== 'number' || typeof distance !== 'number' || typeof cost !== 'number') {
    res.status(400).json({ error: 'odo, distance och cost måste vara tal' });
    return;
  }
  if (odo <= 0 || distance <= 0) {
    res.status(400).json({ error: 'odo och distance måste vara positiva' });
    return;
  }

  let trip;
  let updatedParents: UpdatedParent[] = [];
  try {
    trip = await prisma.$transaction(async (tx) => {
      const car = await tx.car.findUnique({ where: { id: carId }, select: { hasLog: true } });
      if (!car) throw Object.assign(new Error('Fordonet hittades inte'), { httpStatus: 404 });
      if (!car.hasLog) throw Object.assign(new Error('Fordonet saknar körjournal'), { httpStatus: 400 });

      let bookingToLog: BookingWithParentAndUsers | null = null;
      if (bookingId || parentId) {
        if (!bookingId || !parentId) {
          throw Object.assign(new Error('bookingId och parentId måste anges tillsammans'), { httpStatus: 400 });
        }
        bookingToLog = await tx.booking.findUnique({ where: { id: bookingId }, include: linkedBookingInclude });
        if (!bookingToLog || bookingToLog.parentId !== parentId || bookingToLog.parent.carId !== carId) {
          throw Object.assign(new Error('Bokningen hör inte till angivet fordon och datum'), { httpStatus: 400 });
        }
        if (bookingToLog.logged) throw Object.assign(new Error('Bokningen är redan loggad'), { httpStatus: 409 });
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

      if (bookingToLog) {
        let bookingsToLog = [bookingToLog];
        if (bookingToLog.recurrenceId) {
          const recurrenceBookings = await tx.booking.findMany({
            where: { recurrenceId: bookingToLog.recurrenceId, parent: { carId } },
            include: linkedBookingInclude,
          });
          if (isContiguousMultiDaySeries(recurrenceBookings)) bookingsToLog = recurrenceBookings;
        }
        await tx.booking.updateMany({
          where: { id: { in: bookingsToLog.map(booking => booking.id) }, logged: null },
          data: { logged: created.id },
        });
        updatedParents = [...new Map(bookingsToLog.map(booking => [booking.parentId, {
          id: booking.parentId,
          userIds: booking.users.map(user => user.userId),
        }])).values()];
      }

      return created;
    });
  } catch (err: unknown) {
    const e = err as Error & { httpStatus?: number };
    if (e.httpStatus) {
      res.status(e.httpStatus).json({ error: e.message });
      return;
    }
    throw err;
  }

  const serialized = serializeTrip(trip);
  sendEvent(TRIPS_CHANNEL, 'add', serialized);

  for (const updatedParent of updatedParents) {
    const dcb = await prisma.dateCarBooking.findUnique({
      where: { id: updatedParent.id }, include: { bookings: { include: { users: true } } },
    });
    if (!dcb) continue;
    const affectedUserIds = new Set([byUserId, ...updatedParent.userIds]);
    for (const uid of affectedUserIds) sendEvent(bookingChannel(uid), 'update', serializeDateCarBooking(dcb));
  }

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
