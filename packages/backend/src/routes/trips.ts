import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { requireAuth } from '../middleware/auth';
import { serializeTrip, serializeDateCarBooking } from '../lib/serializers';
import { subscribe, unsubscribe, sendEvent } from '../lib/sse';

const router = Router();
router.use(requireAuth);

const tripInclude = { users: true } as const;

// SSE channel — trips are global (everyone sees the same log)
const TRIPS_CHANNEL = 'trips';
// Bookings channel — används för att notifiera om logged-uppdatering
const bookingChannel = (userId: string) => `bookings:${userId}`;

// ---- GET /api/v1/trips  (initial load, last 30 days, or delta ?since=ISO) ----
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
    // Fallback: senaste 30 dagar (initial load utan cache)
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

  // ---- Grundläggande input-validering ----
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
  try {
    trip = await prisma.$transaction(async (tx) => {
      // ---- Odo-monoton-validering inuti transaktionen ----
      // Senaste registrerade resan för den här bilen (låst med SELECT FOR UPDATE via Prisma)
      const latestTrip = await tx.trip.findFirst({
        where: { carId },
        orderBy: { odo: 'desc' },
        select: { odo: true },
      });
      if (latestTrip && odo <= latestTrip.odo) {
        throw Object.assign(
          new Error(
            `Nytt odo-värde (${odo}) måste vara högre än senast registrerade (${latestTrip.odo})`,
          ),
          { httpStatus: 409 },
        );
      }

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

  // Om en bokning markerades som loggad: broadcast uppdaterad DCB på bookings-kanalen
  // så att alla berörda klienter ser bocken direkt utan att ladda om.
  if (bookingId && parentId) {
    const dcb = await prisma.dateCarBooking.findUnique({
      where: { id: parentId },
      include: { bookings: { include: { users: true } } },
    });
    if (dcb) {
      const serializedDcb = serializeDateCarBooking(dcb);
      // Notifiera alla användare som ingår i bokningen
      const booking = dcb.bookings.find(b => b.id === bookingId);
      const affectedUserIds = new Set([
        byUserId,
        ...(booking?.users.map(u => u.userId) ?? []),
      ]);
      for (const uid of affectedUserIds) {
        sendEvent(bookingChannel(uid), 'update', serializedDcb);
      }
    }
  }

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
