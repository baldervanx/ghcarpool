# Passport.js Local Auth — ersätt Firebase Auth

> **Mål:** Ta bort Firebase Auth-beroendet (frontend + backend) och ersätta det med
> Passport.js session-baserad auth med passport-local som primär strategi.
> Google OAuth (passport-google-oauth20) behålls som optionell strategi.

**Arkitektur:**
- Backend exponerar `/api/v1/auth/login` (POST, local), `/api/v1/auth/google` (OAuth), `/api/v1/auth/logout` (POST), `/api/v1/auth/me` (GET).
- `requireAuth`-middleware kontrollerar `req.user` satt av Passport (session-cookie) — tar bort Firebase-token-verifiering.
- Frontend ersätter `onAuthStateChanged` / `getIdToken` med ett enkelt `GET /api/v1/auth/me`-anrop vid mount.
- `firebase` och `firebase-admin` tas bort när allt är grönt.

**Tech Stack:**
- Backend: passport, passport-local, passport-google-oauth20, bcrypt, express-session (redan installerat förutom bcrypt)
- Frontend: ta bort firebase-paketet; login-sida med e-post + lösenordsformulär
- DB: nytt fält `passwordHash String?` på User-modellen + Prisma-migration

---

## Task 1 — Lägg till passwordHash på User-modellen

**Objective:** Utöka Prisma-schemat med ett nullable `passwordHash`-fält.

**Files:**
- Modify: `packages/backend/prisma/schema.prisma`

**Steg 1:** Lägg till fältet i User-modellen:
```prisma
passwordHash String?
```
efter `createdAt`-fältet.

**Steg 2:** Skapa migration:
```bash
cd packages/backend
pnpm exec prisma migrate dev --name add-password-hash
```

**Steg 3:** Verifiera:
```bash
pnpm exec prisma studio
# User-tabellen ska ha kolumnen password_hash (nullable)
```

**Commit:** `feat(db): add passwordHash field to User`

---

## Task 2 — Installera bcrypt

**Objective:** Lägg till bcrypt för lösenordshashning.

**Files:**
- Modify: `packages/backend/package.json`

**Steg 1:**
```bash
cd packages/backend
pnpm add bcrypt
pnpm add -D @types/bcrypt
```

**Steg 2:** Verifiera att `pnpm build` fortfarande är grön.

**Commit:** `chore(deps): add bcrypt`

---

## Task 3 — Passport-setup: serializers + strategier

**Objective:** Skapa `src/lib/passport.ts` som konfigurerar passport-local och (optionell) passport-google-oauth20.

**Files:**
- Create: `packages/backend/src/lib/passport.ts`

```typescript
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import bcrypt from 'bcrypt';
import prisma from '../db/prisma';

// ── Serialisering ─────────────────────────────────────────────────────────────
passport.serializeUser((user: Express.User, done) => {
  done(null, (user as { id: string }).id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, isAdmin: true },
    });
    done(null, user ?? false);
  } catch (err) {
    done(err);
  }
});

// ── Local strategy ────────────────────────────────────────────────────────────
passport.use(
  new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.passwordHash) {
        return done(null, false, { message: 'Fel e-post eller lösenord' });
      }
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        return done(null, false, { message: 'Fel e-post eller lösenord' });
      }
      return done(null, { id: user.id, email: user.email, isAdmin: user.isAdmin });
    } catch (err) {
      return done(err);
    }
  }),
);

// ── Google OAuth strategy (optionell — aktiveras om env-variabler finns) ──────
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL } = process.env;

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL ?? '/api/v1/auth/google/callback',
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) return done(new Error('Google-profil saknar e-post'));
          const user = await prisma.user.upsert({
            where: { email },
            create: { email },
            update: {},
            select: { id: true, email: true, isAdmin: true },
          });
          return done(null, user);
        } catch (err) {
          return done(err as Error);
        }
      },
    ),
  );
}

export default passport;
```

**Commit:** `feat(auth): configure passport local + google strategies`

---

## Task 4 — Auth-router

**Objective:** Skapa `src/routes/auth.ts` med login, logout, me, google-endpoints.

**Files:**
- Create: `packages/backend/src/routes/auth.ts`

