import prisma from '../db/prisma';

describe('Prisma smoke test', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('kan ansluta till databasen', async () => {
    const result = await prisma.$queryRaw<[{ one: number }]>`SELECT 1 AS one`;
    expect(result[0].one).toBe(1);
  });

  it('Settings-tabell existerar', async () => {
    const count = await prisma.settings.count();
    expect(typeof count).toBe('number');
  });

  it('User-tabell existerar', async () => {
    const count = await prisma.user.count();
    expect(typeof count).toBe('number');
  });
});
