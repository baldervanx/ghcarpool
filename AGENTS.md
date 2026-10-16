# AGENTS.md — ghcarpool

Läses av AI-agenter (Hermes, Claude Code, Codex m.fl.) vid sessionsstart.
Håll den uppdaterad när arkitektur eller konventioner förändras.

---

## Projektöversikt

Samåkningssystem för arbetsplatser. Hanterar bilbokningar, körloggar och
statistik för en grupp användare.

**Stack:**
- Monorepo med pnpm workspaces (`packages/backend`, `packages/frontend`)
- Backend: Node 26 i produktion (lokal Node 24 stöds) + Express + TypeScript + Prisma 7 + PostgreSQL
- Frontend: React 18 + Vite + Redux Toolkit + TailwindCSS + shadcn/ui
- Auth: Passport.js session-baserad (local primär, Google OAuth och OIDC optionella)
- Testning: Jest + Supertest (backend), Vitest + MSW (frontend)
- Produktion: två Compose-servicar, `app` (Express + byggd frontend) och `db`
- TLS/reverse proxy och Authelia: externt infra-repository, inga configs här
- Container: Docker/Podman; kontrollera aktiv context/anslutning före kommandon.
  Deploya/starta aldrig om delade remote-servrar utan explicit uppdrag.

Firebase används inte vid normal drift. Engångsimport från äldre data finns i
`packages/backend/scripts/migrate-from-firestore.ts`.

---

## Katalogstruktur

```
ghcarpool/
├── packages/
│   ├── backend/
│   │   ├── prisma/
│   │   │   ├── schema.prisma        # Datamodell
│   │   │   └── migrations/          # Kontrollerad deploy-åtgärd; opt-in vid startup
│   │   ├── docker-entrypoint.sh     # RUN_MIGRATIONS=false som default, exec kommando
│   │   └── src/
│   │       ├── app.ts               # Express-app, middleware-ordning
│   │       ├── server.ts            # HTTP-server, lyssnar på PORT
│   │       ├── db/prisma.ts         # Prisma-singleton
│   │       ├── lib/
│   │       │   ├── passport.ts      # Local + optionell Google/OIDC
│   │       │   ├── oidc.ts          # openid-client: state/nonce/PKCE, validerad callback
│   │       │   ├── oidc-config.ts   # Validerad runtime-env och säkra redirects
│   │       │   ├── oidc-user.ts     # Befintliga användare, issuer+subject-länk
│   │       │   ├── session.ts       # connect-pg-simple, COOKIE_SECURE-flag
│   │       │   ├── serializers.ts   # Hjälpfunktioner för JSON-svar
│   │       │   └── sse.ts           # SSE-hjälpfunktioner
│   │       ├── middleware/
│   │       │   ├── auth.ts          # requireAuth, requireAdmin
│   │       │   ├── frontend.ts      # Statisk frontend + säker HTML SPA-fallback
│   │       │   └── proxy.ts         # Validerad trust proxy, origin och dev-CORS
│   │       ├── routes/
│   │       │   ├── auth.ts          # /login, /logout, /me, /config, /google, /oidc
│   │       │   ├── general.ts       # GET /users, /cars, /destinations, /settings
│   │       │   ├── bookings.ts      # CRUD bokningar + SSE-stream
│   │       │   ├── trips.ts         # CRUD körloggar + SSE-stream
│   │       │   └── admin.ts         # Admin-only: export, statistik
│   │       └── scripts/
│   │           ├── seed.ts          # Testdata inkl. passwordHash (dev123)
│   │           └── set-password.ts  # CLI: sätt lösenord på befintlig user
│   └── frontend/
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
│               └── TripLog.jsx
├── Dockerfile                       # Multi-stage Node 26 Alpine, USER node
├── docker-compose.yml               # app + db; ingen nginx eller publik DB-port
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
  → session deserialiseras → 200 { id, email, isAdmin }  |  200 { user: null }

POST /api/v1/auth/logout
  → req.logout() → session raderas + cookie rensas → 200 { ok: true }
```

