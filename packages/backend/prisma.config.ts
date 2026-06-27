import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// DATABASE_URL behövs bara av CLI-kommandon (migrate deploy, migrate diff etc.).
// prisma generate kräver ingen URL — utelämna datasource-blocket vid byggtid
// så att Prisma inte kastar "datasource.url is required" när variabeln saknas.
// Vid runtime sätts DATABASE_URL av Docker → blocket inkluderas och migrate fungerar.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  ...(process.env.DATABASE_URL
    ? { datasource: { url: process.env.DATABASE_URL } }
    : {}),
});
