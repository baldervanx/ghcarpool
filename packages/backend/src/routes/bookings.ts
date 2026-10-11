import { Router, Request, Response } from 'express';
import { format, startOfMonth, endOfMonth, addMonths } from 'date-fns';
import { Prisma } from '../generated/prisma/client';
import prisma from '../db/prisma';
import { requireAuth } from '../middleware/auth';
import { serializeDateCarBooking, serializeDestination } from '../lib/serializers';
import { subscribe, unsubscribe } from '../lib/sse';
import { bookingInclude as dcbInclude, touchBookingParents, publishBookingParent } from '../lib/booking-events';
import { lockRecurrences, isCalendarDate, isRecurringDays, recurrenceWeekday } from '../lib/recurrence';

const router = Router();
router.use(requireAuth);

// SSE channel name for a date range
const bookingChannel = (userId: string) => `bookings:${userId}`;

// ---- helpers ----

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

function mutationError(message: string, httpStatus: number): Error & { httpStatus: number } {
  return Object.assign(new Error(message), { httpStatus });
}

async function lockCars(tx: Prisma.TransactionClient, carIds: string[]) {
  // Trips and booking mutations share these locks; sort moves to avoid deadlocks.
  for (const carId of [...new Set(carIds)].sort()) {
    const cars = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Car" WHERE id = ${carId} FOR UPDATE
    `;
    if (cars.length === 0) throw mutationError('Bil hittades inte', 404);
  }
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
    isMultiDay,
    recurringStartDate,
    recurringEndDate,
    recurringDays,
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
    recurrenceId?: string | null;
    isMultiDay?: boolean;
    recurringStartDate?: string;
    recurringEndDate?: string;
    recurringDays?: number[];
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
  if (existingBookingId && !existingParentId) {
    res.status(400).json({ error: 'existingParentId krävs vid ändring av bokning' });
    return;
  }
  if ((recurrenceId !== undefined && recurrenceId !== null && typeof recurrenceId !== 'string')
    || (isMultiDay !== undefined && typeof isMultiDay !== 'boolean')) {
    res.status(400).json({ error: 'recurrenceId måste vara text och isMultiDay måste vara boolean' });
    return;
  }
  const hasRange = [recurringStartDate, recurringEndDate, recurringDays].some(value => value !== undefined);
  if (hasRange && (!isCalendarDate(recurringStartDate) || !isCalendarDate(recurringEndDate)
    || recurringStartDate > recurringEndDate || !isRecurringDays(recurringDays))) {
    res.status(400).json({ error: 'Ogiltiga datum eller veckodagar för bokningsserien' });
    return;
  }

  const rawDestId = emptyToNull(destinationId);

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const source = existingBookingId
        ? await tx.dateCarBooking.findUnique({
          where: { id: existingParentId! },
          select: { carId: true },
        })
        : null;
      if (existingBookingId && !source) throw mutationError('Bokning hittades inte', 404);
      await lockCars(tx, [carId, ...(source ? [source.carId] : [])]);

      const existingBooking = existingBookingId
        ? await tx.booking.findUnique({
          where: { id: existingBookingId },
          include: { parent: true, users: true },
        })
        : null;
      if (existingBookingId && (!existingBooking || existingBooking.parentId !== existingParentId)) {
        throw mutationError('Bokning hittades inte', 404);
      }
      if (existingBooking?.logged) {
        throw mutationError('Loggad bokning kan inte ändras', 409);
      }
      const resolvedRecurrenceId = recurrenceId === undefined
        ? existingBooking?.recurrenceId ?? null
        : emptyToNull(recurrenceId);
      if ((isMultiDay !== undefined || hasRange) && !resolvedRecurrenceId) {
        throw mutationError('Seriemetadata kräver recurrenceId', 400);
      }
      await lockRecurrences(tx, [existingBooking?.recurrenceId, resolvedRecurrenceId]);
      const metadataParentIds: string[] = [];
      if (resolvedRecurrenceId !== null) {
        let recurrence = await tx.recurrence.findUnique({ where: { id: resolvedRecurrenceId } });
        if (!recurrence) {
          if (isMultiDay === undefined || !hasRange) {
            throw mutationError('Ny bokningsserie kräver isMultiDay, startdatum, slutdatum och veckodagar', 400);
          }
          recurrence = await tx.recurrence.create({
            data: {
              id: resolvedRecurrenceId, isMultiDay,
              recurringStartDate: recurringStartDate!, recurringEndDate: recurringEndDate!,
              recurringDays: [...recurringDays!].sort(),
            },
          });
        } else if (isMultiDay !== undefined && recurrence.isMultiDay !== null && recurrence.isMultiDay !== isMultiDay) {
          throw mutationError('Bokningsseriens typ kan inte ändras', 409);
        }
        const series = await tx.booking.findMany({
          where: { recurrenceId: resolvedRecurrenceId },
          include: { parent: true },
        });
        if (series.some(booking => booking.parent.carId !== carId)) {
          throw mutationError('Bokningsserien måste tillhöra samma fordon', 409);
        }
        const resolvesKind = recurrence.isMultiDay === null && isMultiDay !== undefined;
        const changesRange = hasRange && (recurrence.recurringStartDate !== recurringStartDate
          || recurrence.recurringEndDate !== recurringEndDate
          || JSON.stringify(recurrence.recurringDays) !== JSON.stringify([...recurringDays!].sort()));
        if (resolvesKind || changesRange) {
          recurrence = await tx.recurrence.update({
            where: { id: resolvedRecurrenceId },
            data: {
              ...(resolvesKind ? { isMultiDay } : {}),
              ...(changesRange ? {
                recurringStartDate: recurringStartDate!, recurringEndDate: recurringEndDate!,
                recurringDays: [...recurringDays!].sort(),
              } : {}),
            },
          });
          metadataParentIds.push(...series.map(booking => booking.parentId));
        }
        if (!isCalendarDate(date) || date < recurrence.recurringStartDate || date > recurrence.recurringEndDate
          || (recurrence.isMultiDay === false && !recurrence.recurringDays.includes(recurrenceWeekday(date)))) {
          throw mutationError('Bokningsdatum ligger utanför seriens datum eller veckodagar', 400);
        }
        if (recurrence.isMultiDay === false && recurrence.recurringDays.length === 0) {
          throw mutationError('Vanlig bokningsserie kräver minst en veckodag', 400);
        }
      }

      let resolvedDestinationId: string | null = null;
      let newDestination: ReturnType<typeof serializeDestination> | null = null;
      if (rawDestId !== null) {
        if (/^c[a-z0-9]{24}$/.test(rawDestId)) {
          const dest = await tx.destination.findUnique({ where: { id: rawDestId } });
          if (!dest) throw mutationError(`Destination '${rawDestId}' finns inte`, 400);
          resolvedDestinationId = dest.id;
        } else {
          const name = rawDestId.trim();
          let dest = await tx.destination.findFirst({
            where: { name: { equals: name, mode: 'insensitive' } },
          });
          if (!dest) {
            dest = await tx.destination.create({
              data: { name, shortName: '', temporary: true },
            });
            newDestination = serializeDestination(dest);
          }
          resolvedDestinationId = dest.id;
        }
      }

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

      if (existingBooking) {
        // UPDATE existing booking
        await tx.bookingUser.deleteMany({ where: { bookingId: existingBooking.id } });
        await tx.booking.update({
          where: { id: existingBooking.id },
          data: {
            parentId: parent.id,
            startTime,
            endTime,
            distance,
            destinationId: resolvedDestinationId,
            comment: emptyToNull(comment),
            recurrenceId: resolvedRecurrenceId,
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
            recurrenceId: resolvedRecurrenceId,
            byUserId,
            users: { create: userIds.map(uid => ({ userId: uid })) },
          },
        });
      }

      const parentIds = [...new Set([
        parent.id, ...(existingBooking ? [existingBooking.parentId] : []), ...metadataParentIds,
      ])];
      await touchBookingParents(tx, parentIds);
      const parents = await tx.dateCarBooking.findMany({
        where: { id: { in: parentIds } },
        include: dcbInclude,
      });
      return {
        parent: parents.find(p => p.id === parent.id)!,
        parents,
        newDestination,
        extraUserIds: [
          byUserId,
          ...(existingBooking ? [existingBooking.byUserId, ...existingBooking.users.map(u => u.userId)] : []),
        ],
      };
    });
  } catch (err: unknown) {
    const e = err as Error & { httpStatus?: number };
    if (e.httpStatus) {
      res.status(e.httpStatus).json({ error: e.message });
      return;
    }
    throw err;
  }

  const serialized = serializeDateCarBooking(result.parent);

  for (const parent of result.parents) {
    publishBookingParent(parent, !existingBookingId && parent.id === result.parent.id ? 'add' : 'update', result.extraUserIds);
  }

  // Inkludera nyss skapad temporär destination i svaret (Alt A: bara avsändaren uppdateras)
  const responseBody = result.newDestination
    ? { ...serialized, newDestination: result.newDestination }
    : serialized;

  res.status(existingBookingId ? 200 : 201).json(responseBody);
});

// ---- DELETE /api/v1/bookings/:parentId/:bookingId ----
router.delete('/:parentId/:bookingId', async (req: Request, res: Response) => {
  const { parentId, bookingId } = req.params;

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const source = await tx.dateCarBooking.findUnique({
        where: { id: parentId }, select: { carId: true },
      });
      if (!source) throw mutationError('Bokning hittades inte', 404);
      await lockCars(tx, [source.carId]);
      const booking = await tx.booking.findUnique({
        where: { id: bookingId }, include: { users: true },
      });
      if (!booking || booking.parentId !== parentId) throw mutationError('Bokning hittades inte', 404);
      await lockRecurrences(tx, [booking.recurrenceId]);
      if (booking.logged) throw mutationError('Loggad bokning kan inte tas bort', 409);
      if (booking.byUserId !== req.user!.id && !req.user!.isAdmin) {
        throw mutationError('Åtkomst nekad', 403);
      }
      await tx.booking.delete({ where: { id: bookingId } });
      await touchBookingParents(tx, [parentId]);
      const parent = await tx.dateCarBooking.findUniqueOrThrow({
        where: { id: parentId }, include: dcbInclude,
      });
      return {
        parent,
        extraUserIds: [req.user!.id, booking.byUserId, ...booking.users.map(u => u.userId)],
      };
    });
  } catch (err: unknown) {
    const e = err as Error & { httpStatus?: number };
    if (e.httpStatus) {
      res.status(e.httpStatus).json({ error: e.message });
      return;
    }
    throw err;
  }
  publishBookingParent(result.parent, 'update', result.extraUserIds);
  res.json(serializeDateCarBooking(result.parent));
});

export default router;
