/**
 * Task 6.1 – Datamigrering Firestore → PostgreSQL (via Prisma)
 *
 * Kör med:
 *   pnpm migrate:firestore
 *   # eller direkt:
 *   SERVICE_ACCOUNT=/path/to/serviceAccount.json npx tsx scripts/migrate-from-firestore.ts
 *
 * Kräver:
 *   SERVICE_ACCOUNT – sökväg till Firebase service account JSON
 *   DATABASE_URL    – PostgreSQL-URL (läses från .env om ej satt)
 *
 * Skriptet är idempotent – kan köras flera gånger utan att skapa dubbletter.
 * Alla inserts sker via upsert(). Vid körning på produktionsdata:
 *   1. Kör mot en kopia/staging-databas först.
 *   2. Verifiera räkningarna i slutsummeringen.
 *   3. Kör mot produktion när du är nöjd.
 */

import 'dotenv/config';
import * as path from 'path';
import * as admin from 'firebase-admin';
import { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

const SERVICE_ACCOUNT_PATH =
  process.env.SERVICE_ACCOUNT ??
  path.resolve(__dirname, '..', 'serviceAccount.json');

let serviceAccount: admin.ServiceAccount;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  serviceAccount = require(SERVICE_ACCOUNT_PATH) as admin.ServiceAccount;
} catch {
  console.error(
    `[migrate] Hittade inte service account-fil: ${SERVICE_ACCOUNT_PATH}\n` +
      `Ange sökväg med miljövariabeln SERVICE_ACCOUNT=/path/to/serviceAccount.json`,
  );
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Hjälpfunktioner
// ---------------------------------------------------------------------------

/** Returnerar alla dokument i en samling som { id, ...data } */
async function getAll<T extends object>(collectionName: string): Promise<(T & { id: string })[]> {
  const snap = await db.collection(collectionName).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }));
}

/** Konverterar Firebase Timestamp → Date, eller returnerar now() som fallback */
function toDate(value: unknown): Date {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as admin.firestore.Timestamp).toDate();
  }
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return new Date();
}

// ---------------------------------------------------------------------------
// Firestore-typer (löst – vi castar det vi behöver)
// ---------------------------------------------------------------------------

interface FsUser {
  id: string;
  email: string;
  isAdmin?: boolean;
  shortName?: string;
  commentMandatory?: boolean;
}

interface FsCar {
  id: string;
  name: string;
  range?: number;
  order?: number;
  hasLog?: boolean;
}

interface FsDestination {
  id: string;
  name: string;
  shortName?: string;
  distance?: number;
}

interface FsSettings {
  costPerKm?: number;
}

interface FsBooking {
  startTime: number;
  endTime: number;
  distance?: number;
  destinationId?: string;
  comment?: string;
  recurrenceId?: string;
  logged?: string;      // Trip.id
  byUserId: string;
  userIds?: string[];   // deltagare
}

interface FsDateCarBooking {
  id: string;
  date: string;         // "yyyy-MM-dd"
  carId: string;
  bookings?: Record<string, FsBooking>; // nästlad map i Firestore
}

interface FsTrip {
  id: string;
  carId: string;
  odo: number;
  distance: number;
  cost: number;
  comment?: string;
  timestamp?: unknown;
  byUserId: string;
  userIds?: string[];
}

// ---------------------------------------------------------------------------
// Migreringslogik
// ---------------------------------------------------------------------------

async function migrateUsers(users: FsUser[]): Promise<number> {
  let count = 0;
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        isAdmin: u.isAdmin ?? false,
        shortName: u.shortName ?? '',
        commentMandatory: u.commentMandatory ?? false,
      },
      create: {
        id: u.id,
        email: u.email,
        isAdmin: u.isAdmin ?? false,
        shortName: u.shortName ?? '',
        commentMandatory: u.commentMandatory ?? false,
        passwordHash: null, // Inga lösenord från Firebase — sätt via admin-verktyg efteråt
      },
    });
    count++;
  }
  return count;
}

