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
import * as fs from 'fs';
import bcrypt from 'bcrypt';
import { initializeApp, cert, deleteApp, getApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, DocumentReference } from 'firebase-admin/firestore';
import { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

const SERVICE_ACCOUNT_PATH =
  process.env.SERVICE_ACCOUNT ??
  path.resolve(__dirname, '..', 'serviceAccount.json');

let serviceAccount: Parameters<typeof cert>[0];
try {
  serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
} catch {
  console.error(
    `[migrate] Hittade inte service account-fil: ${SERVICE_ACCOUNT_PATH}\n` +
      `Ange sökväg med miljövariabeln SERVICE_ACCOUNT=/path/to/serviceAccount.json`,
  );
  process.exit(1);
}

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();
const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Hjälpfunktioner
// ---------------------------------------------------------------------------

/** Returnerar alla dokument i en samling som { id, ...data } */
async function getAll<T extends object>(collectionName: string): Promise<(T & { id: string })[]> {
  const snap = await db.collection(collectionName).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }));
}
function toDate(value: unknown): Date {
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return new Date();
}

/** Extraherar id ur antingen en sträng eller en DocumentReference */
function refId(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  if (value instanceof DocumentReference) return value.id;
  return undefined;
}

/** Extraherar id-array ur antingen string[] eller DocumentReference[] */
function refIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(refId).filter((id): id is string => !!id);
}

// ---------------------------------------------------------------------------
// Firestore-typer (löst – fält kan vara strängar eller DocumentReferences)
// ---------------------------------------------------------------------------

interface FsUser {
  id: string;
  email: string;
  name?: string;
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
  cost_per_km?: number; // alternativt fältnamn i Firestore
}

interface FsBooking {
  startTime: number;
  endTime: number;
  distance?: number;
  destination?: unknown;   // DocumentReference eller sträng
  comment?: string;
  recurrenceId?: string;
  logged?: string;         // Trip.id
  byUser?: unknown;        // DocumentReference (userId)
  users?: unknown[];       // DocumentReference[] (userIds)
}

interface FsDateCarBooking {
  id: string;
  date: string;            // "yyyy-MM-dd"
  car?: unknown;           // DocumentReference (carId)
  bookings?: Record<string, FsBooking>;
}

interface FsTrip {
  id: string;
  car?: unknown;           // DocumentReference (carId)
  odo: number;
  distance: number;
  cost: number;
  comment?: string;
  timestamp?: unknown;
  byUser?: unknown;        // DocumentReference (userId)
  users?: unknown[];       // DocumentReference[] (userIds)
}

// ---------------------------------------------------------------------------
// Migreringslogik
// ---------------------------------------------------------------------------

async function migrateUsers(users: FsUser[]): Promise<{ count: number; migratedIds: Set<string> }> {
  let count = 0;
  const migratedIds = new Set<string>();
  const temporaryHash = await bcrypt.hash('temporary', 12);
  for (const u of users) {
    // Användare utan email (t.ex. rena loggkonton) får en dummy-adress.
    // De kan inte logga in utan att lösenord och riktig e-post sätts manuellt.
    const email = u.email || `noemail-${u.id}@ghcarpool.local`;
    if (!u.email) {
      console.warn(
        `[migrate] User ${u.id} saknar email — tilldelar dummy-adress ${email}`,
      );
    }
    await prisma.user.upsert({
      where: { email },
      update: {
        name: u.name ?? '',
        isAdmin: u.isAdmin ?? false,
        shortName: u.shortName ?? '',
        commentMandatory: u.commentMandatory ?? false,
      },
      create: {
        id: u.id,
        email,
        name: u.name ?? '',
        isAdmin: u.isAdmin ?? false,
        shortName: u.shortName ?? '',
        commentMandatory: u.commentMandatory ?? false,
        passwordHash: temporaryHash,
      },
    });
    migratedIds.add(u.id);
    count++;
  }
  return { count, migratedIds };
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
    update: { costPerKm: main.costPerKm ?? main.cost_per_km ?? 1.0 },
    create: { id: 'main', costPerKm: main.costPerKm ?? main.cost_per_km ?? 1.0 },
  });
  return 1;
}