- Sessioner lagras i PostgreSQL-tabellen `session` (via connect-pg-simple)
- `requireAuth` / `requireAdmin` i `src/middleware/auth.ts` — kontrollerar `req.user`
- Google OAuth aktiveras automatiskt om `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` finns i env
- Googles befintliga e-postbaserade upsert/provisionering är oförändrad och separat från OIDC.
- `GET /api/v1/auth/config` returnerar `{ local, google, oidc }` vid runtime utan secrets.
  Login-knappar använder detta; inga frontend-buildflaggor styr auth.
- OIDC aktiveras endast med alla fyra core-env-värden. Alla tomma innebär avstängt,
  även med default scopes; partiell core-konfiguration stoppar startup.
- OIDC första länk kräver exakt befintlig lokal e-post och boolean
  `email_verified: true` från validerat ID-token eller subject-bunden UserInfo;
  aldrig auto-provisionering. Senare login använder enbart
  stabil issuer+subject i `OidcIdentity`. Unik issuer+user förhindrar e-postövertagande.
- ID-token valideras först. Endast olänkad identitet med saknad e-post/verifiering
  hämtar UserInfo via `openid-client.fetchUserInfo` med ID-tokenets expected subject.
  Endast UserInfo `email`/`email_verified` används; explicit false/ogiltiga ID-token-
  claims kan inte överstyras. Komplett verifierad ID-token-e-post utan lokal användare
  ersätts inte via UserInfo. Länkade konton kräver ingen UserInfo-tillgänglighet.
- Fel UserInfo-subject, saknad/overifierad e-post eller providerfel avvisar första länk.
  Access token skickas enbart server-side över HTTPS i Authorization-headern;
  aldrig i URL, frontend, session eller loggar. UserInfo-grupper ger inga rättigheter.
- OIDC använder `openid-client`, code flow/query callback, PKCE S256, state och nonce.
  Token-signatur/issuer/audience/giltighet valideras; transaktionen lagras i session,
  förbrukas vid callback och gäller tio minuter. Callback-URL kommer från env, inte headers.
- Admin hämtas endast från lokal DB (`User.isAdmin`), aldrig OIDC-grupper/claims.
  Lyckad OIDC-callback använder samma Passport/PostgreSQL-session som local.
- Skyddade direktlänkar behåller path/query/fragment i `returnTo`; lokal och OIDC-login
  återgår till validerad same-origin path, annars `/home`. Google-redirect är oförändrad.
- Logout avslutar bara lokal session/cookie. Authelia/Google-session kan finnas kvar
  och nästa SSO-login kan ske direkt; central logout görs separat hos leverantören.
- `COOKIE_SECURE=true` krävs endast vid HTTPS — **aldrig** vid HTTP

---

## API-prefix

Alla API-routes har prefixet `/api/v1/`. Produktionsbundeln byggs med fast
`VITE_API_URL=/api/v1`: same-origin frontend/API. Express serverar frontendens
`dist` efter API-routes och före JSON-404. SPA-fallback gäller bara GET/HEAD
med HTML Accept; `/api`, `/health`, dotfiles och saknade assets/filnamn undantas.
Saknad frontend-build stoppar produktionsstartup. Vite-proxyn används fortsatt i dev.

---

## Databas — Prisma

Modeller: `User`, `OidcIdentity`, `Session`, `Car`, `Destination`, `Settings`,
`DateCarBooking`, `Recurrence`, `Booking`, `BookingUser`, `Trip`, `TripUser`

Viktiga detaljer:
- `User.passwordHash String?` — null för Google-only-användare
- `OidcIdentity` har primärnyckel issuer+subject, unik issuer+user och FK till `User`
  med cascade vid användarborttagning. Migration `20261011000000_add_oidc_identity`
  måste deployas innan OIDC används; Google kräver inte denna identitetsmodell.
- `Booking.recurrenceId` är en FK till `Recurrence` med beständig `isMultiDay`,
  datumintervall och veckodagar (måndag 0). Legacy `null`-typ måste fastställas
  explicit innan loggning; känd typ är oföränderlig. Loggad bokningshistorik
  bevaras vid serieändringar och är skrivskyddad.
- Prisma 7 använder `prisma-client` till `src/generated/prisma`, CJS och PG-adapter.
  Klienten genereras av backendens prebuild; genererad källkod ska inte kopieras
  från värddatorn till Docker-build.
- Migrationer körs separat med `docker compose run --rm --no-deps app
  ./node_modules/.bin/prisma migrate deploy` när DB är healthy.
