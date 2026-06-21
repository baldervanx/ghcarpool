/**
 * Hjälpskript: Sätt lösenord för en migrerad användare (eller skapa ny)
 *
 * Kör med:
 *   pnpm set-password -- <email> <lösenord>
 *   # eller:
 *   npx tsx scripts/set-password.ts user@example.com mittlösenord
 */

import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Användning: npx tsx scripts/set-password.ts <email> <lösenord>');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash },
    create: {
      email,
      passwordHash: hash,
      shortName: email.split('@')[0],
    },
  });

  console.log(`✓ Lösenord satt för ${user.email} (id: ${user.id})`);
}

main()
  .catch((err) => {
    console.error('Fel:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