```typescript
import { Router } from 'express';
import passport from '../lib/passport';

const router = Router();

// POST /api/v1/auth/login
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err: unknown, user: Express.User | false, info: { message: string } | undefined) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ error: info?.message ?? 'Inloggning misslyckades' });
    req.logIn(user, (loginErr) => {
      if (loginErr) return next(loginErr);
      return res.json(user);
    });
  })(req, res, next);
});

// POST /api/v1/auth/logout
router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.json({ ok: true });
  });
});

// GET /api/v1/auth/me
router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Ej inloggad' });
  res.json(req.user);
});

// Google OAuth — bara aktiv om strategin är konfigurerad
router.get('/google', passport.authenticate('google', { scope: ['email', 'profile'] }));

router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    res.redirect(process.env.FRONTEND_URL ?? '/');
  },
);

export default router;
```

**Commit:** `feat(auth): add auth router (login/logout/me/google)`

---

## Task 5 — Ersätt requireAuth-middleware

**Objective:** `requireAuth` ska kontrollera `req.user` (satt av Passport/session) istället för att verifiera Firebase Bearer-token.

**Files:**
- Modify: `packages/backend/src/middleware/auth.ts`

Ersätt hela filen:

```typescript
import { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      isAdmin: boolean;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Ej autentiserad' });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Ej autentiserad' });
    return;
  }
  if (!req.user.isAdmin) {
    res.status(403).json({ error: 'Åtkomst nekad' });
    return;
  }
  next();
}
```

**Commit:** `feat(auth): requireAuth now uses passport session instead of Firebase token`

---

## Task 6 — Koppla in passport i app.ts

**Objective:** Initiera passport efter session-middleware och registrera auth-routern.

**Files:**
- Modify: `packages/backend/src/app.ts`

Lägg till efter `buildSessionMiddleware()`:
```typescript
import passport from './lib/passport';
import authRouter from './routes/auth';

// efter app.use(buildSessionMiddleware())
app.use(passport.initialize());
app.use(passport.session());

// Ny auth-route (ingen requireAuth här)
app.use('/api/v1/auth', authRouter);
```

**Commit:** `feat(app): initialize passport and mount auth router`

---

## Task 7 — Admin-kommando: sätt lösenord på en användare

**Objective:** Seed-script (eller admin-route) för att sätta lösenord på en befintlig användare, så att lokal inloggning fungerar direkt.

**Files:**
- Create: `packages/backend/src/scripts/set-password.ts`

```typescript
// Användning: pnpm exec ts-node src/scripts/set-password.ts user@example.com hemligt123
import bcrypt from 'bcrypt';
import prisma from '../db/prisma';

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Användning: set-password.ts <email> <lösenord>');
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.update({ where: { email }, data: { passwordHash } });
  console.log(`Lösenord satt för ${user.email}`);
  await prisma.$disconnect();
}

main().catch(console.error);
```

**Commit:** `feat(scripts): add set-password script`

---

## Task 8 — Uppdatera backend-tester

**Objective:** `auth.test.ts` testar nu session-baserad login istället för Firebase-tokens.

**Files:**
- Modify: `packages/backend/src/__tests__/auth.test.ts`

Ta bort Firebase-mock. Testa istället:
- `POST /api/v1/auth/login` utan body → 400/401
- `POST /api/v1/auth/login` med fel lösenord → 401
- `POST /api/v1/auth/login` med rätt lösenord → 200 + user-objekt
- `GET /api/v1/auth/me` utan session → 401
- `GET /api/v1/auth/me` med session → 200 + user
- `POST /api/v1/auth/logout` → 200
- `requireAdmin` returnerar 403 för icke-admin

Testen behöver en riktig DB-anslutning (samma mönster som `prisma.test.ts`).
Skapa testanvändare med bcrypt i `beforeAll`, städa i `afterAll`.

**Commit:** `test(auth): rewrite auth tests for passport-local`

---

## Task 9 — Frontend: ny Login-komponent

**Objective:** Ersätt Firebase-inloggning med e-post/lösenord-formulär.

**Files:**
- Modify: `packages/frontend/src/pages/Login.jsx` → konvertera till `.tsx`

```tsx
import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchAuthState } from '../store';

export function Login() {
  const dispatch = useDispatch();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? 'Inloggning misslyckades');
      return;
    }
    dispatch(fetchAuthState());
  };

  const googleEnabled = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === 'true';

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
      <Card className="p-6 w-80">
        <h1 className="text-2xl font-bold mb-6">Goda Händer Bilpool</h1>
        <form onSubmit={signIn} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="email">E-post</Label>
            <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="password">Lösenord</Label>
            <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <Button type="submit">Logga in</Button>
        </form>
        {googleEnabled && (
          <Button variant="outline" className="mt-3 w-full" onClick={() => { window.location.href = '/api/v1/auth/google'; }}>
            Logga in med Google
          </Button>
        )}
      </Card>
    </div>
  );
}
```

**Commit:** `feat(frontend): replace Firebase login with local auth form`

