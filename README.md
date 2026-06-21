# ghcarpool

Samåkningssystem för arbetsplatser. Låter användare boka bilar, logga resor och se historik.

## Arkitektur

```
packages/
  frontend/   React 18 + Vite + Redux Toolkit + TailwindCSS + shadcn/ui
  backend/    Node 22 + Express + TypeScript + Prisma ORM
```

- **Auth**: Session-baserad inloggning med e-post + lösenord (Passport.js). Google OAuth är optionellt (styrs av env-variabler). Ingen extern autentiseringstjänst krävs.
- **Databas**: PostgreSQL 17 + Prisma. Alla skrivningar går via backend. Sessioner lagras i databasen.
- **Realtid**: SSE (Server-Sent Events). Backend broadcastar `add/update/remove`-events när data förändras.
- **Deployment**: Docker Compose. nginx serverar frontend och proxar `/api` till backend.

---

## Kom igång — Docker (rekommenderas)

### 1. Förutsättningar

- Docker >= 24 och Docker Compose v2 (eller Podman + podman-compose)
- Inget externt konto krävs

### 2. Konfigurera miljövariabler

```bash
cp .env.example .env
```

Öppna `.env` och fyll i:

| Variabel | Beskrivning |
|---|---|
| `POSTGRES_PASSWORD` | Välj ett starkt lösenord |
| `SESSION_SECRET` | Generera: `openssl rand -hex 32` |
| `FRONTEND_URL` | URL som backend tillåter CORS-anrop från (default `http://localhost`) |
| `APP_PORT` | Porten nginx lyssnar på (default `80`) |

Google OAuth är **frivilligt** — lämna `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` tomma för att hoppa över det.

### 3. Starta

```bash
docker compose up --build -d
```

Appen är nu tillgänglig på http://localhost (eller `APP_PORT` om du ändrat den).

### 4. Skapa första användaren

Första gången behöver du sätta ett lösenord på en befintlig databasanvändare (eller använda seed-scriptet nedan som skapar exempelanvändare med lösenord):

```bash
docker compose exec backend node packages/backend/dist/scripts/set-password.js user@example.com nyttlösenord
```

### 5. Seed-data (valfritt)

Fyll databasen med testdata (bilar, destinationer, inställningar, exempelanvändare och bokningar):

```bash
docker compose exec backend node packages/backend/dist/scripts/seed.js
```

### 6. Stoppa

```bash
docker compose down          # Behåller data i pgdata-volymen
docker compose down -v       # Tar även bort databasen
```

---

## Lokal utveckling (utan Docker)

### Förutsättningar

- Node.js 22
- pnpm >= 9  (`npm install -g pnpm`)
- PostgreSQL 17 (se nedan)

### Starta PostgreSQL

Enklast via Docker:

```bash
docker run -d \
  --name ghcarpool-pg \
  -e POSTGRES_USER=ghcarpool \
  -e POSTGRES_PASSWORD=dev \
  -e POSTGRES_DB=ghcarpool_dev \
  -p 5432:5432 \
  postgres:17-alpine
```

### Installera beroenden

```bash
pnpm install
```

### Konfigurera backend

Kopiera dev-filen direkt (kräver ingen ändring för lokal standardinstallation):

```bash
cp .env.dev packages/backend/.env
```

Om du vill anpassa (annan DB-URL, port osv.) redigerar du `packages/backend/.env`.

### Kör migrationer

```bash
cd packages/backend
pnpm exec prisma migrate dev
```

### Starta dev-servrar

```bash
# Terminal 1 — backend (port 3001, hot-reload via ts-node-dev)
pnpm dev:backend

# Terminal 2 — frontend (port 5173, HMR)
pnpm dev:frontend
```

Vite proxar automatiskt `/api/*` till `http://localhost:3001`.

### Sätta lösenord på en användare (dev)

```bash
cd packages/backend
pnpm exec ts-node src/scripts/set-password.ts user@example.com lösenord123
```

---

## Miljövariabler — referens

### Backend (`packages/backend/.env`)

| Variabel | Obligatorisk | Beskrivning |
|---|---|---|
| `DATABASE_URL` | Ja | PostgreSQL anslutningssträng |
| `SESSION_SECRET` | Ja | Hemlig nyckel för express-session (min 32 tecken) |
| `PORT` | Nej | HTTP-port, default `3001` |
| `NODE_ENV` | Nej | `development` eller `production` |
| `FRONTEND_URL` | Nej | Tillåten CORS-origin, default `http://localhost:5173` |
| `GOOGLE_CLIENT_ID` | Nej | Google OAuth — utelämnas för att inaktivera |
| `GOOGLE_CLIENT_SECRET` | Nej | Google OAuth — utelämnas för att inaktivera |
| `GOOGLE_CALLBACK_URL` | Nej | Google OAuth callback, default `/api/v1/auth/google/callback` |