async function migrateDateCarBookings(
  dcbs: FsDateCarBooking[],
  knownUserIds: Set<string>,
  knownCarIds: Set<string>,
  knownDestinationIds: Set<string>,
  destinationsByName: Map<string, string>,
): Promise<{ dcbCount: number; bookingCount: number }> {
  let dcbCount = 0;
  let bookingCount = 0;

  for (const dcb of dcbs) {
    const carId = refId(dcb.car);
    // Skippa om bilen inte finns (referensintegritet)
    if (!carId || !knownCarIds.has(carId)) {
      console.warn(`[migrate] Hoppar över DCB ${dcb.id}: bil ${carId} saknas`);
      continue;
    }

    // Skapa eller uppdatera DateCarBooking via unique(date, carId)
    const existingDcb = await prisma.dateCarBooking.findUnique({
      where: { date_carId: { date: dcb.date, carId } },
    });
    const dcbRecord = existingDcb ?? await prisma.dateCarBooking.create({
      data: { id: dcb.id, date: dcb.date, carId },
    });
    const dcbId = dcbRecord.id;
    dcbCount++;

    // Nästlade bookings kan vara antingen en array eller en map i Firestore
    const bookingsRaw = dcb.bookings;
    if (!bookingsRaw) continue;

    const bookingEntries: Array<[string, FsBooking]> = Array.isArray(bookingsRaw)
      ? (bookingsRaw as FsBooking[]).map((b, i) => [String(i), b])
      : Object.entries(bookingsRaw as Record<string, FsBooking>);

    for (const [mapKey, booking] of bookingEntries) {
      // Firestore lagrar booking-ID som ett fält inuti objektet, inte som kartnyckeln
      // (kartnyckeln är ofta "0", "1" osv)
      const bookingId: string = (booking as any).id ?? `${dcbId}_${mapKey}`;
      const byUserId = refId(booking.byUser);
      // byUser måste finnas
      if (!byUserId || !knownUserIds.has(byUserId)) {
        console.warn(
          `[migrate] Hoppar över bokning ${bookingId}: byUser ${byUserId} saknas`,
        );
        continue;
      }

      // destination kan vara ett namn (sträng) eller en DocumentReference
      // Slå upp ID via namn, annars via refId
      let destinationId: string | null = null;
      if (booking.destination) {
        const rawDestRef = refId(booking.destination);
        if (rawDestRef && knownDestinationIds.has(rawDestRef)) {
          destinationId = rawDestRef;
        } else if (typeof booking.destination === 'string') {
          // destination är ett namn – slå upp ID
          const byName = destinationsByName.get(booking.destination.toLowerCase());
          destinationId = byName ?? null;
        }
      }

      // logged kan vara en DocumentReference (Trip.id)
      const logged = refId(booking.logged) ?? null;

      await prisma.booking.upsert({
        where: { id: bookingId },
        update: {
          startTime: booking.startTime,
          endTime: booking.endTime,
          distance: booking.distance ?? 0,
          destinationId,
          comment: booking.comment ?? null,
          recurrenceId: booking.recurrenceId ?? null,
          logged,
        },
        create: {
          id: bookingId,
          parentId: dcbId,
          startTime: booking.startTime,
          endTime: booking.endTime,
          distance: booking.distance ?? 0,
          destinationId,
          comment: booking.comment ?? null,
          recurrenceId: booking.recurrenceId ?? null,
          logged,
          byUserId,
        },
      });
      bookingCount++;

      // BookingUsers
      const userIds = refIds(booking.users);
      const allUserIds = userIds.length > 0 ? userIds : [byUserId];
      for (const uid of allUserIds) {
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
    const carId = refId(t.car);
    if (!carId || !knownCarIds.has(carId)) {
      console.warn(`[migrate] Hoppar över trip ${t.id}: bil ${carId} saknas`);
      continue;
    }
    const byUserId = refId(t.byUser);
    if (!byUserId || !knownUserIds.has(byUserId)) {
      console.warn(`[migrate] Hoppar över trip ${t.id}: byUser ${byUserId} saknas`);
      continue;
    }

    await prisma.trip.upsert({
      where: { id: t.id },
      update: {
        odo: t.odo ?? 0,
        distance: t.distance ?? 0,
        cost: t.cost ?? 0,
        comment: t.comment ?? null,
        timestamp: toDate(t.timestamp),
      },
      create: {
        id: t.id,
        carId,
        odo: t.odo ?? 0,
        distance: t.distance ?? 0,
        cost: t.cost ?? 0,
        comment: t.comment ?? null,
        timestamp: toDate(t.timestamp),
        byUserId,
      },
    });
    count++;

    const userIds = refIds(t.users);
    const allUserIds = userIds.length > 0 ? userIds : [byUserId];
    for (const uid of allUserIds) {
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

  const { count: userCount, migratedIds: migratedUserIds } = await migrateUsers(users);
  const carCount = await migrateCars(cars);
  const destCount = await migrateDestinations(destinations);
  const settingsCount = await migrateSettings(settingsDocs);

  // Bygg upp Set:ar för FK-validering — använd bara faktiskt migrerade users
  const knownUserIds = migratedUserIds;
  const knownCarIds = new Set(cars.map((c) => c.id));
  const knownDestinationIds = new Set(destinations.map((d) => d.id));
  // Map: destination name (lowercase) → id, för att slå upp destinations via namn
  const destinationsByName = new Map(destinations.map((d) => [d.name.toLowerCase(), d.id]));

  const { dcbCount, bookingCount } = await migrateDateCarBookings(
    dcbs,
    knownUserIds,
    knownCarIds,
    knownDestinationIds,
    destinationsByName,
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
    '\n[migrate] OBS: Alla migrerade användare har fått lösenordet "temporary".\n' +
      '  Sätt nytt lösenord via: node dist/scripts/set-password.js <email> <lösenord>\n' +
      '  Användare utan email har fått adressen noemail-<id>@ghcarpool.local.\n' +
      '  Sätt riktig adress + lösenord via psql eller admin-API:et.',
  );
}

main()
  .catch((err) => {
    console.error('[migrate] Fel:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    try { await deleteApp(getApp()); } catch { /* ignorera om redan borttagen */ }
  });
