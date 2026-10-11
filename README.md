# ghcarpool

Samåkningssystem för arbetsplatser. Låter användare boka bilar, logga resor och se historik.

## Arkitektur

```
packages/
  frontend/   React 18 + Vite + Redux Toolkit + TailwindCSS + shadcn/ui
  backend/    Node 26 + Express + TypeScript + Prisma ORM
```

- **Auth**: Session-baserad inloggning med e-post + lösenord (Passport.js). Google OAuth är optionellt (styrs av env-variabler). Ingen extern autentiseringstjänst krävs.
- **Databas**: PostgreSQL 17 + Prisma. Alla skrivningar går via backend. Sessioner lagras i databasen.
- **Realtid**: SSE (Server-Sent Events). Backend broadcastar `add/update/remove`-events när data förändras.
- **Deployment**: Två produktionsservicar i Docker Compose: `app` (Express + byggd React-app) och `db` (PostgreSQL). TLS/reverse proxy och Authelia hanteras i ett externt infra-repository; inga sådana konfigurationer finns här.

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
| `POSTGRES_PASSWORD` | Välj ett starkt URL-säkert lösenord, t.ex. `openssl rand -hex 32` |
| `SESSION_SECRET` | Generera: `openssl rand -hex 32` |
| `FRONTEND_URL` | Publik HTTP(S)-origin utan sökväg, query eller fragment; obligatorisk i produktion |
| `APP_PORT` | Publicerad HTTP-port (default `3001`), bunden till `APP_BIND_ADDRESS` (default `127.0.0.1`) |
| `TRUST_PROXY` | Default `false`; välj betrodd proxy-IP/CIDR för HTTPS bakom proxy |
| `COOKIE_SECURE` | `true` för publik HTTPS, `false` endast för HTTP |
| `RUN_MIGRATIONS` | Default `false`; migrationer är en separat deploy-åtgärd |

Google OAuth är **frivilligt** — lämna `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` tomma för att hoppa över det.

### 3. Bygg, migrera och starta

```bash
docker compose build app
docker compose up -d db
# Vänta tills db är healthy innan migrationskommandot körs:
docker compose ps db
docker compose run --rm --no-deps app ./node_modules/.bin/prisma migrate deploy
docker compose up -d app
```

Med HTTP-värdena i `.env.example` är appen tillgänglig på http://localhost:3001.
Appen kör som användaren `node`, med HTTP på port `3001` inuti containern.
Frontend byggs med `VITE_API_URL=/api/v1`; frontend och API använder samma publika origin.
Express serverar statiska filer efter API-routes och erbjuder SPA-fallback endast för
GET/HEAD-navigation som accepterar HTML. `/api`, `/health`, saknade assets och andra
filnamn returnerar aldrig SPA:n. `index.html` revalideras; Vite-assets cachas immutable.
Saknad frontend-build stoppar produktionsstarten med ett tydligt fel.

**Migrationer:** Vanliga starter och omstarter ändrar inte schema. Kör ovanstående
`migrate deploy` en gång per release innan ny app får trafik. `RUN_MIGRATIONS=true`
är en explicit opt-in till migrationer före varje start; migrationsfel stoppar då
starten med felkod. Inget läge kör seed, reset eller `migrate dev`. Vid separat
migrationskörning måste deploy-processen stoppa releasen om kommandot misslyckas.
App-imaget behåller backendens låsta verktygsberoenden för Prisma CLI och operatörsskript.
Backup, återställning och rollback hanteras i infra-repositoryt.

### 4. Skapa första användaren

Första gången behöver du sätta ett lösenord på en befintlig databasanvändare (eller använda seed-scriptet nedan som skapar exempelanvändare med lösenord):

```bash
docker compose exec app node dist/scripts/set-password.js user@example.com nyttlösenord
```

### 5. Seed-data (valfritt)

Fyll databasen med testdata (bilar, destinationer, inställningar, exempelanvändare och bokningar):

```bash
docker compose exec app node dist/scripts/seed.js
```

### 6. Stoppa

```bash
docker compose down          # Behåller data i pgdata-volymen
```

### HTTPS bakom extern reverse proxy

Exakt appkonfiguration för en proxy på samma värddator:

```dotenv
APP_BIND_ADDRESS=127.0.0.1
APP_PORT=3001
FRONTEND_URL=https://carpool.example
TRUST_PROXY=loopback
COOKIE_SECURE=true
RUN_MIGRATIONS=false
```

Byt exempel-origin till er riktiga publika origin. TLS termineras i den externa
proxyn, som ansluter med HTTP till `127.0.0.1:3001`. Inga certifikat monteras i appen.
`TRUST_PROXY` avser källadressen **som Express faktiskt ser**; Docker-NAT kan göra
att en värdproxy syns som en bridge-gateway i stället för loopback. Använd då den
specifika betrodda IP-adressen/CIDR:n, inte `loopback`.