### Frontend (build-args / `.env.local`)

| Variabel | Beskrivning |
|---|---|
| `VITE_API_URL` | Backend bas-URL, default `/api/v1` (nginx-proxy) |
| `VITE_GOOGLE_AUTH_ENABLED` | Sätt till `true` för att visa Google-knappen i login-formuläret |

---

## Auth-flöde

1. Användaren fyller i e-post + lösenord på `/login`.
2. Frontend POSTar till `POST /api/v1/auth/login`.
3. Passport.js verifierar mot `User.passwordHash` (bcrypt).
4. Vid godkänd inloggning skapar Express en session (lagras i PostgreSQL via `connect-pg-simple`).
5. Alla efterföljande anrop bär automatiskt session-cookien (`credentials: include`).
6. `GET /api/v1/auth/me` returnerar inloggad användare — används av frontend vid sidladdning.
7. `POST /api/v1/auth/logout` förstör sessionen.

---

## API-översikt

Alla skyddade endpoints kräver en aktiv session (cookie).

| Metod | Sökväg | Auth | Beskrivning |
|---|---|---|---|
| GET | `/health` | — | Hälsokontroll |
| POST | `/api/v1/auth/login` | — | Logga in |
| POST | `/api/v1/auth/logout` | session | Logga ut |
| GET | `/api/v1/auth/me` | session | Inloggad användares profil |
| GET | `/api/v1/auth/google` | — | Starta Google OAuth (om aktiverat) |
| GET | `/api/v1/users` | session | Alla användare |
| GET | `/api/v1/cars` | session | Alla bilar |
| GET | `/api/v1/destinations` | session | Alla destinationer |
| GET | `/api/v1/settings` | session | Appinställningar |
| GET | `/api/v1/bookings` | session | Bokningar (datumintervall) |
| POST | `/api/v1/bookings` | session | Skapa/uppdatera bokning |
| DELETE | `/api/v1/bookings/:id` | session | Ta bort bokning |
| GET | `/api/v1/bookings/stream` | session | SSE-stream för bokningsuppdateringar |
| GET | `/api/v1/trips` | session | Senaste 30 dagars resor |
| POST | `/api/v1/trips` | session | Logga ny resa |
| PUT | `/api/v1/trips/:id` | session | Redigera resa |
| DELETE | `/api/v1/trips/:id` | session | Ta bort resa |
| GET | `/api/v1/trips/stream` | session | SSE-stream för reseuppdateringar |
| GET | `/api/v1/admin/*` | session + isAdmin | Admin-endpoints |

---

## Teknisk stack

| Lager | Teknologi |
|---|---|
| Frontend | React 18, Vite 5, Redux Toolkit, TailwindCSS, shadcn/ui, date-fns |
| Backend | Node.js 22, Express 4, TypeScript 5 |
| ORM | Prisma 5 |
| Databas | PostgreSQL 17 |
| Auth | Passport.js (passport-local + optionell passport-google-oauth20) |
| Session | express-session + connect-pg-simple (PostgreSQL) |
| Realtid | SSE (Server-Sent Events) |
| Monorepo | pnpm workspaces |
| Container | Docker + nginx |

---

## Projektstruktur

```
ghcarpool/
├── docker-compose.yml
├── .env.example               # Mall för produktion/compose
├── .env.dev                   # Färdig konfiguration för lokal dev
├── package.json               # pnpm workspace root
├── pnpm-workspace.yaml
├── packages/
│   ├── backend/
│   │   ├── Dockerfile
│   │   ├── docker-entrypoint.sh   # Kör migrate deploy + startar server
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   └── src/
│   │       ├── app.ts             # Express-app + middleware
│   │       ├── server.ts          # HTTP-server entry point
│   │       ├── db/prisma.ts       # PrismaClient singleton
│   │       ├── lib/
│   │       │   ├── passport.ts    # LocalStrategy + optionell GoogleStrategy
│   │       │   ├── serializers.ts
│   │       │   ├── session.ts
│   │       │   └── sse.ts
│   │       ├── middleware/
│   │       │   └── auth.ts        # requireAuth + requireAdmin
│   │       ├── routes/
│   │       │   ├── auth.ts        # /auth/login, /logout, /me, /google
│   │       │   ├── admin.ts
│   │       │   ├── bookings.ts
│   │       │   ├── general.ts
│   │       │   └── trips.ts
│   │       └── scripts/
│   │           ├── seed.ts        # Seed-data
│   │           └── set-password.ts # Sätt lösenord på befintlig användare
│   └── frontend/
│       ├── Dockerfile
│       ├── nginx.conf
│       └── src/
│           ├── api/               # REST-klient (client.ts, bookings.ts …)
│           ├── db/                # SSE-hooks (use-listen-to-*.ts)
│           ├── pages/
│           ├── components/
│           └── store.ts           # Redux store
```
