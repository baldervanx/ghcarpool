import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  // DATABASE_URL behövs bara av migrate-kommandon, inte av prisma generate.
  // process.env används direkt (inte den strikta env()) för att undvika kast
  // vid byggtid när variabeln inte är satt.
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
