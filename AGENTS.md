# AGENTS.md — ghcarpool

Läses av AI-agenter (Hermes, Claude Code, Codex m.fl.) vid sessionsstart.
Håll den uppdaterad när arkitektur eller konventioner förändras.

---

## Projektöversikt

Samåkningssystem för arbetsplatser. Hanterar bilbokningar, körloggar och
statistik för en grupp användare.

**Stack:**
- Monorepo med pnpm workspaces (`packages/backend`, `packages/frontend`)
- Backend: Node 22 + Express + TypeScript + Prisma + PostgreSQL
- Frontend: React 18 + Vite + Redux Toolkit + TailwindCSS + shadcn/ui
- Auth: Passport.js session-baserad (passport-local primär, Google OAuth optionell)
- Testning: Jest + Supertest (backend), Vitest + MSW (frontend)
- Container: podman (alias som docker via DOCKER_HOST=ssh://podman-machine)

Firebase är **helt borttaget** — finns inte i kod, deps eller konfiguration.

---

## Katalogstruktur

```
ghcarpool/
├── packages/
│   ├── backend/
│   │   ├── prisma/
│   │   │   ├── schema.prisma        # Datamodell
│   │   │   └── migrations/          # Körs automatiskt av entrypoint
│   │   └── src/
│   │       ├── app.ts               # Express-app, middleware-ordning
│   │       ├── server.ts            # HTTP-server, lyssnar på PORT
│   │       ├── db/prisma.ts         # Prisma-singleton
│   │       ├── lib/
│   │       │   ├── passport.ts      # LocalStrategy + optionell GoogleStrategy
│   │       │   ├── session.ts       # connect-pg-simple, COOKIE_SECURE-flag
│   │       │   ├── serializers.ts   # Hjälpfunktioner för JSON-svar
│   │       │   └── sse.ts           # SSE-hjälpfunktioner
│   │       ├── middleware/
│   │       │   └── auth.ts          # requireAuth, requireAdmin
│   │       ├── routes/
│   │       │   ├── auth.ts          # POST /login, POST /logout, GET /me
│   │       │   ├── general.ts       # GET /users, /cars, /destinations, /settings
│   │       │   ├── bookings.ts      # CRUD bokningar + SSE-stream
│   │       │   ├── trips.ts         # CRUD körloggar + SSE-stream
│   │       │   └── admin.ts         # Admin-only: export, statistik
│   │       └── scripts/
│   │           ├── seed.ts          # Testdata inkl. passwordHash (dev123)
│   │           └── set-password.ts  # CLI: sätt lösenord på befintlig user
│   └── frontend/
│       ├── Dockerfile               # node:26-alpine builder + nginx:1.27-alpine
│       ├── nginx.conf               # HTTP på 80, include https.conf
│       ├── docker-nginx-setup.sh    # Entrypoint: aktiverar HTTPS om cert finns
│       └── src/
│           ├── api/client.ts        # fetch-wrapper, credentials:'include', ApiError
│           ├── store.ts             # Redux store, fetchAuthState via GET /auth/me
│           ├── db/
│           │   ├── use-listen-to-trips.ts    # SSE-hook
│           │   └── use-listen-to-bookings.ts # SSE-hook
│           └── pages/
│               ├── Login.tsx        # E-post/lösenord-formulär
│               ├── home.tsx         # Startsida, bokningsöversikt
│               ├── book-trip.tsx    # Skapa/redigera bokning
│               ├── booking-overview.tsx
│               ├── register-trip.tsx
│               ├── TripLog.jsx
│               └── admin-trips.tsx
├── docker-compose.yml
├── .env.example                     # Mall — kopiera till .env
├── .env.dev                         # Färdig backend-config för lokal dev
└── pnpm-workspace.yaml              # bcrypt i allowBuilds + onlyBuiltDependencies
```

---

## Auth-flöde

```
POST /api/v1/auth/login  { email, password }
  → Passport LocalStrategy → bcrypt.compare → req.logIn()
  → Set-Cookie: connect.sid  (HttpOnly, SameSite=Lax)
  → 200 { id, email, isAdmin }  |  401

GET /api/v1/auth/me
  → session deserialiseras → 200 { id, email, isAdmin }  |  401

POST /api/v1/auth/logout
  → req.logout() → session raderas → 200 { ok: true }
```

- Sessioner lagras i PostgreSQL-tabellen `session` (via connect-pg-simple)
- `requireAuth` / `requireAdmin` i `src/middleware/auth.ts` — kontrollerar `req.user`
- Google OAuth aktiveras automatiskt om `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` finns i env
- `COOKIE_SECURE=true` krävs endast vid HTTPS — **aldrig** vid HTTP

---

## API-prefix

Alla API-routes har prefixet `/api/v1/`. Frontend-bundeln byggs med
`VITE_API_URL=/api/v1` (inbakat i JS vid Docker-build via `--build-arg`).
Nginx proxar `/api/` → `http://backend:3001`.

---

## Databas — Prisma

Modeller: `User`, `Session`, `Car`, `Destination`, `Settings`,
`DateCarBooking`, `Booking`, `BookingUser`, `Trip`, `TripUser`

Viktiga detaljer:
- `User.passwordHash String?` — null för Google-only-användare
- `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` — krävs för Alpine
- Migrationer körs automatiskt av backend-entrypoint vid containerstart
- Ny migration: `cd packages/backend && pnpm prisma migrate dev --name <namn>`

---

## Miljövariabler

### docker-compose (rot-`.env`)
| Variabel | Default | Beskrivning |
|---|---|---|
| `POSTGRES_USER` | `ghcarpool` | DB-användare |
| `POSTGRES_PASSWORD` | — | **Obligatorisk** |
| `POSTGRES_DB` | `ghcarpool` | DB-namn |
| `POSTGRES_EXPOSE_PORT` | *(tom)* | Sätt `5432` för att exponera DB mot värddatorn |
| `SESSION_SECRET` | — | **Obligatorisk**, minst 32 tecken |
| `FRONTEND_URL` | `http://localhost` | CORS-origin + OAuth-redirect-bas |
| `APP_PORT` | `80` | HTTP-port på värddatorn |
| `HTTPS_PORT` | *(tom)* | Sätt `443` + lägg cert i `CERTS_DIR` |
| `CERTS_DIR` | *(tom)* | Katalog med `cert.pem` + `key.pem` |
| `COOKIE_SECURE` | `false` | Sätt `true` om HTTPS används |
| `GOOGLE_CLIENT_ID` | *(tom)* | Aktiverar Google OAuth om satt |
| `GOOGLE_CLIENT_SECRET` | *(tom)* | — |
| `VITE_GOOGLE_AUTH_ENABLED` | `false` | Visar Google-knapp i Login.tsx |

### packages/backend/.env (lokal dev)
Kopiera `.env.dev` → `packages/backend/.env`. Innehåller `DATABASE_URL`,
`SESSION_SECRET`, `FRONTEND_URL`, `PORT`, `NODE_ENV`.

---

## Kommandon

### Lokal dev (utan Docker)
```bash
# PostgreSQL måste köras lokalt på port 5432
cp .env.dev packages/backend/.env

# Backend
cd packages/backend
pnpm dev          # ts-node-dev, hot-reload
pnpm build        # tsc → dist/
pnpm test         # Jest --runInBand --forceExit
pnpm prisma studio

# Frontend
cd packages/frontend
pnpm dev          # Vite dev-server på :5173
pnpm build        # Vite → dist/
pnpm test         # Vitest
```

### Seed-data
```bash
# Mot lokal DB (efter pnpm build i backend):
cd packages/backend && node dist/scripts/seed.js

# Mot körande Docker-stack:
docker exec ghcarpool_backend_1 node packages/backend/dist/scripts/seed.js
```
Alla seed-användare får lösenordet `dev123`.

### Sätt lösenord på befintlig användare
```bash
# Lokalt:
cd packages/backend && node dist/scripts/set-password.js user@example.com nyttlösenord

# I container:
docker exec ghcarpool_backend_1 \
  node packages/backend/dist/scripts/set-password.js user@example.com nyttlösenord
```

### Docker / Podman
```bash
export DOCKER_HOST=ssh://podman-machine   # Alltid när docker-kommandon körs

# Bygg och starta om hela stacken:
docker build -f packages/backend/Dockerfile  -t ghcarpool_backend  .
docker build -f packages/frontend/Dockerfile -t ghcarpool_frontend \
  --build-arg VITE_API_URL=/api/v1 .

# Starta om en enskild container:
docker restart ghcarpool_backend_1

# OBS: Efter backend-restart måste frontend också startas om
# (nginx cachar DNS-uppslag vid start — ny container-IP ger 502)
docker restart ghcarpool_frontend_1

# Loggar:
docker logs ghcarpool_backend_1 --tail 50
docker logs ghcarpool_frontend_1 --tail 20

# Exec in i container:
docker exec -it ghcarpool_backend_1 sh
docker exec ghcarpool_db_1 psql -U ghcarpool -d ghcarpool
```

---

## Kända fallgropar

**pnpm:**
- pnpm v11 ignorerar `"pnpm"`-fältet i `package.json` — använd `pnpm-workspace.yaml`
  för `onlyBuiltDependencies` och `allowBuilds`. `bcrypt` kräver detta.
- `ts-node` är inte installerat — använd `ts-node-dev` (dev) eller `node dist/...` (prod).
- Frontend-tester kräver `setupFiles: ['dotenv/config']` i jest.config.ts.
  Backend-tester kräver `--forceExit`.

**Docker/Podman:**
- Containrar körs på remote via `DOCKER_HOST=ssh://podman-machine`.
  `docker compose -f` fungerar **inte** — använd `docker build` + `docker restart`.
- nginx cachar DNS vid uppstart. Om backend-containern byts ut (ny IP) ger nginx 502.
  Fix: `docker restart ghcarpool_frontend_1`.
- `pgdata`-volymen behåller lösenordet från första körning. `POSTGRES_PASSWORD` i env
  påverkar inte en befintlig volym. Fix: `ALTER USER ghcarpool PASSWORD '...'` via psql.

**Session-cookie:**
- `COOKIE_SECURE=true` kräver HTTPS. Sätt det aldrig vid HTTP — sessionen bryts.
- `SameSite=Lax` + `credentials: 'include'` i fetch — krävs för att cookien ska skickas.

**HTTPS (optionellt):**
```bash
mkdir -p certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/key.pem -out certs/cert.pem -subj "/CN=localhost"
# Sätt sedan i .env: HTTPS_PORT=443, CERTS_DIR=./certs, COOKIE_SECURE=true
```

**Prisma på Alpine:**
- `binaryTargets` i schema.prisma måste inkludera `linux-musl-openssl-3.0.x`.
- Alpine OpenSSL: 3.5.x — matchar `openssl-3.0.x`-target.

---

## Testning

### Backend (Jest + Supertest)
```bash
cd packages/backend && pnpm test
```
- Tester i `src/__tests__/` — kräver lokal PostgreSQL (från `DATABASE_URL` i `.env`)
- `setupFiles: ['dotenv/config']` laddar `.env` automatiskt
- `--forceExit` krävs pga. öppna DB-connections

### Frontend (Vitest + MSW)
```bash
cd packages/frontend && pnpm test
```
- MSW-handlers i `src/test/handlers.ts`
- Inga Firebase-mockar — auth sker via session-cookie

### TypeScript
```bash
cd packages/backend  && pnpm exec tsc --noEmit
cd packages/frontend && pnpm exec tsc --noEmit
```
tsc är auktoritativ — ignorera LSP-fel tills tsc bekräftar.

---

## Utestående buggar (från TODOS.md)

Prioriterade olösta buggar att ta tag i:
- `register-trip`: Hittar inte sista resan korrekt om bilen inte använts på länge
- `book-trip`: Datumformat i "Boka"-fliken — bör använda react-datepicker
- `booking-overview`: Loggade bokningar ska ej kunna redigeras
- `booking-overview`: Ladda mer historik när man scrollar bakåt
- `home`: Gårdagens obokade bokningar ska visas
- Återkommande bokningar: begränsad redigerbarhet saknas fortfarande
- Destinationsskapande: upplevs som förvirrande för användare

---

## Git-historik (senaste commits)

```
324d309 Fix session cookie, optional DB port, optional HTTPS
c3af219 Replace Firebase auth with Passport.js session-based auth
0e4f013 test: täck alla klientanrop, 39/39 gröna
b0d5c19 feat(frontend): ta bort firebase/firestore, MSW-testinfra
accbd5a feat: Dockerfile, docker-compose, nginx, seed-skript, README
```
