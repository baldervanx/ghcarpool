# ghcarpool

Samåkningssystem för arbetsplatser. Låter användare boka bilar, logga resor och se historik.

## Arkitektur

```
packages/
  frontend/   React 18 + Vite + Redux Toolkit + TailwindCSS + shadcn/ui
  backend/    Node 26 + Express + TypeScript + Prisma ORM
```

- **Auth**: Session-baserad inloggning med e-post + lösenord (Passport.js), optionell Google OAuth och optionell OIDC (t.ex. Authelia). Leverantörer styrs av runtime-env; ingen extern autentiseringstjänst krävs för lokal inloggning.
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
OIDC är också frivilligt: lämna dess fyra kärnvärden tomma i `.env.example` för
att behålla lokal/Google-inloggning utan OIDC. Se OIDC-policyn nedan innan det aktiveras.

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

### Operatörsskript för engångsimport

`./scripts/run-db-scripts.sh migrate` använder verktygen som paketeras i app-imaget
för engångsimport från Firestore. Helpern hittar den körande `app`-servicen via
Compose-labels; använd `COMPOSE_PROJECT_NAME` för rätt projekt eller `CONTAINER_NAME`
för en uttryckligen vald container utan sådana labels. Kontrollera alltid målmiljön.
Lägg credentials i `packages/backend/serviceAccount.json` eller ange
`SERVICE_ACCOUNT_LOCAL`; filen ska aldrig committas och är exkluderad från Docker-build.
Helpern kopierar den till en temporär fil i containern och tar bort kopian vid avslut.
Spara backup enligt infra-repositoryts rutiner före import. Helperns `reset` raderar
data och är aldrig en del av normal release eller startup.

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
| `OIDC_ISSUER` | OIDC: Ja | HTTPS issuer-URL för discovery, exakt som leverantörens issuer |
| `OIDC_CLIENT_ID` | OIDC: Ja | Registrerad konfidentiell OIDC-klient |
| `OIDC_CLIENT_SECRET` | OIDC: Ja | Klienthemlighet; lagra som secret, aldrig i frontend eller Git |
| `OIDC_REDIRECT_URI` | OIDC: Ja | Absolut HTTPS callback: `<publik-origin>/api/v1/auth/oidc/callback` |
| `OIDC_SCOPES` | Nej | Default `openid email profile`; måste inkludera `openid` och `email` |

### Frontend (`.env.local`; fast API-prefix i produktionsbuild)

| Variabel | Beskrivning |
|---|---|
| `VITE_API_URL` | Backend bas-URL, default `/api/v1`; fast same-origin i produktionsimaget |

Inloggningssidan hämtar `{ local, google, oidc }` från `GET /api/v1/auth/config`
vid runtime. Inga `VITE_*`-flaggor styr auth-leverantörer. Ändra backendens env och
starta om appen för att ändra tillgängliga leverantörer; frontend behöver inte byggas om.

---

## Auth-flöde

1. Användaren fyller i e-post + lösenord på `/login`.
2. Frontend POSTar till `POST /api/v1/auth/login`.
3. Passport.js verifierar mot `User.passwordHash` (bcrypt).
4. Vid godkänd inloggning skapar Express en session (lagras i PostgreSQL via `connect-pg-simple`).
5. Alla efterföljande anrop bär automatiskt session-cookien (`credentials: include`).
6. `GET /api/v1/auth/me` returnerar `200` med inloggad användare eller `{ user: null }` — används av frontend vid sidladdning.
7. `POST /api/v1/auth/logout` förstör den lokala sessionen och rensar sessionscookien.

### OIDC: befintliga användare, ingen auto-provisionering

OIDC finns parallellt med lokal och Google-inloggning. Aktivering kräver alla fyra
värdena `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` och `OIDC_REDIRECT_URI`.
Om samtliga är tomma är OIDC avstängt, även om default `OIDC_SCOPES` är satt.
Delvis kärnkonfiguration stoppar startup. Issuer och redirect URI måste vara HTTPS
utan användarinfo, query eller fragment. `FRONTEND_URL` ska vara appens publika origin.

Exempel för den externa identitetsleverantörens registrerade klient:

```dotenv
OIDC_ISSUER=https://sso.example
OIDC_CLIENT_ID=ghcarpool
OIDC_CLIENT_SECRET=replace_with_idp_client_secret
OIDC_REDIRECT_URI=https://carpool.example/api/v1/auth/oidc/callback
OIDC_SCOPES=openid email profile
```

Använd era riktiga issuer/client-värden och samma publika app-origin som
`FRONTEND_URL`. Klienten använder authorization code flow, `response_mode=query`,
PKCE S256 och `client_secret_basic`. `openid-client` validerar state, nonce,
signatur, issuer, audience och tokenens giltighet; auth-transaktionen lagras
i PostgreSQL-sessionen, gäller i tio minuter och förbrukas vid callback.
Appen hämtar inte identitet från klientens identitetsheaders.