- `RUN_MIGRATIONS=true` opt-in kör migrationer före start; fel stoppar processen.
  Default `false` ändrar aldrig schema vid omstart. Inga automatiska seed/reset.
- Ny migration: `cd packages/backend && pnpm prisma migrate dev --name <namn>`

---

## Miljövariabler

### docker-compose (rot-`.env`)
| Variabel | Default | Beskrivning |
|---|---|---|
| `POSTGRES_USER` | `ghcarpool` | DB-användare |
| `POSTGRES_PASSWORD` | — | **Obligatorisk** |
| `POSTGRES_DB` | `ghcarpool` | DB-namn |
| `SESSION_SECRET` | — | **Obligatorisk**, minst 32 tecken |
| `FRONTEND_URL` | — | **Obligatorisk i produktion**, publik HTTP(S)-origin utan path/query/fragment |
| `APP_PORT` | `3001` | HTTP-port på värddatorn; intern app-port alltid `3001` |
| `APP_BIND_ADDRESS` | `127.0.0.1` | Privat host-bind; containerproxy bör använda privat delat nät |
| `TRUST_PROXY` | `false` | `false`/`0`, positivt hop count, IP/CIDR-lista eller Express-nätalias |
| `COOKIE_SECURE` | `false` | Sätt `true` om HTTPS används |
| `RUN_MIGRATIONS` | `false` | Kontrollerad opt-in till startup-migrationer |
| `GOOGLE_CLIENT_ID` | *(tom)* | Aktiverar Google OAuth om satt |
| `GOOGLE_CLIENT_SECRET` | *(tom)* | — |
| `GOOGLE_CALLBACK_URL` | `/api/v1/auth/google/callback` | Google-flödets befintliga callback |
| `OIDC_ISSUER` | *(tom)* | HTTPS issuer för discovery |
| `OIDC_CLIENT_ID` | *(tom)* | Konfidentiell OIDC-klient |
| `OIDC_CLIENT_SECRET` | *(tom)* | Klienthemlighet, aldrig i frontend/loggar/Git |
| `OIDC_REDIRECT_URI` | *(tom)* | HTTPS `<publik-origin>/api/v1/auth/oidc/callback` |
| `OIDC_SCOPES` | `openid email profile` | Måste innehålla `openid` och `email`; aktiverar inte OIDC ensam |