async function migrateCars(cars: FsCar[]): Promise<number> {
  let count = 0;
  for (const c of cars) {
    await prisma.car.upsert({
      where: { id: c.id },
      update: {
        name: c.name,
        range: c.range ?? 0,
        order: c.order ?? 0,
        hasLog: c.hasLog ?? true,
      },
      create: {
        id: c.id,
        name: c.name,
        range: c.range ?? 0,
        order: c.order ?? 0,
        hasLog: c.hasLog ?? true,
      },
    });
    count++;
  }
  return count;
}

async function migrateDestinations(destinations: FsDestination[]): Promise<number> {
  let count = 0;
  for (const d of destinations) {
    await prisma.destination.upsert({
      where: { id: d.id },
      update: {
        name: d.name,
        shortName: d.shortName ?? '',
        distance: d.distance ?? null,
      },
      create: {
        id: d.id,
        name: d.name,
        shortName: d.shortName ?? '',
        distance: d.distance ?? null,
      },
    });
    count++;
  }
  return count;
}

async function migrateSettings(rawDocs: (FsSettings & { id: string })[]): Promise<number> {
  // Hämta "main"-dokumentet, annars första
  const main = rawDocs.find((d) => d.id === 'main') ?? rawDocs[0];
  if (!main) return 0;
  await prisma.settings.upsert({
    where: { id: 'main' },
    update: { costPerKm: main.costPerKm ?? 1.0 },
    create: { id: 'main', costPerKm: main.costPerKm ?? 1.0 },
  });
  return 1;
}

async function migrateDateCarBookings(
  dcbs: FsDateCarBooking[],
  knownUserIds: Set<string>,
  knownCarIds: Set<string>,
  knownDestinationIds: Set<string>,
): Promise<{ dcbCount: number; bookingCount: number }> {
  let dcbCount = 0;
  let bookingCount = 0;

  for (const dcb of dcbs) {
    // Skippa om bilen inte finns (referensintegritet)
    if (!knownCarIds.has(dcb.carId)) {
      console.warn(`[migrate] Hoppar över DCB ${dcb.id}: bil ${dcb.carId} saknas`);
      continue;
    }

    // Skapa eller uppdatera DateCarBooking
    await prisma.dateCarBooking.upsert({
      where: { id: dcb.id },
      update: {},
      create: {
        id: dcb.id,
        date: dcb.date,
        carId: dcb.carId,
      },
    });
    dcbCount++;

    // Nästlade bookings kan vara antingen en array eller en map i Firestore
    const bookingsRaw = dcb.bookings;
    if (!bookingsRaw) continue;

    const bookingEntries: Array<[string, FsBooking]> = Array.isArray(bookingsRaw)
      ? (bookingsRaw as FsBooking[]).map((b, i) => [String(i), b])
      : Object.entries(bookingsRaw as Record<string, FsBooking>);

    for (const [bookingId, booking] of bookingEntries) {
      // byUser måste finnas
      if (!knownUserIds.has(booking.byUserId)) {
        console.warn(
          `[migrate] Hoppar över bokning ${bookingId}: byUser ${booking.byUserId} saknas`,
        );
        continue;
      }

      // Rensa destinationId – bara sätta om det finns i Postgres
      const destinationId =
        booking.destinationId && knownDestinationIds.has(booking.destinationId)
          ? booking.destinationId
          : null;

      await prisma.booking.upsert({
        where: { id: bookingId },
        update: {
          startTime: booking.startTime,
          endTime: booking.endTime,
          distance: booking.distance ?? 0,
          destinationId,
          comment: booking.comment ?? null,
          recurrenceId: booking.recurrenceId ?? null,
          logged: booking.logged ?? null,
        },
        create: {
          id: bookingId,
          parentId: dcb.id,
          startTime: booking.startTime,
          endTime: booking.endTime,
          distance: booking.distance ?? 0,
          destinationId,
          comment: booking.comment ?? null,
          recurrenceId: booking.recurrenceId ?? null,
          logged: booking.logged ?? null,
          byUserId: booking.byUserId,
        },
      });
      bookingCount++;

      // BookingUsers
      const userIds = booking.userIds ?? [booking.byUserId];
      for (const uid of userIds) {
        if (!knownUserIds.has(uid)) continue;
        await prisma.bookingUser.upsert({
          where: { bookingId_userId: { bookingId, userId: uid } },
          update: {},
          create: { bookingId, userId: uid },
        });
      }
    }
  }

  return { dcbCount, bookingCount };
}

