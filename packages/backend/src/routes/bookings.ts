import { Router, Request, Response } from 'express';
import { addDays, format, startOfDay } from 'date-fns';
import prisma from '../db/prisma';
import { requireAuth } from '../middleware/auth';
import { serializeDateCarBooking } from '../lib/serializers';
import { subscribe, unsubscribe, sendEvent } from '../lib/sse';

const router = Router();
router.use(requireAuth);

// SSE channel name for a date range
const bookingChannel = (userId: string) => `bookings:${userId}`;

// ---- helpers ----

const dcbInclude = {
  bookings: {
    include: { users: true },
  },
} as const;

// Calculates the same window as the frontend hook:
// 15 days of history + ~3 months forward
function defaultDateRange() {
  const pastDays = 15;
  const totalDays = 14 * 8; // 8 pages × 14 days
  const start = addDays(startOfDay(new Date()), -pastDays);
  return {
    startDate: format(start, 'yyyy-MM-dd'),
    endDate: format(addDays(start, totalDays), 'yyyy-MM-dd'),
  };
}

// ---- GET /api/v1/bookings  (initial load) ----
router.get('/', async (req: Request, res: Response) => {
  const { startDate, endDate } = {
    ...defaultDateRange(),
    ...(req.query.startDate ? { startDate: req.query.startDate as string } : {}),
    ...(req.query.endDate ? { endDate: req.query.endDate as string } : {}),
  };

  const dcbs = await prisma.dateCarBooking.findMany({
    where: { date: { gte: startDate, lte: endDate } },
    include: dcbInclude,
    orderBy: { date: 'asc' },
  });

  res.json({
    startDate,
    endDate,
    bookings: dcbs.map(serializeDateCarBooking),
  });
});

// ---- GET /api/v1/bookings/stream  (SSE) ----
router.get('/stream', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const channel = bookingChannel(userId);
  const client = subscribe(channel, res);

  req.on('close', () => unsubscribe(client));
});

// Hjälpfunktion: tom sträng behandlas som null (skyddas mot FK-violation)
function emptyToNull(v: string | undefined | null): string | null {
  if (v == null || v === '') return null;
  return v;
}

// ---- POST /api/v1/bookings  (create or update booking) ----
router.post('/', async (req: Request, res: Response) => {
  const {
    date,
    carId,
    startTime,
    endTime,
    distance = 0,
    destinationId,
    comment,
    recurrenceId,
    userIds,
    existingBookingId,
    existingParentId,
  } = req.body as {
    date: string;
    carId: string;
    startTime: number;
    endTime: number;
    distance?: number;
    destinationId?: string;
    comment?: string;
    recurrenceId?: string;
    userIds: string[];
    existingBookingId?: string;
    existingParentId?: string;
  };

  const byUserId = req.user!.id;

  // Validera destinationId om det är angivet — returnera 400 istället för att
  // låta Prisma kasta P2003 FK-violation (som annars ger 500/502).
  const resolvedDestinationId = emptyToNull(destinationId);
  if (resolvedDestinationId !== null) {
    const destExists = await prisma.destination.findUnique({ where: { id: resolvedDestinationId }, select: { id: true } });
    if (!destExists) {
      res.status(400).json({ error: `Destination '${resolvedDestinationId}' finns inte` });
      return;
    }
  }

  const dcb = await prisma.$transaction(async (tx) => {
    // Find or create the DateCarBooking container
    let parent = await tx.dateCarBooking.findUnique({
      where: { date_carId: { date, carId } },
      include: dcbInclude,
    });

    if (!parent) {
      parent = await tx.dateCarBooking.create({
        data: { date, carId },
        include: dcbInclude,
      });
    }

    if (existingBookingId && existingParentId) {
      // UPDATE existing booking
      await tx.bookingUser.deleteMany({ where: { bookingId: existingBookingId } });
      await tx.booking.update({
        where: { id: existingBookingId },
        data: {
          startTime,
          endTime,
          distance,
          destinationId: resolvedDestinationId,
          comment: emptyToNull(comment),
          recurrenceId: emptyToNull(recurrenceId),
          users: { create: userIds.map(uid => ({ userId: uid })) },
        },
      });
    } else {
      // CREATE new booking
      await tx.booking.create({
        data: {
          parentId: parent.id,
          startTime,
          endTime,
          distance,
          destinationId: resolvedDestinationId,
          comment: emptyToNull(comment),
          recurrenceId: emptyToNull(recurrenceId),
          byUserId,
          users: { create: userIds.map(uid => ({ userId: uid })) },
        },
      });
    }

    // Re-fetch the full parent with all bookings
    return tx.dateCarBooking.findUniqueOrThrow({
      where: { id: parent.id },
      include: dcbInclude,
    });
  });

  const serialized = serializeDateCarBooking(dcb);

  // Broadcast to all subscribers of the users involved
  const affectedUserIds = new Set([
    byUserId,
    ...req.body.userIds as string[],
  ]);
  for (const uid of affectedUserIds) {
    sendEvent(bookingChannel(uid), existingBookingId ? 'update' : 'add', serialized);
  }

  res.status(existingBookingId ? 200 : 201).json(serialized);
});

// ---- DELETE /api/v1/bookings/:parentId/:bookingId ----
router.delete('/:parentId/:bookingId', async (req: Request, res: Response) => {
  const { parentId, bookingId } = req.params;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { users: true },
  });

  if (!booking || booking.parentId !== parentId) {
    res.status(404).json({ error: 'Bokning hittades inte' });
    return;
  }

  // Only the creator or an admin may delete
  if (booking.byUserId !== req.user!.id && !req.user!.isAdmin) {
    res.status(403).json({ error: 'Åtkomst nekad' });
    return;
  }

  await prisma.booking.delete({ where: { id: bookingId } });

  // Fetch the updated parent (may now be empty)
  const parent = await prisma.dateCarBooking.findUnique({
    where: { id: parentId },
    include: dcbInclude,
  });

  const affectedUserIds = new Set([
    booking.byUserId,
    ...booking.users.map(u => u.userId),
  ]);

  if (parent) {
    const serialized = serializeDateCarBooking(parent);
    for (const uid of affectedUserIds) {
      sendEvent(bookingChannel(uid), 'update', serialized);
    }
    res.json(serialized);
  } else {
    // Parent removed (no more bookings on that date/car)
    const ghost = { id: parentId };
    for (const uid of affectedUserIds) {
      sendEvent(bookingChannel(uid), 'remove', ghost);
    }
    res.json(ghost);
  }
});

export default router;
