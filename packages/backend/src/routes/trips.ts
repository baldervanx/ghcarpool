import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { requireAuth } from '../middleware/auth';
import { serializeTrip } from '../lib/serializers';
import { subscribe, unsubscribe, sendEvent } from '../lib/sse';

const router = Router();
router.use(requireAuth);

const tripInclude = { users: true } as const;

// SSE channel — trips are global (everyone sees the same log)
const TRIPS_CHANNEL = 'trips';

// ---- GET /api/v1/trips  (initial load, last 30 days) ----
router.get('/', async (_req: Request, res: Response) => {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const trips = await prisma.trip.findMany({
    where: { timestamp: { gte: since } },
    include: tripInclude,
    orderBy: { odo: 'asc' },
  });

  res.json(trips.map(serializeTrip));
});

// ---- GET /api/v1/trips/stream  (SSE) ----
router.get('/stream', (req: Request, res: Response) => {
  const client = subscribe(TRIPS_CHANNEL, res);
  req.on('close', () => unsubscribe(client));
});

// ---- POST /api/v1/trips  (log new trip) ----
router.post('/', async (req: Request, res: Response) => {
  const {
    carId,
    odo,
    distance,
    cost,
    comment,
    userIds,
    bookingId,   // optional: link to a booking
    parentId,    // optional: parent DateCarBooking id
  } = req.body as {
    carId: string;
    odo: number;
    distance: number;
    cost: number;
    comment?: string;
    userIds: string[];
    bookingId?: string;
    parentId?: string;
  };

  const byUserId = req.user!.id;

  const trip = await prisma.$transaction(async (tx) => {
    const created = await tx.trip.create({
      data: {
        carId,
        odo,
        distance,
        cost,
        comment: comment ?? null,
        byUserId,
        users: { create: userIds.map(uid => ({ userId: uid })) },
      },
      include: tripInclude,
    });

    // Mark the booking as logged if provided
    if (bookingId && parentId) {
      await tx.booking.update({
        where: { id: bookingId },
        data: { logged: created.id },
      });
    }

    return created;
  });

  const serialized = serializeTrip(trip);
  sendEvent(TRIPS_CHANNEL, 'add', serialized);
  res.status(201).json(serialized);
});

// ---- PUT /api/v1/trips/:id  (edit trip) ----
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { odo, distance, cost, comment, userIds } = req.body as {
    odo: number;
    distance: number;
    cost: number;
    comment?: string;
    userIds: string[];
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
      data: {
        odo,
        distance,
        cost,
        comment: comment ?? null,
        users: { create: userIds.map(uid => ({ userId: uid })) },
      },
      include: tripInclude,
    });
  });

  const serialized = serializeTrip(trip);
  sendEvent(TRIPS_CHANNEL, 'update', serialized);
  res.json(serialized);
});

// ---- DELETE /api/v1/trips/:id ----
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
