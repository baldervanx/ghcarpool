/**
 * Sätt eller uppdatera lösenord för en befintlig användare.
 * Användning: pnpm exec ts-node src/scripts/set-password.ts <email> <lösenord>
 */
import 'dotenv/config';
import bcrypt from 'bcrypt';
import prisma from '../db/prisma';

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Användning: set-password.ts <email> <lösenord>');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    console.error(`Användaren ${email} finns inte. Skapa användaren först.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({ where: { email }, data: { passwordHash } });
  console.log(`Lösenord satt för ${email}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
