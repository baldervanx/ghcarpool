/**
 * seed.ts — Fyller databasen med testdata.
 *
 * Kör lokalt:
 *   cd packages/backend
 *   DATABASE_URL="postgresql://ghcarpool:***@127.0.0.1:5432/ghcarpool_dev" \
 *     npx ts-node src/scripts/seed.ts
 *
 * Via Docker efter uppstart:
 *   docker compose exec backend node packages/backend/dist/scripts/seed.js
 *
 * Skriptet är idempotent — kör det flera gånger utan risk för dubletter.
 * Befintliga rader med samma unika nyckel hoppas över (upsert/skipDuplicates).
 */

import { PrismaClient } from '@prisma/client';
import { addDays, format, subDays } from 'date-fns';

const prisma = new PrismaClient();

// ── Helpers ──────────────────────────────────────────────────────────────────

function dateStr(d: Date) {
  return format(d, 'yyyy-MM-dd');
}

function timeMin(h: number, m = 0) {
  return h * 60 + m;
}

// ── Seed ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding database...\n');

  // ── Settings ────────────────────────────────────────────────────────────
  const settings = await prisma.settings.upsert({
    where: { id: 'main' },
    create: { id: 'main', costPerKm: 1.5 },
    update: { costPerKm: 1.5 },
  });
  console.log('Settings:', settings);

  // ── Cars ─────────────────────────────────────────────────────────────────
  const carsData = [
    { name: 'Volvo XC60 (ABC 123)', range: 400, order: 1, hasLog: true },
    { name: 'Tesla Model 3 (DEF 456)', range: 500, order: 2, hasLog: true },
    { name: 'VW Passat (GHI 789)', range: 0, order: 3, hasLog: true },
    { name: 'Cykelbud (ingen log)', range: 0, order: 4, hasLog: false },
  ];

  const cars: Record<string, string> = {};
  for (const c of carsData) {
    const car = await prisma.car.upsert({
      where: { id: c.name }, // Används bara för seed — riktiga ids är cuid
      create: c,
      update: {},
    }).catch(async () => {
      // Upsert by name om id inte stämmer
      const existing = await prisma.car.findFirst({ where: { name: c.name } });
      if (existing) return existing;
      return prisma.car.create({ data: c });
    });
    cars[c.name] = car.id;
    console.log('Car:', car.name, '->', car.id);
  }

  // ── Destinations ─────────────────────────────────────────────────────────
  const destsData = [
    { name: 'Huvudkontoret', shortName: 'HK', distance: 12 },
    { name: 'Lager Norr', shortName: 'LN', distance: 25 },
    { name: 'Lager Syd', shortName: 'LS', distance: 18 },
    { name: 'Kundbesök City', shortName: 'KC', distance: 8 },
    { name: 'Flygplatsen', shortName: 'ARN', distance: 45 },
  ];

  const dests: Record<string, string> = {};
  for (const d of destsData) {
    let dest = await prisma.destination.findFirst({ where: { name: d.name } });
    if (!dest) dest = await prisma.destination.create({ data: d });
    dests[d.name] = dest.id;
    console.log('Destination:', dest.name, '->', dest.id);
  }

  // ── Users ─────────────────────────────────────────────────────────────────
  // OBS: I produktion skapas användare automatiskt via requireAuth-middleware
  // när de loggar in med Firebase. Dessa test-users är för lokal testning.
  const usersData = [
    { email: 'admin@example.com', shortName: 'ADM', isAdmin: true, commentMandatory: false },
    { email: 'anna@example.com', shortName: 'ANA', isAdmin: false, commentMandatory: false },
    { email: 'bjorn@example.com', shortName: 'BJN', isAdmin: false, commentMandatory: true },
    { email: 'cecilia@example.com', shortName: 'CEC', isAdmin: false, commentMandatory: false },
    { email: 'david@example.com', shortName: 'DAV', isAdmin: false, commentMandatory: false },
  ];

  const users: Record<string, string> = {};
  for (const u of usersData) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: u,
      update: { shortName: u.shortName, isAdmin: u.isAdmin },
    });
    users[u.email] = user.id;
    console.log('User:', user.email, '->', user.id);
  }

  // ── Trips — historik (senaste 30 dagar) ──────────────────────────────────
  const volvoId = cars['Volvo XC60 (ABC 123)'];
  const teslaId = cars['Tesla Model 3 (DEF 456)'];
  const passatId = cars['VW Passat (GHI 789)'];
  const adminId = users['admin@example.com'];
  const annaId = users['anna@example.com'];
  const bjornId = users['bjorn@example.com'];
  const ceciliaId = users['cecilia@example.com'];

  const tripsSeed = [
    { daysAgo: 28, carId: volvoId, odo: 87200, dist: 25, cost: 37.50, comment: 'Init', byUserId: adminId, userIds: [adminId] },
    { daysAgo: 25, carId: volvoId, odo: 87225, dist: 25, cost: 37.50, comment: 'Lager Norr', byUserId: annaId, userIds: [annaId, bjornId] },
    { daysAgo: 22, carId: volvoId, odo: 87258, dist: 33, cost: 49.50, comment: '', byUserId: bjornId, userIds: [bjornId] },
    { daysAgo: 18, carId: volvoId, odo: 87282, dist: 24, cost: 36.00, comment: 'Kundmöte', byUserId: annaId, userIds: [annaId] },
    { daysAgo: 14, carId: volvoId, odo: 87315, dist: 33, cost: 49.50, comment: 'Lager Syd', byUserId: ceciliaId, userIds: [ceciliaId, annaId] },
    { daysAgo: 10, carId: volvoId, odo: 87345, dist: 30, cost: 45.00, comment: '', byUserId: bjornId, userIds: [bjornId] },
    { daysAgo: 7,  carId: volvoId, odo: 87370, dist: 25, cost: 37.50, comment: 'Flygplatsen', byUserId: annaId, userIds: [annaId] },
    { daysAgo: 3,  carId: volvoId, odo: 87395, dist: 25, cost: 37.50, comment: '', byUserId: ceciliaId, userIds: [ceciliaId] },

    { daysAgo: 30, carId: teslaId, odo: 42000, dist: 12, cost: 18.00, comment: 'Init', byUserId: adminId, userIds: [adminId] },
    { daysAgo: 20, carId: teslaId, odo: 42020, dist: 20, cost: 30.00, comment: 'HK tur-retur', byUserId: bjornId, userIds: [bjornId, ceciliaId] },
    { daysAgo: 12, carId: teslaId, odo: 42050, dist: 30, cost: 45.00, comment: '', byUserId: annaId, userIds: [annaId] },
    { daysAgo: 5,  carId: teslaId, odo: 42068, dist: 18, cost: 27.00, comment: 'Lager Syd', byUserId: ceciliaId, userIds: [ceciliaId] },

    { daysAgo: 29, carId: passatId, odo: 155000, dist: 45, cost: 67.50, comment: 'Init', byUserId: adminId, userIds: [adminId] },
    { daysAgo: 15, carId: passatId, odo: 155060, dist: 60, cost: 90.00, comment: 'Kundbesök', byUserId: annaId, userIds: [annaId, bjornId] },
    { daysAgo: 8,  carId: passatId, odo: 155105, dist: 45, cost: 67.50, comment: 'Flygplatsen', byUserId: bjornId, userIds: [bjornId] },
  ];

  for (const t of tripsSeed) {
    const existingTrip = await prisma.trip.findFirst({
      where: {
        carId: t.carId,
        odo: t.odo,
        byUserId: t.byUserId,
      },
    });
    if (existingTrip) {
      console.log(`Trip odo=${t.odo} already exists — skip`);
      continue;
    }
    const ts = subDays(new Date(), t.daysAgo);
    ts.setHours(9, 0, 0, 0);
    const trip = await prisma.trip.create({
      data: {
        carId: t.carId,
        odo: t.odo,
        distance: t.dist,
        cost: t.cost,
        comment: t.comment,
        timestamp: ts,
        byUserId: t.byUserId,
        users: {
          create: t.userIds.map(uid => ({ userId: uid })),
        },
      },
    });
    console.log(`Trip car=${t.carId.slice(0, 8)} odo=${trip.odo} -> ${trip.id.slice(0, 8)}`);
  }

  // ── Bokningar — kommande 14 dagar ────────────────────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const bookingSlots = [
    // Dag 0 (idag)
    { daysFromNow: 0, carId: volvoId, start: timeMin(8), end: timeMin(10), dist: 25, byUserId: annaId, userIds: [annaId], destName: 'Lager Norr' },
    { daysFromNow: 0, carId: volvoId, start: timeMin(13), end: timeMin(15), dist: 12, byUserId: bjornId, userIds: [bjornId, ceciliaId], destName: 'Huvudkontoret' },
    { daysFromNow: 0, carId: teslaId, start: timeMin(9), end: timeMin(11), dist: 18, byUserId: ceciliaId, userIds: [ceciliaId], destName: 'Lager Syd' },
    // Imorgon
    { daysFromNow: 1, carId: volvoId, start: timeMin(7, 30), end: timeMin(9), dist: 25, byUserId: bjornId, userIds: [bjornId], destName: 'Lager Norr' },
    { daysFromNow: 1, carId: teslaId, start: timeMin(10), end: timeMin(12), dist: 45, byUserId: annaId, userIds: [annaId, bjornId], destName: 'Flygplatsen' },
    // Om 2 dagar
    { daysFromNow: 2, carId: volvoId, start: timeMin(8), end: timeMin(10), dist: 8, byUserId: ceciliaId, userIds: [ceciliaId], destName: 'Kundbesök City' },
    { daysFromNow: 2, carId: passatId, start: timeMin(9), end: timeMin(17), dist: 45, byUserId: annaId, userIds: [annaId, bjornId, ceciliaId], destName: 'Flygplatsen' },
    // Om 5 dagar
    { daysFromNow: 5, carId: volvoId, start: timeMin(8), end: timeMin(9), dist: 12, byUserId: annaId, userIds: [annaId], destName: 'Huvudkontoret' },
    { daysFromNow: 5, carId: teslaId, start: timeMin(14), end: timeMin(16), dist: 18, byUserId: bjornId, userIds: [bjornId], destName: 'Lager Syd' },
    // Om 7 dagar
    { daysFromNow: 7, carId: volvoId, start: timeMin(10), end: timeMin(12), dist: 25, byUserId: ceciliaId, userIds: [ceciliaId, annaId], destName: 'Lager Norr' },
    // Om 10 dagar
    { daysFromNow: 10, carId: teslaId, start: timeMin(8), end: timeMin(10), dist: 45, byUserId: bjornId, userIds: [bjornId], destName: 'Flygplatsen' },
    { daysFromNow: 10, carId: passatId, start: timeMin(13), end: timeMin(15), dist: 8, byUserId: annaId, userIds: [annaId], destName: 'Kundbesök City' },
  ];

  for (const slot of bookingSlots) {
    const date = dateStr(addDays(today, slot.daysFromNow));

    // Hämta eller skapa DateCarBooking för (date, carId)
    const dcb = await prisma.dateCarBooking.upsert({
      where: { date_carId: { date, carId: slot.carId } },
      create: { date, carId: slot.carId },
      update: {},
    });

    // Kontrollera att bokningen inte redan finns
    const existing = await prisma.booking.findFirst({
      where: {
        parentId: dcb.id,
        byUserId: slot.byUserId,
        startTime: slot.start,
      },
    });
    if (existing) {
      console.log(`Booking ${date} start=${slot.start} already exists — skip`);
      continue;
    }

    const booking = await prisma.booking.create({
      data: {
        parentId: dcb.id,
        startTime: slot.start,
        endTime: slot.end,
        distance: slot.dist,
        destinationId: dests[slot.destName] ?? null,
        byUserId: slot.byUserId,
        users: {
          create: slot.userIds.map(uid => ({ userId: uid })),
        },
      },
    });
    console.log(`Booking ${date} ${slot.start}-${slot.end} car=${slot.carId.slice(0, 8)} -> ${booking.id.slice(0, 8)}`);
  }

  console.log('\nSeed complete.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
