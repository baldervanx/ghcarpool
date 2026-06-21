import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';

const PgSession = connectPgSimple(session);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export function buildSessionMiddleware() {
  return session({
    store: new PgSession({
      pool,
      tableName: 'session',
      createTableIfMissing: false, // tabellen skapas via Prisma-migration
    }),
    secret: process.env.SESSION_SECRET ?? 'dev-secret-change-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // secure=true kräver HTTPS — sätt COOKIE_SECURE=true om du kör med TLS-terminering
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dagar
    },
  });
}
