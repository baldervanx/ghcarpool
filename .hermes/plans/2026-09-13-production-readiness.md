# Produktionsberedskap: loggkontroll, en app-container, reverse proxy och OIDC

**Status:** Planerad – fas 1 påbörjad 2026-09-13  
**Utgångspunkt:** `feature/firebase-to-postgres-migration`  
**Relaterad legacy-commit:** `283db8a` på `feature/log-checking`

## Fastställda beslut

- Caddy och Authelia drivs i ett externt infra-repository. Ingen Caddy- eller Authelia-konfiguration ska läggas i detta repository.
- Applikationen får inte hårdkodas till en domän. Publik origin, callback-URL:er och cookie-säkerhet ska vara miljökonfiguration.
- SSO byggs med **OpenID Connect (OIDC)**, där Authelia är identity provider.
- Backup, återställning och release-rollback för PostgreSQL hanteras av infra-repositoryt och ligger utanför applikationens logik.
- `Car.hasLog=false` betyder att fordonet saknar egen körjournal/odometer, exempelvis ett släp. UI ska inte erbjuda körjournalsflöden för det och API:t ska avvisa skapande av resor för fordonet.
- `admin-trips.tsx` var ett tillfälligt Firebase-reparationsverktyg och ska tas bort, inte portas.

## Målarkitektur

```text
Webbläsare
  │ HTTPS
  ▼
Caddy (externt: TLS och reverse proxy)
  │ internt nät
  ▼
ghcarpool-app (Node/Express + byggd React-app)
  │
  ▼
PostgreSQL

Authelia (externt) ── OIDC ──► ghcarpool-app
```

"Två containers" avser applikationen och PostgreSQL. Caddy och Authelia är separat infrastruktur och kan köras som externa tjänster eller ytterligare infra-containers.

## Fas 1 – Porta loggkontroll från Firebase till Prisma/API

### Bakgrund

Commit `283db8a` är en enda commit men bygger på den gamla Firebase-strukturen. Den får inte mergeas eller cherry-pickas direkt. Den används som beteendespecifikation och portas till nuvarande filer under `packages/frontend` och `packages/backend`.

Den relevanta funktionen är:

1. Visa varning om en aktiv bokning följs av en tidigare ologgad bokning på samma bil samma dag.
2. Visa användarens senaste ologgade bokning per bil från de senaste 14 dagarna.
3. Låt sidan för körjournalsregistrering välja den äldsta ologgade, loggbara bokningen för vald bil inom de senaste 14 dagarna och varna om den är från en tidigare dag.
4. Varning när ingen ologgad bokning finns för det valda fordonet.
5. Märk endast vald instans som loggad för enskilda och vanliga återkommande bokningar.
6. Märk samtliga instanser med samma `recurrenceId` för en flerdagsbokning som loggade, atomärt tillsammans med resan.
7. Bevara redan loggade historiska bokningar vid ändring/borttagning av recurrence-serier.

### Backend först: auktoritativ och atomär bokningslänkning

**Berörda filer:**

- `packages/backend/src/routes/trips.ts`
- `packages/backend/src/__tests__/trips.test.ts`
- vid behov `packages/backend/src/lib/serializers.ts` och SSE-publiceringen

Ändra `POST /api/v1/trips` så att en och samma Prisma-transaktion:

1. Validerar indata och hämtar bilen. Svara `400` om `hasLog=false`.
2. Om `bookingId` anges, hämtar bokningen inklusive `DateCarBooking`, användare och relaterade poster.
3. Verifierar att bokningen tillhör `carId`, att den inte redan är loggad och att eventuell `parentId` stämmer med bokningens faktiska förälder. Klientens `parentId` ska aldrig ensamt styra databasuppdatering.
4. Skapar resan efter odometervalideringen.
5. Avgör om den valda `recurrenceId` beskriver en flerdagsbokning genom att läsa seriens bokningsposter. Det finns ingen separat recurrence-modell i Prisma-schemat.
6. Uppdaterar exakt en bokning för enskild/vanlig återkommande bokning, men seriens samtliga poster för en flerdagsbokning.
7. Returnerar vilka `DateCarBooking`-containers som ändrades så att rätt SSE-uppdateringar kan sändas efter committad transaktion.

Nya backendtester ska täcka minst:

- `hasLog=false` avvisas;
- falskt eller felaktigt `bookingId`/`parentId` avvisas utan skapad resa;
- en enskild bokning loggas;
- endast vald dag i en vanlig recurrence loggas;
- alla dagar i en flerdagserie loggas;
- redan loggad bokning avvisas;
- transaktionen lämnar ingen resa efter ett valideringsfel;
- varje ändrad bokningscontainer skickar korrekt SSE-event till berörda användare.

### Frontend: registrera resa och varningar

**Berörda filer:**

- `packages/frontend/src/pages/register-trip.tsx`
- `packages/frontend/src/pages/register-trip.test.tsx`
- `packages/frontend/src/pages/home.tsx`
- lägg till/utöka test för `home.tsx`
- `packages/frontend/src/components/booking-cell.tsx`

`register-trip.tsx` ska:

- söka bokningar för vald bil från idag och högst 14 kalenderdagar bakåt;
- välja äldsta ologgade, loggbara bokning så att resor registreras i ordning;
- exkludera mellanliggande poster i flerdagserier;
- visa datum i den kopplade bokningsetiketten när bokningen inte är från idag;
- visa varning när en gammal bokning loggas;
- visa varning när ingen ologgad bokning hittas;
- inte erbjuda körjournalsregistrering för `hasLog=false`.

