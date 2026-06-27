import { Router, Request, Response } from 'express';
import { format, startOfMonth, endOfMonth, addMonths } from 'date-fns';
import { Prisma } from '../generated/prisma/client';
import prisma from '../db/prisma';
import { requireAuth } from '../middleware/auth';
import { serializeDateCarBooking, serializeDestination } from '../lib/serializers';
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

// Defaultfönster: innevarande månad + 3 månader framåt
function defaultDateRange() {
  const now = new Date();
  const start = startOfMonth(now);
  const end = endOfMonth(addMonths(now, 3));
  return {
    startDate: format(start, 'yyyy-MM-dd'),
    endDate: format(end, 'yyyy-MM-dd'),
  };
}

// Touch updatedAt på en DateCarBooking så att ?since= fångar ändringen.
// Använder raw SQL eftersom Prisma inte tillåter att man explicit sätter @updatedAt
// men en tom update() triggrar inte alltid @updatedAt i äldre Prisma-versioner.
async function touchParent(parentId: string) {
  await prisma.$executeRaw`
    UPDATE "DateCarBooking"
    SET "updatedAt" = NOW()
    WHERE id = ${parentId}
  `;
}

// ---- GET /api/v1/bookings  (initial load + lazy month load) ----
//
// Query params:
//   ?startDate=yyyy-MM-dd   Inklusive startgräns (default: startOfMonth idag)
//   ?endDate=yyyy-MM-dd     Inklusive slutgräns  (default: slut på idag+3 månader)
//   ?since=ISO8601          Returnera bara DCBs vars updatedAt > since (delta-sync)
//
router.get('/', async (req: Request, res: Response) => {
  const { startDate, endDate } = {
    ...defaultDateRange(),
    ...(req.query.startDate ? { startDate: req.query.startDate as string } : {}),
    ...(req.query.endDate ? { endDate: req.query.endDate as string } : {}),
  };

  const sinceRaw = req.query.since as string | undefined;

  const dcbs = await prisma.dateCarBooking.findMany({
    where: {
      date: { gte: startDate, lte: endDate },
      ...(sinceRaw && !isNaN(new Date(sinceRaw).getTime())
        ? { updatedAt: { gt: new Date(sinceRaw) } }
        : {}),
    },
    include: dcbInclude,
    orderBy: { date: 'asc' },
  });

  res.json({
    startDate,
    endDate,
    since: sinceRaw ?? null,
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

  // ---- Grundläggande input-validering ----
  if (!date || !carId || !Array.isArray(userIds) || userIds.length === 0) {
    res.status(400).json({ error: 'Obligatoriska fält saknas: date, carId, userIds' });
    return;
  }
  if (typeof startTime !== 'number' || typeof endTime !== 'number') {
    res.status(400).json({ error: 'startTime och endTime måste vara tal (minuter från midnatt)' });
    return;
  }
  if (endTime <= startTime) {
    res.status(400).json({ error: 'endTime måste vara större än startTime' });
    return;
  }

  // Lös upp destinationId:
  //   - tom sträng/null → ingen destination
  //   - ser ut som ett CUID (börjar med "c", 25 tecken) → slå upp i DB, returnera 400 om ej finns
  //   - annars → behandla som ett namn, find-or-create en temporär destination
  const rawDestId = emptyToNull(destinationId);
  let resolvedDestinationId: string | null = null;
  let newDestination: ReturnType<typeof import('../lib/serializers').serializeDestination> | null = null;

  if (rawDestId !== null) {
    const looksLikeCuid = /^c[a-z0-9]{24}$/.test(rawDestId);
    if (looksLikeCuid) {
      // Normalt fall: kontrollera att destinationen finns
      const destExists = await prisma.destination.findUnique({
        where: { id: rawDestId },
        select: { id: true },
      });
      if (!destExists) {
        res.status(400).json({ error: `Destination '${rawDestId}' finns inte` });
        return;
      }
      resolvedDestinationId = rawDestId;
    } else {
      // Fri text: find-or-create en temporär destination baserat på namn
      const trimmedName = rawDestId.trim();
      let dest = await prisma.destination.findFirst({
        where: { name: { equals: trimmedName, mode: 'insensitive' } },
      });
      if (!dest) {
        dest = await prisma.destination.create({
          data: { name: trimmedName, shortName: '', temporary: true },
        });
        // Lägg med i svaret så frontenden kan uppdatera sin destinations-lista
        newDestination = serializeDestination(dest);
      }
      resolvedDestinationId = dest.id;
    }
  }

  let dcb;
  try {
    dcb = await prisma.$transaction(async (tx) => {
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

      // ---- Överlappningskontroll inuti transaktionen ----
      // Hämta befintliga bokningar för detta datum/bil (exklusive den vi eventuellt uppdaterar)
      const existingBookings = parent.bookings.filter(
        (b) => b.id !== existingBookingId,
      );
      const overlapping = existingBookings.find(
        (b) => startTime < b.endTime && endTime > b.startTime,
      );
      if (overlapping) {
        const fmt = (m: number) =>
          `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        throw Object.assign(
          new Error(
            `Tidskollision med befintlig bokning ${fmt(overlapping.startTime)}–${fmt(overlapping.endTime)}`,
          ),
          { httpStatus: 409 },
        );
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

      // Touch updatedAt på parent så ?since= fångar ändringen.
      // Raw SQL eftersom Prisma @updatedAt inte kan sättas explicit i data: {}.
      await tx.$executeRaw`
        UPDATE "DateCarBooking"
        SET "updatedAt" = NOW()
        WHERE id = ${parent.id}
      `;

      // Re-fetch the full parent with all bookings
      return tx.dateCarBooking.findUniqueOrThrow({
        where: { id: parent.id },
        include: dcbInclude,
      });
    });
  } catch (err: unknown) {
    const e = err as Error & { httpStatus?: number };
    if (e.httpStatus) {
      res.status(e.httpStatus).json({ error: e.message });
      return;
    }
    throw err;
  }

  const serialized = serializeDateCarBooking(dcb);

  // Broadcast to all subscribers of the users involved
  const affectedUserIds = new Set([
    byUserId,
    ...req.body.userIds as string[],
  ]);
  for (const uid of affectedUserIds) {
    sendEvent(bookingChannel(uid), existingBookingId ? 'update' : 'add', serialized);
  }

  // Inkludera nyss skapad temporär destination i svaret (Alt A: bara avsändaren uppdateras)
  const responseBody = newDestination
    ? { ...serialized, newDestination }
    : serialized;

  res.status(existingBookingId ? 200 : 201).json(responseBody);
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
    // Touch updatedAt så delta-sync (?since=) fångar borttagningen
    await touchParent(parent.id);
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
