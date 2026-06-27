/**
 * reset-db.ts — Tömmer alla applikationstabeller i rätt FK-ordning.
 *
 * Användning:
 *   cd packages/backend
 *   npx tsx src/scripts/reset-db.ts            # kräver lokal DATABASE_URL
 *   npx tsx src/scripts/reset-db.ts --force    # kör även mot icke-lokal URL
 *
 * Via Docker (kompilerat):
 *   docker exec ghcarpool_backend_1 node dist/scripts/reset-db.js
 *
 * Kombinerat wipe + reseed:
 *   pnpm db:reseed
 *
 * Säkerhetsspärr: scriptet vägrar köra om DATABASE_URL inte ser lokal ut
 * (localhost / 127.0.0.1 / ::1 / tjänstnamn "db" eller "postgres")
 * om inte --force anges.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');

  const dbUrl = process.env.DATABASE_URL ?? '';
  const isLocalDb = /localhost|127\.0\.0\.1|::1|@db[:/]|@postgres[:/]/.test(dbUrl);

  if (!isLocalDb && !force) {
    console.error('STOPP: DATABASE_URL verkar inte peka mot en lokal databas:');
    console.error(`  ${dbUrl.replace(/:\/\/[^@]+@/, '://<credentials>@')}`);
    console.error('\nAnge --force för att verkligen rensa en icke-lokal databas.');
    process.exit(1);
  }

  console.log('Rensar alla tabeller...\n');

  // Rätt ordning: child-tabeller före parent-tabeller (omvänd FK-kedja)
  //   ErrorLogComment → ErrorLog
  //   TripUser, BookingUser → Trip, Booking
  //   ErrorLog, Expense, CarInfo, DateCarBooking → Car
  //   → Session, Settings, Destination, Car, User
  const [
    errorLogCommentCount,
    tripUserCount,
    bookingUserCount,
    tripCount,
    bookingCount,
    errorLogCount,
    expenseCount,
    carInfoCount,
    dcbCount,
    sessionCount,
    settingsCount,
    destinationCount,
    carCount,
    userCount,
  ] = await prisma.$transaction([
    prisma.errorLogComment.deleteMany(),
    prisma.tripUser.deleteMany(),
    prisma.bookingUser.deleteMany(),
    prisma.trip.deleteMany(),
    prisma.booking.deleteMany(),
    prisma.errorLog.deleteMany(),
    prisma.expense.deleteMany(),
    prisma.carInfo.deleteMany(),
    prisma.dateCarBooking.deleteMany(),
    prisma.session.deleteMany(),
    prisma.settings.deleteMany(),
    prisma.destination.deleteMany(),
    prisma.car.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const rows: [string, { count: number }][] = [
    ['ErrorLogComment', errorLogCommentCount],
    ['TripUser',        tripUserCount],
    ['BookingUser',     bookingUserCount],
    ['Trip',            tripCount],
    ['Booking',         bookingCount],
    ['ErrorLog',        errorLogCount],
    ['Expense',         expenseCount],
    ['CarInfo',         carInfoCount],
    ['DateCarBooking',  dcbCount],
    ['Session',         sessionCount],
    ['Settings',        settingsCount],
    ['Destination',     destinationCount],
    ['Car',             carCount],
    ['User',            userCount],
  ];

  for (const [table, { count }] of rows) {
    if (count > 0) {
      console.log(`  ${table.padEnd(16)} ${count} rad${count === 1 ? '' : 'er'} borttagen${count === 1 ? '' : 'a'}`);
    }
  }

  const total = rows.reduce((sum, [, { count }]) => sum + count, 0);
  console.log(`\nDatabasen tömd. Totalt ${total} rader borttagna.`);
}

main()
  .catch((e) => {
    console.error('[reset-db] Fel:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