`home.tsx` ska:

- visa senaste missade, egna bokning per loggbar bil inom 14 dagar;
- visa en varning på dagens aktiva bokning om närmast föregående bokning på samma bil fortfarande är ologgad;
- inte behandla flerdagsseriens mellanposter som missade resor;
- inte visa körjournalsåtgärder för fordon med `hasLog=false`.

`booking-cell.tsx` och serverns bokningsrutter ska fortsatt behandla `booking.logged` som skrivskyddat. Ändring/borttagning av recurrence-serier måste bevara loggade historiska instanser.

### Ta bort temporärt adminverktyg

Ta bort:

- `packages/frontend/src/pages/admin-trips.tsx`
- `packages/frontend/src/pages/admin-trips.test.tsx`
- dess import och `/admin-trips`-route från `packages/frontend/src/App.jsx`
- eventuell navigationslänk och död admin-API-kod som enbart stödjer verktyget.

Det vanliga, behörighetskontrollerade resadministrationsflödet behålls om det används av andra funktioner.

### Definition of done för fas 1

- Backend- och frontendtesterna ovan passerar.
- `pnpm test`, `pnpm lint` och `pnpm build` passerar.
- Manuell kontroll: skapa en normal recurrence och en flerdagserie, logga båda, uppdatera sidan och verifiera att rätt poster är skrivskyddade.
- Manuell kontroll: skapa ett fordon med `hasLog=false`; bokning ska vara möjlig men körjournalsregistrering ska vara omöjlig i både UI och API.

## Fas 2 – Samlat produktionsimage för frontend och backend

**Berörda delar:** rotens Dockerfile/`docker-compose.yml`, `packages/backend/src/app.ts`, `packages/backend/Dockerfile`, `packages/frontend/Dockerfile`.

1. Skapa ett multi-stage-image som installerar workspace-beroenden, genererar Prisma-klienten, bygger frontend och backend och kopierar frontendens `dist` till runtime-imaget.
2. Låt Express servera statiska filer efter API-routes men före 404-handlern.
3. Lägg SPA-fallback för klientrutter, men aldrig för `/api/*` eller `/health`.
4. Ersätt produktionsservicarna `frontend` och `backend` med `app`. PostgreSQL behålls separat.
5. Ta bort nginx som produktionsberoende. Lokal Vite-proxy behålls för utveckling.
6. Låt migrationskörning vara en kontrollerad deploy/startup-åtgärd och dokumentera dess beteende.

Verifiera `/health`, API-404 som JSON, SPA-direktlänkar, session och SSE i den samlade containern.

## Fas 3 – Proxykompatibilitet utan Caddy-konfiguration här

**Berörda delar:** `packages/backend/src/app.ts`, `packages/backend/src/lib/session.ts`, `.env.example`, `README.md`.

1. Sätt Express `trust proxy` konfigurerbart och dokumentera att det ska aktiveras endast när appen verkligen ligger bakom betrodd proxy.
2. Behåll origin och callback-URL:er helt miljökonfigurerade; ingen domän får hårdkodas.
3. Dokumentera exempelmijö för HTTPS bakom reverse proxy: `COOKIE_SECURE=true`, publik origin och appens interna port.
4. Använd same-origin i produktion: frontend och `/api/v1` publiceras från samma publika origin. Då behövs inte bred CORS i produktion; lokal Vite-origin ska fortsatt stödjas i utveckling.
5. Dokumentera att proxyn måste vidarebefordra långlivade SSE-anslutningar utan olämplig buffring eller kort timeout.

README kan innehålla ett kort, generiskt exempel på nödvändiga proxyegenskaper, men ingen Caddy-konfiguration.

## Fas 4 – OIDC med Authelia

**Berörda delar:** Prisma-schema/migration vid behov, `packages/backend/src/lib/passport.ts`, `packages/backend/src/routes/auth.ts`, `packages/frontend/src/pages/Login.tsx`, tester, `.env.example` och `README.md`.

1. Lägg till en OIDC-strategy parallellt med befintlig local/Google-strategy.
2. Konfigurera issuer, client ID, client secret, redirect URI och scopes via miljövariabler.
3. Använd stabil OIDC-subject + provider som extern identitet. Lägg en migration om detta måste lagras explicit i `User`.
4. Matcha/provisionera lokal användare med en explicit policy. Adminstatus ska fortsatt komma från lokal databas tills gruppmappning är ett separat beslutat arbete.
5. Efter OIDC-callback skapas samma PostgreSQL-session som local login använder.
6. Definiera logout: rensa lokal session och dokumentera att central SSO-session kan finnas kvar hos Authelia.
7. Testa callback, obehörig användare, direktlänk till skyddad route, sessionsutgång och logout.

Appen ska inte lita på identitetsheaders direkt från klienten. Om infra senare använder forward-auth måste appporten fortfarande vara privat och proxyn måste rensa/sätta headers själv; OIDC är den auktoritativa inloggningsvägen.

## Rekommenderad ordning

1. Fas 1: backendregler och tester.
2. Fas 1: frontendflöden och borttagning av tillfällig adminvy.
3. Fas 2: samlat app-image.
4. Fas 3: reverse-proxykompatibilitet och dokumentation.
5. Fas 4: OIDC.
6. Infrastrukturens produktionsreleaseövning, databasbackup och rollback hanteras i infra-repositoryt.