---

## Task 10 — Frontend: ersätt fetchAuthState

**Objective:** `fetchAuthState` i `store.ts` ska anropa `GET /api/v1/auth/me` istället för `onAuthStateChanged`.

**Files:**
- Modify: `packages/frontend/src/store.ts`

Ersätt `fetchAuthState`-thunken:
```typescript
import { api } from '@/api/client';

export const fetchAuthState = createAsyncThunk(
  'auth/fetchAuthState',
  async (_, { dispatch }) => {
    try {
      const user = await api.get<{ id: string; email: string; isAdmin: boolean }>('/auth/me');
      const users = await dispatch(fetchUsers()).unwrap();
      await Promise.all([
        dispatch(fetchCars()),
        dispatch(fetchSettings()),
        dispatch(fetchDestinations()),
      ]);
      const matched = users.find((u: { email: string }) => u.email === user.email);
      dispatch(setAuthState({
        user: { uid: user.id, email: user.email, user_id: user.id, isAdmin: user.isAdmin },
        isMember: Boolean(matched),
        loading: false,
      }));
    } catch {
      dispatch(setAuthState({ user: null, isMember: false, loading: false }));
    }
  },
);
```

Ta bort `onAuthStateChanged`, `authUnsubscribe` och alla `firebase/auth`-importer från filen.

**Commit:** `feat(frontend): replace Firebase onAuthStateChanged with GET /auth/me`

---

## Task 11 — Frontend: ersätt api/client.ts

**Objective:** `api/client.ts` ska sluta hämta Firebase ID-token — skicka bara cookie (redan `credentials: 'include'`).

**Files:**
- Modify: `packages/frontend/src/api/client.ts`

Ta bort `getToken()`-funktionen och `Authorization`-headern. Behåll `credentials: 'include'` och resten av wrapper-logiken.

**Commit:** `feat(frontend): remove Firebase token from API client`

---

## Task 12 — Ta bort Firebase-beroenden

**Objective:** Rensa ut Firebase SDK och admin-paket när allt är grönt.

**Files:**
- Remove: `packages/frontend/src/db/firebase.ts`
- Modify: `packages/frontend/package.json` — ta bort `firebase`
- Modify: `packages/backend/package.json` — ta bort `firebase-admin`
- Remove: `packages/backend/src/lib/firebase-admin.ts`

```bash
# frontend
cd packages/frontend
pnpm remove firebase

# backend
cd packages/backend
pnpm remove firebase-admin
```

Ta bort alla eventuella kvarvarande `import ... from 'firebase/...'` i frontend-källkod.

**Commit:** `chore: remove Firebase SDK and firebase-admin`

---

## Task 13 — Docker + .env

**Objective:** Säkerställ att nya env-variabler finns dokumenterade och att Docker-bygget passerar.

**Files:**
- Modify: `.env.example` (skapa om den inte finns)

Minsta nödvändiga variabler för lokal körning:
```
DATABASE_URL=postgresql://ghcarpool:ghcarpool@db:5432/ghcarpool
SESSION_SECRET=byt-ut-mig-i-produktion
# Google OAuth (optionellt)
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# GOOGLE_CALLBACK_URL=http://localhost/api/v1/auth/google/callback
FRONTEND_URL=http://localhost
```

Byggtest:
```bash
export DOCKER_HOST=ssh://podman-machine
docker build -f packages/backend/Dockerfile -t ghcarpool-backend-test .
```

**Commit:** `docs: update env.example for passport auth`

---

## Risker och noteringar

- `uid`-fältet i frontend AuthState är Firebase-specifikt (`uid: user.uid`). I Task 10 sätts det till `user.id` (Prisma-id). Kontrollera om `uid` används direkt någonstans i frontend-kod utöver `user_id`.
- `passport-local` kräver att användaren har ett `passwordHash`-fält satt. Befintliga användare skapade via Google OAuth behöver inte ett lösenord — det är OK eftersom `passwordHash` är nullable.
- Google OAuth-flödet är ett server-side redirect. Frontend-komponenten behöver VITE_GOOGLE_AUTH_ENABLED=true i `.env` för att visa Google-knappen.
- `connect-pg-simple` och `express-session` är redan installerade och konfigurerade — sessions fungerar redan, de behöver bara paras ihop med passport.

## Testning efter alla tasks

```bash
# Backend
cd packages/backend && pnpm test

# Frontend
cd packages/frontend && pnpm test

# Docker-build
export DOCKER_HOST=ssh://podman-machine
docker build -f packages/backend/Dockerfile -t ghcarpool-backend-test .
```