async function migrateTrips(
  trips: FsTrip[],
  knownUserIds: Set<string>,
  knownCarIds: Set<string>,
): Promise<number> {
  let count = 0;
  for (const t of trips) {
    if (!knownCarIds.has(t.carId)) {
      console.warn(`[migrate] Hoppar över trip ${t.id}: bil ${t.carId} saknas`);
      continue;
    }
    if (!knownUserIds.has(t.byUserId)) {
      console.warn(`[migrate] Hoppar över trip ${t.id}: byUser ${t.byUserId} saknas`);
      continue;
    }

    await prisma.trip.upsert({
      where: { id: t.id },
      update: {
        odo: t.odo,
        distance: t.distance,
        cost: t.cost,
        comment: t.comment ?? null,
        timestamp: toDate(t.timestamp),
      },
      create: {
        id: t.id,
        carId: t.carId,
        odo: t.odo,
        distance: t.distance,
        cost: t.cost,
        comment: t.comment ?? null,
        timestamp: toDate(t.timestamp),
        byUserId: t.byUserId,
      },
    });
    count++;

    const userIds = t.userIds ?? [t.byUserId];
    for (const uid of userIds) {
      if (!knownUserIds.has(uid)) continue;
      await prisma.tripUser.upsert({
        where: { tripId_userId: { tripId: t.id, userId: uid } },
        update: {},
        create: { tripId: t.id, userId: uid },
      });
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Huvudflöde
// ---------------------------------------------------------------------------

async function main() {
  console.log('[migrate] Läser från Firestore...');

  const [users, cars, destinations, settingsDocs, dcbs, trips] = await Promise.all([
    getAll<FsUser>('users'),
    getAll<FsCar>('cars'),
    getAll<FsDestination>('destinations'),
    getAll<FsSettings>('settings'),
    getAll<FsDateCarBooking>('date-car-bookings'),
    getAll<FsTrip>('trips'),
  ]);

  console.log(
    `[migrate] Hittade: ${users.length} users, ${cars.length} cars, ` +
      `${destinations.length} destinations, ${settingsDocs.length} settings, ` +
      `${dcbs.length} date-car-bookings, ${trips.length} trips`,
  );

  console.log('[migrate] Skriver till PostgreSQL...');

  const userCount = await migrateUsers(users);
  const carCount = await migrateCars(cars);
  const destCount = await migrateDestinations(destinations);
  const settingsCount = await migrateSettings(settingsDocs);

  // Bygg upp Set:ar för FK-validering
  const knownUserIds = new Set(users.map((u) => u.id));
  const knownCarIds = new Set(cars.map((c) => c.id));
  const knownDestinationIds = new Set(destinations.map((d) => d.id));

  const { dcbCount, bookingCount } = await migrateDateCarBookings(
    dcbs,
    knownUserIds,
    knownCarIds,
    knownDestinationIds,
  );

  const tripCount = await migrateTrips(trips, knownUserIds, knownCarIds);

  console.log('\n[migrate] ✓ Klar!');
  console.log(`  Migrerade: ${userCount} users`);
  console.log(`  Migrerade: ${carCount} cars`);
  console.log(`  Migrerade: ${destCount} destinations`);
  console.log(`  Migrerade: ${settingsCount} settings`);
  console.log(`  Migrerade: ${dcbCount} date-car-bookings`);
  console.log(`  Migrerade: ${bookingCount} bookings`);
  console.log(`  Migrerade: ${tripCount} trips`);
  console.log(
    '\n[migrate] OBS: Migrerade användare saknar lösenord (passwordHash = null).\n' +
      '  Sätt lösenord manuellt via: node dist/scripts/set-password.js <email> <lösenord>',
  );
}

main()
  .catch((err) => {
    console.error('[migrate] Fel:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await admin.app().delete();
  });
