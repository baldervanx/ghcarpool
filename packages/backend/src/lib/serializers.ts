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
  ErrorLog,
  ErrorLogComment,
  Expense,
  CarInfo,
} from '../../generated/prisma/client';

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
  updatedAt: Date;
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
    updatedAt: dcb.updatedAt.toISOString(),
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

// ---- Fellogg ----

type ErrorLogFull = ErrorLog & {
  comments: (ErrorLogComment & { byUser: { id: string } })[];
};

export function serializeErrorLog(e: ErrorLogFull) {
  return {
    id: e.id,
    carId: e.carId,
    description: e.description,
    status: e.status,
    assignedToId: e.assignedToId ?? null,
    updatedById: e.updatedById,
    updatedAt: e.updatedAt.toISOString(),
    createdAt: e.createdAt.toISOString(),
    comments: e.comments.map(c => ({
      id: c.id,
      text: c.text,
      byUserId: c.byUserId,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}

// ---- Utlägg ----

export function serializeExpense(e: Expense) {
  return {
    id: e.id,
    carId: e.carId,
    amount: e.amount,
    description: e.description,
    status: e.status,
    hasReceipt: e.receiptData !== null,
    byUserId: e.byUserId,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

// ---- Bilinfo ----

export function serializeCarInfo(c: CarInfo) {
  return {
    id: c.id,
    carId: c.carId,
    inspectionDue: c.inspectionDue ?? null,
    lastService: c.lastService ?? null,
    owner: c.owner ?? null,
    insuranceCompany: c.insuranceCompany ?? null,
    updatedAt: c.updatedAt.toISOString(),
  };
}