**Länkningspolicy:** ID-tokenets signatur, issuer och subject valideras alltid först.
En första OIDC-inloggning kräver `email` och boolean `email_verified: true` från
kompletta validerade ID-token-claims eller från subject-bunden UserInfo. När en
olänkad identitet saknar e-post eller verifieringsclaim i ID-tokenet hämtar appen
UserInfo med `openid-client.fetchUserInfo` och kräver samma `sub` som i ID-tokenet.
Endast UserInfos e-post/verifiering används tillsammans med redan validerad
issuer+subject; grupper och andra profilfält ändrar inte identitet eller behörighet.
E-postadressen måste matcha en redan befintlig `User.email` exakt. Ingen lokal
användare skapas automatiskt. Explicit `email_verified: false` eller ogiltiga
ID-token-claims kan inte åsidosättas via UserInfo. En komplett verifierad ID-token-
e-post som saknar lokal användare ersätts aldrig med en annan e-post via UserInfo.
Länken sparas i `OidcIdentity` med issuer+subject; samma lokala konto får inte
länkas till en annan subject hos samma issuer via e-post. Senare inloggningar
använder enbart denna stabila identitet, även om e-post ändras eller saknas;
länkade konton kräver inga UserInfo-anrop. Saknad/overifierad e-post, fel subject
eller misslyckad UserInfo för en första länk avvisar inloggningen. Access token
skickas privat från backend till UserInfo över HTTPS i Authorization-headern,
aldrig i URL, frontend, sessionsdata eller loggar.
Kör release-migrationerna, inklusive `20261011000000_add_oidc_identity`, före OIDC-trafik.

Authelias vanliga authorization-code-flöde med `openid email profile` levererar
e-post-claims via UserInfo, inte normalt i ID-tokenet. Appen stöder detta utan
särskild infra-claims-policy; se [Authelias officiella claims-dokumentation](https://www.authelia.com/integration/openid-connect/openid-connect-1.0-claims/index.md).
Ingen Authelia- eller Caddy-konfiguration hör hemma i detta repository.

**Behörigheter:** Adminstatus kommer uteslutande från lokal `User.isAdmin`.
OIDC-grupper och andra provider-claims ger aldrig adminbehörighet. Borttagen lokal
användare får inte längre åtkomst. Googles ursprungliga, separata policy är oförändrad:
Google-strategin kan skapa en lokal användare via e-postbaserad upsert. OIDC-policyn
ovan ändrar inte Google-provisionering.

`GET /api/v1/auth/oidc` startar SSO; callback är
`GET /api/v1/auth/oidc/callback`. Lyckad callback skapar samma Passport-session i
PostgreSQL som lokal inloggning. Misslyckad callback går till `/login?error=oidc`
med ett generiskt fel, utan att visa eller logga tokens/klienthemligheter.
Skyddade direktlänkar sparar pathname, query och fragment i `returnTo`; lokal
och OIDC-inloggning återgår till validerad same-origin sökväg, annars `/home`.
Google-flödet behåller sitt befintliga redirect-beteende.

**Logout är endast lokal:** Appen raderar PostgreSQL-sessionen och sessionscookien,
men loggar inte ut från Authelia eller Google. En central SSO-session kan därför
finnas kvar och nästa SSO-inloggning kan ske utan ny lösenordsfråga. Logga ut hos
identitetsleverantören separat när även den sessionen ska avslutas.

---

## API-översikt

Alla skyddade endpoints kräver en aktiv session (cookie).

| Metod | Sökväg | Auth | Beskrivning |
|---|---|---|---|
| GET | `/health` | — | Hälsokontroll |
| POST | `/api/v1/auth/login` | — | Logga in |
| POST | `/api/v1/auth/logout` | session | Logga ut |
| GET | `/api/v1/auth/me` | — | Profil eller `{ user: null }`, alltid 200 |
| GET | `/api/v1/auth/config` | — | Aktiverade leverantörer, inga secrets |
| GET | `/api/v1/auth/google` | — | Starta Google OAuth (om aktiverat) |
| GET | `/api/v1/auth/oidc` | — | Starta OIDC (om aktiverat) |
| GET | `/api/v1/auth/oidc/callback` | — | Validera OIDC och skapa lokal session |
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
| Auth | Passport.js (local/Google/OIDC) + openid-client |
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
│   │       │   ├── passport.ts    # Local + optionell Google/OIDC
│   │       │   ├── oidc.ts        # State/nonce/PKCE och OIDC-tokenvalidering
│   │       │   ├── oidc-config.ts # Validerad runtime-env och redirect
│   │       │   ├── oidc-user.ts   # Befintlig användare, issuer+subject-länk
│   │       │   ├── serializers.ts
│   │       │   ├── session.ts
│   │       │   └── sse.ts
│   │       ├── middleware/
│   │       │   └── auth.ts        # requireAuth + requireAdmin
│   │       ├── routes/
│   │       │   ├── auth.ts        # /auth/login, /logout, /me, /config, /google, /oidc
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
