# ghcarpool

Samåkningssystem för arbetsplatser. Låter användare boka bilar, logga resor och se historik.

## Arkitektur

```
packages/
  frontend/   React 18 + Vite + Redux Toolkit + TailwindCSS + shadcn/ui
  backend/    Node 20 + Express + TypeScript + Prisma ORM
```

- **Auth**: Firebase Authentication (Google Sign-In). Frontend hämtar ID-token; backend verifierar den via Firebase Admin SDK.
- **Databas**: PostgreSQL 17 + Prisma. Alla skrivningar går via backend.
- **Realtid**: SSE (Server-Sent Events) ersätter Firestore `onSnapshot`. Backend broadcastar `add/update/remove`-events när data förändras.
- **Deployment**: Docker Compose. nginx serverar frontend och proxar `/api` till backend.

---

## Kom igång — Docker (rekommenderas)

### 1. Förutsättningar

- Docker >= 24 och Docker Compose v2
- Ett Firebase-projekt med Google Sign-In aktiverat
- En Firebase service-account-nyckel (JSON) för backend

### 2. Konfigurera miljövariabler

```bash
cp .env.example .env
```

Öppna `.env` och fyll i alla värden. Kortfattad guide:

| Variabel | Var hittar du det |
|---|---|
| `POSTGRES_PASSWORD` | Välj ett starkt lösenord |
| `SESSION_SECRET` | Generera: `openssl rand -hex 32` |
| `VITE_FIREBASE_API_KEY` | Firebase Console → Projektinst. → Dina appar → Web-app |
| `VITE_FIREBASE_AUTH_DOMAIN` | Samma ställe, t.ex. `ditt-projekt.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Samma ställe |
| `VITE_FIREBASE_APP_ID` | Samma ställe |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Console → Projektinst. → Tjänstekonton → Generera ny nyckel. Klistra in hela JSON-innehållet som ett enda värde (utan radbrytningar). |

### 3. Starta

```bash
docker compose up --build -d
```

Appen är nu tillgänglig på http://localhost (eller `APP_PORT` om du ändrat den).

### 4. Seed-data (valfritt)

Fyll databasen med testdata (bilar, destinationer, inställningar, exempelanvändare och bokningar):

```bash
docker compose exec backend node packages/backend/dist/scripts/seed.js
```

Eller mot en lokal databas under utveckling:

```bash
cd packages/backend
DATABASE_URL="postgresql://ghcarpool:ditt_lösenord@127.0.0.1:5432/ghcarpool_dev" \
  npx ts-node src/scripts/seed.ts
```

### 5. Stoppa

```bash
docker compose down          # Behåller data i pgdata-volymen
docker compose down -v       # Tar även bort databasen
```

---

## Lokal utveckling (utan Docker)

### Förutsättningar

- Node.js 20
- pnpm >= 9  (`npm install -g pnpm`)
- PostgreSQL 17 (se nedan om du saknar det)

### Starta PostgreSQL

Om du inte har PostgreSQL installerat lokalt kan du köra det via Docker:

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

```bash
cp packages/backend/.env.example packages/backend/.env
# Redigera packages/backend/.env — fyll i DATABASE_URL, SESSION_SECRET osv.
```

### Kör migrationer + generera Prisma-klient

```bash
cd packages/backend
npx prisma migrate dev
npx prisma generate
```

### Starta dev-servrar

```bash
# Terminal 1 — backend (port 3001, hot-reload)
pnpm dev:backend

# Terminal 2 — frontend (port 5173, HMR)
pnpm dev:frontend
```

Vite proxar automatiskt `/api/*` till `http://localhost:3001`.

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
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Ja* | Hela service-account JSON på en rad |
| `GOOGLE_APPLICATION_CREDENTIALS` | Ja* | Alternativ: sökväg till service-account-fil |

\* Minst ett av `FIREBASE_SERVICE_ACCOUNT_JSON` / `GOOGLE_APPLICATION_CREDENTIALS` krävs.

### Frontend (build-args / `.env.local`)

| Variabel | Beskrivning |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase web-app API-nyckel |
| `VITE_FIREBASE_AUTH_DOMAIN` | t.ex. `ditt-projekt.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Firebase projekt-ID |
| `VITE_FIREBASE_APP_ID` | Firebase App ID |
| `VITE_API_URL` | Backend bas-URL, default `/api` (nginx-proxy) |

---

## API-översikt

Alla endpoints (utom `/health`) kräver en giltig Firebase ID-token i headern:

```
Authorization: Bearer <firebase-id-token>
```

| Metod | Sökväg | Beskrivning |
|---|---|---|
| GET | `/health` | Hälsokontroll |
| GET | `/api/v1/me` | Inloggad användares profil |
| GET | `/api/v1/users` | Alla användare |
| GET | `/api/v1/cars` | Alla bilar |
| GET | `/api/v1/destinations` | Alla destinationer |
| GET | `/api/v1/settings` | Appinställningar |
| GET | `/api/v1/bookings` | Bokningar (senaste 90 dagar + 60 framåt) |
| POST | `/api/v1/bookings` | Skapa/uppdatera bokning |
| DELETE | `/api/v1/bookings/:bookingId` | Ta bort bokning |
| GET | `/api/v1/bookings/stream` | SSE-stream för bokningsuppdateringar |
| GET | `/api/v1/trips` | Senaste 30 dagars resor |
| POST | `/api/v1/trips` | Logga ny resa |
| PUT | `/api/v1/trips/:id` | Redigera resa |
| DELETE | `/api/v1/trips/:id` | Ta bort resa |
| GET | `/api/v1/trips/stream` | SSE-stream för reseuppdateringar |
| GET | `/api/v1/admin/*` | Admin-endpoints (kräver isAdmin=true) |

---

## Teknisk stack

| Lager | Teknologi |
|---|---|
| Frontend | React 18, Vite 5, Redux Toolkit, TailwindCSS, shadcn/ui, date-fns |
| Backend | Node.js 20, Express 4, TypeScript 5 |
| ORM | Prisma 5 |
| Databas | PostgreSQL 17 |
| Auth | Firebase Authentication + Firebase Admin SDK |
| Realtid | SSE (Server-Sent Events) |
| Monorepo | pnpm workspaces |
| Container | Docker + nginx |

---

## Projektstruktur

```
ghcarpool/
├── docker-compose.yml
├── .env.example
├── package.json                   # pnpm workspace root
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
│   │       │   ├── firebase-admin.ts
│   │       │   ├── serializers.ts
│   │       │   ├── session.ts
│   │       │   └── sse.ts
│   │       ├── middleware/
│   │       │   └── auth.ts        # requireAuth + requireAdmin
│   │       ├── routes/
│   │       │   ├── admin.ts
│   │       │   ├── bookings.ts
│   │       │   ├── general.ts
│   │       │   └── trips.ts
│   │       └── scripts/
│   │           └── seed.ts        # Seed-data / Firestore-migration
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
