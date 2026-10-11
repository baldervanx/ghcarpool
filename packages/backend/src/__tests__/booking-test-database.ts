import prisma from '../db/prisma';

export async function assertBookingTestDatabase() {
  const url = new URL(process.env.DATABASE_URL!);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !database.includes('_test_')) {
    throw new Error('Booking integration tests require a disposable local database with _test_ in its name');
  }
  const [actual] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (actual.name !== database) throw new Error('Connected database does not match the disposable test database');
}
