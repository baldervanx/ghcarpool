/**
 * Serializers: Prisma-modeller → frontend-format
 *
 * Matchar exakt de format som store.ts / use-listen-to-*.ts förväntar sig.
 */

import type {
  User as PrismaUser,
  Car as PrismaCar,
  Destination as PrismaDestination,
  Settings as PrismaSettings,
  DateCarBooking as PrismaDateCarBooking,
  Booking as PrismaBooking,
  BookingUser,
  Trip as PrismaTrip,
  TripUser,
} from '@prisma/client';

// ---- Users ----

export function serializeUser(u: PrismaUser) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    isAdmin: u.isAdmin,
    shortName: u.shortName,
    commentMandatory: u.commentMandatory,
  };
}

// ---- Cars ----

export function serializeCar(c: PrismaCar) {
  return {
    id: c.id,
    name: c.name,
    range: c.range,
    order: c.order,
    hasLog: c.hasLog,
  };
}

// ---- Destinations ----

export function serializeDestination(d: PrismaDestination) {
  return {
    id: d.id,
    name: d.name,
    shortName: d.shortName,
    distance: d.distance ?? undefined,
    temporary: d.temporary,
  };
}

// ---- Settings ----

export function serializeSettings(s: PrismaSettings) {
  return {
    cost_per_km: s.costPerKm,
    ...(s.extra as object | null ?? {}),
  };
}

// ---- Bookings ----

type BookingWithUsers = PrismaBooking & { users: BookingUser[] };
type DateCarBookingFull = PrismaDateCarBooking & {
  bookings: BookingWithUsers[];
};

function serializeBookingEntry(b: BookingWithUsers, parentId: string) {
  return {
    id: b.id,
    parent_id: parentId,
    startTime: b.startTime,
    endTime: b.endTime,
    distance: b.distance,
    destination: b.destinationId ?? '',
    comment: b.comment ?? undefined,
    recurrenceId: b.recurrenceId ?? undefined,
    logged: b.logged ?? undefined,
    byUser: { id: b.byUserId },
    users: b.users.map(bu => ({ id: bu.userId })),
  };
}

export function serializeDateCarBooking(dcb: DateCarBookingFull) {
  return {
    id: dcb.id,
    date: dcb.date,
    car: { id: dcb.carId },
    bookings: dcb.bookings.map(b => serializeBookingEntry(b, dcb.id)),
  };
}

// ---- Trips ----

const fmt = new Intl.DateTimeFormat('sv-SE', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

type TripWithUsers = PrismaTrip & { users: TripUser[] };

export function serializeTrip(t: TripWithUsers) {
  return {
    id: t.id,
    car: { id: t.carId },
    odo: t.odo,
    distance: t.distance,
    cost: t.cost,
    comment: t.comment ?? undefined,
    byUser: { id: t.byUserId },
    users: t.users.map(tu => ({ id: tu.userId })),
    timestamp: fmt.format(t.timestamp),
    timestampISO: t.timestamp.toISOString(),
  };
}
