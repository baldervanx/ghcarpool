/**
 * seed.ts — Fyller databasen med testdata.
 *
 * Kör lokalt:
 *   cd packages/backend
 *   DATABASE_URL="postgresql://ghcarpool:***@127.0.0.1:5432/ghcarpool_dev" \
 *     pnpm exec tsx src/scripts/seed.ts
 *
 * Via Podman efter uppstart:
 *   podman compose exec backend pnpm exec tsx src/scripts/seed.ts
 *
 * Skriptet är idempotent — kör det flera gånger utan risk för dubletter.
 * Befintliga rader med samma unika nyckel hoppas över (upsert/skipDuplicates).
 */

import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { addDays, format, subDays } from 'date-fns';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

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

  // ── Lösenord för seed-användare ───────────────────────────────────────────
  const SEED_PASSWORD = 'dev123';
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  // ── Settings ────────────────────────────────────────────────────────────
  const settings = await prisma.settings.upsert({
    where: { id: 'main' },
    create: { id: 'main', costPerKm: 1.5 },
    update: { costPerKm: 1.5 },
  });
  console.log('Settings:', settings);

  // ── Cars ─────────────────────────────────────────────────────────────────
  // id = reg-nummer (används som referens i appen), name = smeknamn
  const carsData = [
    { id: 'ABC123', name: 'Volvon',  range: 400, order: 1, hasLog: true },
    { id: 'DEF456', name: 'Teslan',  range: 500, order: 2, hasLog: true },
    { id: 'GHI789', name: 'Passaten', range: 0,   order: 3, hasLog: true },
    { id: 'CYKEL1', name: 'Cykelbud', range: 0,   order: 4, hasLog: false },
  ];

  const cars: Record<string, string> = {};
  for (const c of carsData) {
    const car = await prisma.car.upsert({
      where: { id: c.id },
      create: c,
      update: { name: c.name, range: c.range, order: c.order, hasLog: c.hasLog },
    });
    cars[c.id] = car.id;
    console.log('Car:', car.id, '->', car.name);
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
  // Seed-användare får alla lösenordet "dev123" för lokal testning.
  // I produktion sätts riktiga lösenord med: pnpm exec ts-node src/scripts/set-password.ts
  // id = signatur (visas i bokningsvyn), name = fullständigt namn
  const usersData = [
    { id: 'ADM', name: 'Admin Adminsson',   email: 'admin@example.com', shortName: 'Admin', isAdmin: true,  commentMandatory: false },
    { id: 'ANA', name: 'Anna Andersson',    email: 'anna@example.com',  shortName: 'Anna',  isAdmin: false, commentMandatory: false },
    { id: 'BJN', name: 'Björn Björnsson',   email: 'bjorn@example.com', shortName: 'Björn', isAdmin: false, commentMandatory: true  },
    { id: 'CEC', name: 'Cecilia Cecilsson', email: 'cecilia@example.com', shortName: 'Cille', isAdmin: false, commentMandatory: false },
    { id: 'DAV', name: 'David Davidsson',   email: 'david@example.com', shortName: 'David', isAdmin: false, commentMandatory: false },
  ];

  const users: Record<string, string> = {};
  for (const u of usersData) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: { ...u, passwordHash },
      update: { name: u.name, shortName: u.shortName, isAdmin: u.isAdmin, passwordHash },
    });
    users[u.email] = user.id;
    console.log('User:', user.id, user.email);
  }
  console.log(`\nAlla seed-användare har lösenordet: ${SEED_PASSWORD}\n`);

  // ── Trips — historik (senaste 30 dagar) ──────────────────────────────────
  const volvoId = cars['ABC123'];
  const teslaId = cars['DEF456'];
  const passatId = cars['GHI789'];
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

  // ── Historik, multi-day och repeating ────────────────────────────────────
  // Dessa fixtures används för att testa varningar och loggning av tidigare
  // bokningar. Samma seed kan köras flera gånger utan att skapa dubletter.
  type LoggedTripSeed = {
    carId: string;
    odo: number;
    distance: number;
    byUserId: string;
    userIds: string[];
  };

  type BookingFixture = {
    date: string;
    carId: string;
    startTime: number;
    endTime: number;
    distance: number;
    byUserId: string;
    userIds: string[];
    destinationId: string;
    comment: string;
    recurrenceId?: string;
    loggedTrip?: LoggedTripSeed;
  };

  async function createBookingFixture(fixture: BookingFixture) {
    const parent = await prisma.dateCarBooking.upsert({
      where: { date_carId: { date: fixture.date, carId: fixture.carId } },
      create: { date: fixture.date, carId: fixture.carId },
      update: {},
    });

    let booking = await prisma.booking.findFirst({
      where: {
        parentId: parent.id,
        byUserId: fixture.byUserId,
        startTime: fixture.startTime,
        recurrenceId: fixture.recurrenceId ?? null,
      },
    });

    if (!booking) {
      booking = await prisma.booking.create({
        data: {
          parentId: parent.id,
          startTime: fixture.startTime,
          endTime: fixture.endTime,
          distance: fixture.distance,
          destinationId: fixture.destinationId,
          comment: fixture.comment,
          recurrenceId: fixture.recurrenceId,
          byUserId: fixture.byUserId,
          users: {
            create: fixture.userIds.map(userId => ({ userId })),
          },
        },
      });
    }

    if (fixture.loggedTrip && !booking.logged) {
      let trip = await prisma.trip.findFirst({
        where: {
          carId: fixture.loggedTrip.carId,
          odo: fixture.loggedTrip.odo,
          byUserId: fixture.loggedTrip.byUserId,
        },
      });

      if (!trip) {
        trip = await prisma.trip.create({
          data: {
            carId: fixture.loggedTrip.carId,
            odo: fixture.loggedTrip.odo,
            distance: fixture.loggedTrip.distance,
            cost: fixture.loggedTrip.distance * 1.5,
            comment: `Seed: ${fixture.comment}`,
            timestamp: new Date(`${fixture.date}T12:00:00`),
            byUserId: fixture.loggedTrip.byUserId,
            users: {
              create: fixture.loggedTrip.userIds.map(userId => ({ userId })),
            },
          },
        });
      }

      booking = await prisma.booking.update({
        where: { id: booking.id },
        data: { logged: trip.id },
      });
    }

    console.log(
      `Fixture booking ${fixture.date} ${fixture.startTime}-${fixture.endTime}`
      + ` car=${fixture.carId} ${booking.logged ? '(logged)' : '(unlogged)'}`,
    );
  }

  const historicalFixtures: BookingFixture[] = [
    {
      date: dateStr(subDays(today, 1)),
      carId: volvoId,
      startTime: timeMin(7),
      endTime: timeMin(9),
      distance: 25,
      destinationId: dests['Lager Norr'],
      byUserId: annaId,
      userIds: [annaId],
      comment: 'Seed historik - glömd igår',
    },
    {
      date: dateStr(subDays(today, 2)),
      carId: teslaId,
      startTime: timeMin(10),
      endTime: timeMin(12),
      distance: 18,
      destinationId: dests['Lager Syd'],
      byUserId: ceciliaId,
      userIds: [ceciliaId],
      comment: 'Seed historik - förrgår',
      loggedTrip: { carId: teslaId, odo: 42090, distance: 18, byUserId: ceciliaId, userIds: [ceciliaId] },
    },
    {
      date: dateStr(subDays(today, 4)),
      carId: passatId,
      startTime: timeMin(9),
      endTime: timeMin(11),
      distance: 45,
      destinationId: dests['Flygplatsen'],
      byUserId: annaId,
      userIds: [annaId, bjornId],
      comment: 'Seed historik - loggad',
      loggedTrip: { carId: passatId, odo: 155130, distance: 45, byUserId: annaId, userIds: [annaId, bjornId] },
    },
    {
      date: dateStr(subDays(today, 3)),
      carId: volvoId,
      startTime: timeMin(13),
      endTime: timeMin(15),
      distance: 12,
      destinationId: dests['Huvudkontoret'],
      byUserId: bjornId,
      userIds: [bjornId],
      comment: 'Seed historik - loggad',
      loggedTrip: { carId: volvoId, odo: 87482, distance: 12, byUserId: bjornId, userIds: [bjornId] },
    },
    {
      date: dateStr(subDays(today, 6)),
      carId: teslaId,
      startTime: timeMin(8),
      endTime: timeMin(10),
      distance: 45,
      destinationId: dests['Flygplatsen'],
      byUserId: bjornId,
      userIds: [bjornId],
      comment: 'Seed historik - glömd',
    },
  ];

  for (const fixture of historicalFixtures) await createBookingFixture(fixture);

  const multiDayRecurrenceId = 'seed-multiday-ending-today';
  for (const daysAgo of [2, 1, 0]) {
    await createBookingFixture({
      date: dateStr(subDays(today, daysAgo)),
      carId: passatId,
      startTime: daysAgo === 2 ? timeMin(8) : 0,
      endTime: daysAgo === 0 ? timeMin(16) : 1440,
      distance: 60,
      destinationId: dests['Kundbesök City'],
      byUserId: annaId,
      userIds: [annaId, bjornId],
      comment: 'Seed multi-day som slutar idag',
      recurrenceId: multiDayRecurrenceId,
    });
  }

  const repeatingRecurrenceId = 'seed-repeating-includes-today';
  for (const daysAgo of [6, 3, 0, -3]) {
    await createBookingFixture({
      date: dateStr(subDays(today, daysAgo)),
      carId: volvoId,
      startTime: timeMin(14),
      endTime: timeMin(16),
      distance: 25,
      destinationId: dests['Lager Norr'],
      byUserId: ceciliaId,
      userIds: [ceciliaId],
      comment: 'Seed repeating - förekomst',
      recurrenceId: repeatingRecurrenceId,
      ...(daysAgo === 6
        ? { loggedTrip: { carId: volvoId, odo: 87445, distance: 25, byUserId: ceciliaId, userIds: [ceciliaId] } }
        : daysAgo === 3
          ?  { loggedTrip: { carId: volvoId, odo: 87470, distance: 25, byUserId: ceciliaId, userIds: [ceciliaId] } }

  : {}),
    });
  }

  console.log('\nSeed complete.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