För en containerproxy: anslut `app` till ett privat, externt delat nät via en
infra-ägd Compose-override, ta bort host-publiceringen och använd `app:3001`.
Sätt `TRUST_PROXY` till proxyns IP eller dedikerade nät-CIDR. Publicera inte
appporten eller PostgreSQL mot internet. Compose publicerar ingen DB-port.

`TRUST_PROXY` accepterar `false`/`0`, ett positivt heltal (hop count), IP/CIDR-listor
separerade med kommatecken eller Express-namnen `loopback`, `linklocal`, `uniquelocal`.
`true`, felaktiga CIDR och andra ogiltiga värden stoppar startup.
`TRUST_PROXY=1` är bara säkert om varje möjlig väg går via exakt en betrodd proxy
och direktåtkomst till appporten är spärrad. Breda privata CIDR/nät måste vara
dedikerade till betrodda proxies. Proxyn ska rensa klientens forwarding-headers
och sätta korrekt `Host`, `X-Forwarded-Proto` och `X-Forwarded-For`.
Appen litar inte på identitetsheaders. Befintliga auth-routes behålls.

Produktion skickar inga CORS-headers: browsern använder same-origin frontend/API.
Utveckling behåller credentialed CORS för `FRONTEND_URL` (default lokal Vite
`http://localhost:5173`) och Vites befintliga `/api`-proxy.
HTTPS-origin i produktion kräver `COOKIE_SECURE=true`; felaktiga origins och
icke-boolska cookie-värden stoppar startup. Sessionscookien är HttpOnly och SameSite=Lax.

**SSE:** Proxyn måste skicka `/api/v1/bookings/stream` och `/api/v1/trips/stream`
utan buffring eller cache, spola event direkt och tillåta långlivade anslutningar.
Använd HTTP/1.1 eller motsvarande streamingstöd till appen och en lästimeout med
god marginal över appens heartbeat på 25 sekunder (t.ex. 3600 sekunder).
Bevara session-cookie, query-parametrar och forwarding-headers. Kontrollera med
en inloggad session att `Content-Type: text/event-stream` och upprepade heartbeats
når browsern och att ändringar ger event direkt. Initialdata hämtas via REST;
stream-routes skickar inte ett init-event. Ett lyckat `/health` verifierar inte proxy/SSE eller DB.
Ingen Caddy- eller Authelia-konfiguration ska läggas i detta repository.

---

## Lokal utveckling (utan Docker)

### Förutsättningar

- Node.js 24 eller 26 (produktionsimaget använder 26)
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
| `FRONTEND_URL` | Produktion: Ja | Publik origin; dev-CORS default `http://localhost:5173` |
| `TRUST_PROXY` | Nej | Default `false`; betrodd proxy-IP/CIDR eller fast hop count |
| `COOKIE_SECURE` | Nej | `true` vid publik HTTPS; default `false` |
| `RUN_MIGRATIONS` | Nej | Container-entrypoint: opt-in startup migrationer, default `false` |
| `GOOGLE_CLIENT_ID` | Nej | Google OAuth — utelämnas för att inaktivera |
| `GOOGLE_CLIENT_SECRET` | Nej | Google OAuth — utelämnas för att inaktivera |
| `GOOGLE_CALLBACK_URL` | Nej | Google OAuth callback, default `/api/v1/auth/google/callback` |

### Frontend (build-args / `.env.local`)

| Variabel | Beskrivning |
|---|---|
| `VITE_API_URL` | Backend bas-URL, default `/api/v1`; fast same-origin i produktionsimaget |
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
| Backend | Node.js 26, Express 4, TypeScript 5 |
| ORM | Prisma 7 |
| Databas | PostgreSQL 17 |
| Auth | Passport.js (passport-local + optionell passport-google-oauth20) |
| Session | express-session + connect-pg-simple (PostgreSQL) |
| Realtid | SSE (Server-Sent Events) |
| Monorepo | pnpm workspaces |
| Container | Multi-stage Node-image, Express serverar frontend, extern TLS-proxy |

---

## Projektstruktur

```
ghcarpool/
├── Dockerfile                 # Samlat app-image, bygger frontend + backend
├── docker-compose.yml
├── .env.example               # Mall för produktion/compose
├── .env.dev                   # Färdig konfiguration för lokal dev
├── package.json               # pnpm workspace root
├── pnpm-workspace.yaml
├── packages/
│   ├── backend/
│   │   ├── docker-entrypoint.sh   # Opt-in migrate deploy + exec server/kommando
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
│       └── src/
│           ├── api/               # REST-klient (client.ts, bookings.ts …)
│           ├── db/                # SSE-hooks (use-listen-to-*.ts)
│           ├── pages/
│           ├── components/
│           └── store.ts           # Redux store
```