OIDC issuer/redirect får inte innehålla userinfo, query eller fragment.
Första länken kräver `email` + verifieringsclaim i ID-token eller validerad UserInfo.
Authelias standardclaims för `openid email profile` ligger i UserInfo; appen stöder
det utan särskild infra-claims-policy. Se [officiella Authelia-claims](https://www.authelia.com/integration/openid-connect/openid-connect-1.0-claims/index.md).
Leverantörsbyte kräver ändrad app-env/omstart, inte ombyggd frontend.

### packages/backend/.env (lokal dev)
Kopiera `.env.dev` → `packages/backend/.env`. Innehåller `DATABASE_URL`,
`SESSION_SECRET`, `FRONTEND_URL`, `PORT`, `NODE_ENV`.

`ALLOW_PAST_BOOKINGS=true` är opt-in för historiska testbokningar och gäller endast
med exakt `NODE_ENV=development`. Auth-skyddad `GET /api/v1/config` skickar
`allowPastBookings` med `Cache-Control: no-store`; frontend laddar detta utan
localStorage-cache vid auth-init. API:t blockerar annars nya historiska bokningar
och flytt till andra historiska datum, men bevarar redigering av ologgade bokningar
på ursprungligt datum. Loggade bokningar är alltid skrivskyddade.

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
docker compose exec app node dist/scripts/seed.js
```
Alla seed-användare får lösenordet `dev123`.

### Sätt lösenord på befintlig användare
```bash
# Lokalt:
cd packages/backend && node dist/scripts/set-password.js user@example.com nyttlösenord

# I container:
docker compose exec app node dist/scripts/set-password.js user@example.com nyttlösenord
```

### Docker / Podman
```bash
# Kontrollera att motorn/context är rätt, inte en delad remote-server:
docker context ls
docker compose build app
docker compose up -d db
docker compose ps db       # Vänta på healthy
docker compose run --rm --no-deps app ./node_modules/.bin/prisma migrate deploy
docker compose up -d app   # Endast i godkänd deploy-miljö
docker compose logs --tail 50 app
docker compose exec app sh
```

Backendens låsta verktygsberoenden behålls i imaget för Prisma CLI.
Existerande operatörsskript i `scripts/` ska bevaras men är inte container-entrypoint.
Välj korrekt appservice/arbetskatalog när sådana skript används.

---

## Kända fallgropar

**pnpm:**
- pnpm v11 ignorerar `"pnpm"`-fältet i `package.json` — använd `pnpm-workspace.yaml`
  för `onlyBuiltDependencies` och `allowBuilds`. `bcrypt` kräver detta.
- `ts-node` är inte installerat — använd `ts-node-dev` (dev) eller `node dist/...` (prod).
- Frontend-tester kräver `setupFiles: ['dotenv/config']` i jest.config.ts.
  Backend-tester kräver `--forceExit`.

**Docker/Podman:**
- Container tooling kan peka på en remote/annan VM. Kontrollera anslutningen;
  använd inte gamla backend/frontend-build- eller restart-kommandon.
- `pgdata`-volymen behåller lösenordet från första körning. `POSTGRES_PASSWORD` i env
  påverkar inte en befintlig volym. Fix: `ALTER USER ghcarpool PASSWORD '...'` via psql.

**Session-cookie:**
- `COOKIE_SECURE=true` kräver HTTPS. Sätt det aldrig vid HTTP — sessionen bryts.
- `SameSite=Lax` + `credentials: 'include'` i fetch — krävs för att cookien ska skickas.

**HTTPS bakom extern proxy:**
- `FRONTEND_URL=https://<publik-origin>`, `COOKIE_SECURE=true`, intern HTTP `3001`.
- `TRUST_PROXY` ska matcha proxyadressen Express ser (även efter Docker-NAT).
  `TRUST_PROXY=1` är endast säkert med exakt en betrodd hop på alla vägar och
  spärrad direktåtkomst. `true`/ogiltig config avvisas vid startup.
- Host-proxy: bind loopback. Containerproxy: privat infra-ägt nät/Compose-override,
  `app:3001`, ingen host-publicering. Inga certifikat i appen.
- Proxyn måste rensa klientens forwarding-headers och sätta Host,
  X-Forwarded-Proto och X-Forwarded-For; inga identitetsheaders används för auth.
- Produktion har ingen CORS; dev stöder lokal Vite-origin med credentials.
- SSE ska inte buffras/cachas och kräver lång timeout (t.ex. 3600 s);
  heartbeats skickas var 25:e sekund. Kontrollera upprepade heartbeats och
  ändrings-event med session; initialdata hämtas via REST, inte init-event.
- Lägg aldrig till Caddy/Authelia-konfiguration i detta repository.

**Prisma på Alpine:**
- Installera OpenSSL i build- och runtime-stage för Prisma CLI.
- Generera Prisma 7-klienten före tsc; ändra inte schemat för gamla engine-targets.

---

## Testning

### Backend (Jest + Supertest)
```bash
cd packages/backend && pnpm test
```
- Tester i `src/__tests__/` — kräver lokal PostgreSQL (från `DATABASE_URL` i `.env`)
- `setupFiles: ['dotenv/config']` laddar `.env` automatiskt
- `--forceExit` krävs pga. öppna DB-connections
- OIDC-protokolltester körs via `pnpm test:oidc` och automatiskt i backendens pretest.
  Default använder fixtures; `OIDC_TEST_DATABASE_URL` kan välja en färsk isolerad DB
  på `127.0.0.1` med namn som börjar `ghcarpool_oidc_test_` för riktiga PG-sessioner.
- App/static/proxy-tester kan köras utan DB:
  `pnpm exec jest --config jest.config.ts --runInBand src/__tests__/frontend.test.ts src/__tests__/proxy.test.ts src/__tests__/app.test.ts`.

### Frontend (Vitest + MSW)
```bash
cd packages/frontend && pnpm test
```
- MSW-handlers i `src/test/handlers.ts`
- Inga Firebase-mockar — auth sker via session-cookie

### TypeScript
```bash
cd packages/backend  && pnpm exec tsc --noEmit
cd packages/frontend && pnpm exec tsc --project tsconfig.app.json --noEmit --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --jsx react-jsx
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
