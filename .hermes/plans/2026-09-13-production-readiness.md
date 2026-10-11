# Produktionsberedskap: loggkontroll, en app-container, reverse proxy och OIDC

**Status:** Fas 1–3 implementerade och riktat verifierade 2026-10-11; fas 4 återstår att färdigställa som separat commit. Full test-/lint-gate och manuella produktionskontroller återstår.
**Utgångspunkt:** `feature/firebase-to-postgres-migration`  
**Relaterad legacy-commit:** `283db8a` på `feature/log-checking`

## Fastställda beslut

- Caddy och Authelia drivs i ett externt infra-repository. Ingen Caddy- eller Authelia-konfiguration ska läggas i detta repository.
- Applikationen får inte hårdkodas till en domän. Publik origin, callback-URL:er och cookie-säkerhet ska vara miljökonfiguration.
- SSO byggs med **OpenID Connect (OIDC)**, där Authelia är identity provider.
- OIDC kopplar endast befintliga lokala användare: verifierad e-post vid första kopplingen, därefter stabil issuer + subject. Ingen automatisk provisionering eller extern admin-/gruppmappning. Befintlig Google-policy behålls.
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
- `packages/backend/src/routes/bookings.ts`, serializers och SSE-publiceringen
- `packages/backend/prisma/schema.prisma` och migration `20260914000000_restore_recurrence`
- backendtester samt seed-, reset- och Firestore-importskript

Ändra `POST /api/v1/trips` så att en och samma Prisma-transaktion:

1. Validerar indata och hämtar bilen. Svara `400` om `hasLog=false`.
2. Om `bookingId` anges, hämtar bokningen inklusive `DateCarBooking`, användare och relaterade poster.
3. Verifierar att bokningen tillhör `carId`, att den inte redan är loggad och att eventuell `parentId` stämmer med bokningens faktiska förälder. Klientens `parentId` ska aldrig ensamt styra databasuppdatering.
4. Skapar resan efter odometervalideringen.
5. Läser den beständiga `Recurrence.isMultiDay` via bokningens relation; datum och tider får inte avgöra serietyp vid loggning.
6. Uppdaterar exakt en bokning för enskild/vanlig återkommande bokning, men seriens samtliga poster för en flerdagsbokning.
7. Returnerar vilka `DateCarBooking`-containers som ändrades så att rätt SSE-uppdateringar kan sändas efter committad transaktion.

**Återställd recurrence-modell:** `Recurrence` har `id`, nullable `isMultiDay`,
`recurringStartDate`, `recurringEndDate`, `recurringDays`, `createdAt` och
`updatedAt`, samt en FK-relation från `Booking.recurrenceId` med
`ON DELETE RESTRICT`. Veckodagar följer Firebase/frontend: måndag `0` till
söndag `6`. Ny serie kräver `recurrenceId`, explicit boolean `isMultiDay` och
samtliga tre datum-/veckodagsfält i `POST /bookings`. Datum valideras som
kalenderdatum i `yyyy-MM-dd`, start får inte vara efter slut och veckodagar
måste vara unika heltal `0..6`. Vanlig recurrence kräver minst en veckodag;
flerdagsrecurrence tillåter tom lista eftersom alla dagar omfattas.
Bokningsdatum måste ligga inom seriens avsedda intervall och, för vanlig
recurrence, på en vald veckodag.

Befintlig känd serietyp är oföränderlig, även efter att den sista
ologgade instansen tagits bort; utelämnad flagga behåller typen och motstridig
flagga ger `409`. Legacy-typen `null` får fastställas en gång genom en explicit
boolean i `POST /bookings`; därefter är även denna typ oföränderlig. Detta sker
atomärt med en ologgad instansändring eller skapande av en instans, bevarar
loggad historik och uppdaterar metadata/delta-sync/SSE för alla länkade
containers. Utelämnad flagga lämnar legacy-typen okänd; ingen automatisk gissning
görs av API:t. En ändring utan `recurrenceId` behåller länken; explicit
`recurrenceId: null` lossar en ologgad instans utan att radera seriens metadata.
Serieposter måste tillhöra samma fordon. Bil- och serielås skyddar kontrollerna
och relaterade skrivningar inom samma transaktion.

Datum-/veckodagsmetadata får ändras genom att samtliga tre fält skickas
tillsammans. Utelämnade fält behåller den beständiga konfigurationen. Ett nytt
intervall beskriver avsedd framtida serie och får utesluta äldre loggade
instanser utan att ändra eller radera deras bokningsrader, användarlänkar eller
logglänkar. Alla containers med serieposter får nya delta-sync-tidsstämplar och
SSE-snapshots efter commit, inklusive historiska containers vars metadata
ändrats. Kollisions-/valideringsfel rullar tillbaka även seriemetadata.

GET-, save- och SSE-svar har `recurrence: { id, isMultiDay, recurringStartDate,
recurringEndDate, recurringDays }` per återkommande bokning och `recurrence: null`
utan serie. `isMultiDay: true | false | null` finns även som kompatibilitetsalias
på återkommande bokningar. Frontend ska läsa de beständiga gränserna, inte
härleda dem från delvis inlästa serieposter; detta gäller även när sista dagen
slutar `24:00`. Explicit vanlig
heldagsrecurrence loggar bara vald instans; explicit flerdagsrecurrence loggar
alla instanser, även när samtliga tider är `00:00–24:00`.

**Legacy-backfill:** Alla befintliga serie-ID:n, bokningar, användarlänkar och
loggad historik bevaras. Tydliga sammanhängande midnattsgränser med minst en
partiell dag klassificeras som flerdagsbokning; tydliga vanliga tidsintervall
klassificeras som normal recurrence. Tvetydiga heldagsserier, ofullständiga
gränsfragment och ogiltiga/blandade poster får `isMultiDay: null`, aldrig en
gissad boolean. Intervall härleds från min/max lagrat bokningsdatum och
veckodagar från giltiga kalenderdatum, med måndag `0`. Bokningskopplad loggning
av okänd serietyp ger `409` utan
skrivningar eller SSE-event tills användaren fastställt typen explicit.
Firestore-importen återställer originalsamlingen `recurrence`, inklusive
explicit serietyp, avsett intervall, veckodagar och skapande-/ändringstider.
Saknad metadata härleds konservativt från originalets bokningsposter med
varning; tvetydig serietyp förblir okänd. Felaktiga angivna datum-/veckodagsfält
eller tidsstämplar ger explicit importfel i stället för fabricerad metadata.
Betrodd import/seed får lösa en okänd typ från explicit källdata men får inte
skriva över en redan känd motstridig typ.

Nya backendtester ska täcka minst:

- `hasLog=false` avvisas;
- falskt eller felaktigt `bookingId`/`parentId` avvisas utan skapad resa;
- en enskild bokning loggas;
- endast vald dag i en vanlig recurrence loggas;
- alla dagar i en flerdagserie loggas;
- explicit vanlig/flerdags-heldagsserie loggar en respektive alla instanser;
- legacy-serie med okänd typ avvisas med `409` utan skrivningar;
- explicit engångsfastställande av legacy-typ bevarar historik och är atomärt;
- migrationens backfill bevarar historik och relationer utan gissningar;
- beständiga intervall/veckodagar serialiseras i save-, GET- och SSE-svar;
- intervalländring behåller loggad historik och notifierar alla ändrade containers;
- redan loggad bokning avvisas;
- transaktionen lämnar ingen resa efter ett valideringsfel;
- varje ändrad bokningscontainer skickar korrekt SSE-event till berörda användare.

**Utförd backendvalidering:** De fem riktade sviterna för trips, bookings,
bokningsmutationer och recurrence-migration passerar med **174/174 tester**.
Det omfattar engångsfastställande av okänd typ till båda boolean-värdena vid
skapande/ändring, konkurrerande fastställanden, rollback vid kollision och
ogiltigt datum, oförändrad loggad historik och SSE/delta-sync för alla ändrade
containers. Migrationstestet verifierar att exakt samtliga containers med
recurrence får nya tidsstämplar och att övriga containers är oförändrade.
Backendens TypeScript-kontroll och separat typkontroll av Firestore-importen
passerar. Alla migrationer kan appliceras på en ny PostgreSQL 17-databas;
Prisma-schemajämförelsen visar ingen skillnad.

Hela aktuella backendens Jest-körning ger **291 godkända och 1 underkänt test**
(13 av 14 sviter godkända). Befintlig `expenses.test.ts` förväntar `400` utan
`carId`, men nuvarande route/schema tillåter bilfri expense och returnerar
`201`; testets cleanup missar denna rad och får även ett FK-fel för
`Expense_byUserId`. Detta är utanför fasens booking/trip-scope och har inte
ändrats. Den separata befintliga OIDC-protokollsviten passerar med **26/26**
i sitt standardläge; den ingår inte i fas 1.

Databaskörningarna använder endast nya unikt namngivna
`ghcarpool_phase1_test_*`-databaser i separata PostgreSQL-containers med tmpfs,
slumpmässig loopback-port och uttryckligen isolerad miljö utan projektets
`.env`. Containers tas bort efter körningen även vid testfel. Ingen befintlig
eller produktionsdatabas används. Frontendansvarig rapporterar dessutom sju
befintliga lintfel i fem oförändrade JSX-filer; hela definition-of-done för
lint/test är alltså inte grön trots godkänd riktad fas-1-validering.

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
- varna om närmast föregående bokning på samma bil är ologgad, först när dess sluttid har passerat;
- varna och kräva bekräftelse när någon annans bokning loggas;
- läsa beständig serietyp och datumgränser, och blockera loggning av okänd legacy-typ;
- inte erbjuda körjournalsregistrering för `hasLog=false`.

`home.tsx` ska:

- visa senaste missade, egna bokning per loggbar bil inom 14 dagar;
- visa en varning på dagens aktiva bokning om närmast föregående bokning på samma bil fortfarande är ologgad;
- ange bilnamnet i varningen och uppdatera tidsberoende varningar utan sidomladdning;
- inte behandla flerdagsseriens mellanposter som missade resor;
- inte visa körjournalsåtgärder för fordon med `hasLog=false`.

`booking-cell.tsx` och serverns bokningsrutter ska fortsatt behandla `booking.logged` som skrivskyddat. Ändring/borttagning av recurrence-serier måste bevara loggade historiska instanser.

Ologgade historiska bokningar kan ändras utan att nya bokningar kan skapas på
historiska datum. Bokningsformuläret hämtar hela seriens beständiga datumintervall
före ändring, även när endast en del av historiken finns i Redux. Legacy-typ
`null` kan fastställas uttryckligen i formuläret. Cacheformat version 2
ogiltigförklarar äldre månadsdata som saknar recurrence-metadata; initialladdning
och månadsloader använder samma 14-dagars grace-period.

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

**Status 2026-10-11:** Fasens 174 backendregressioner och 68 frontendtester
passerar. Frontendens faktiska applikationstypkontroll och Vite-build passerar.
Alla nio manuella scenarier i `TODO.md` har automatiserad regressionstäckning;
de tidigare manuella anteckningarna har lämnats oförändrade och ska följas upp
manuellt efter driftsättning. Full backend-/frontend-gate blockeras fortfarande
av det befintliga expenses-testet och de sju orelaterade JSX-lintfelen ovan.

## Fas 2 – Samlat produktionsimage för frontend och backend

**Berörda delar:** rotens Dockerfile/`docker-compose.yml`, `packages/backend/src/app.ts`, `packages/backend/Dockerfile`, `packages/frontend/Dockerfile`.

1. Skapa ett multi-stage-image som installerar workspace-beroenden, genererar Prisma-klienten, bygger frontend och backend och kopierar frontendens `dist` till runtime-imaget.
2. Låt Express servera statiska filer efter API-routes men före 404-handlern.
3. Lägg SPA-fallback för klientrutter, men aldrig för `/api/*` eller `/health`.
4. Ersätt produktionsservicarna `frontend` och `backend` med `app`. PostgreSQL behålls separat.
5. Ta bort nginx som produktionsberoende. Lokal Vite-proxy behålls för utveckling.
6. Låt migrationskörning vara en kontrollerad deploy/startup-åtgärd och dokumentera dess beteende.

Verifiera `/health`, API-404 som JSON, SPA-direktlänkar, session och SSE i den samlade containern.

**Status 2026-10-11:** Samlat Node 26-image och produktionsservicarna `app` +
`db` är implementerade. nginx och separata package-Dockerfiles är borttagna.
43 app-/static-regressioner passerar. Migrationer är en separat deploy-åtgärd
som standard; `RUN_MIGRATIONS=true` är ett uttryckligt, felstoppande alternativ
vid startup. Container-/sessions-/SSE-verifiering har gjorts isolerat och
upprepas mot det slutliga imaget när även fas 3–4 är integrerade.

Databasverktyget `scripts/run-db-scripts.sh` använder också den nya app-servicen:
projektets Compose-labels identifierar exakt en container, och `CONTAINER_NAME`
är ett uttryckligt alternativ för manuellt namngivna stackar. Reset använder
kompilerad kod; Firestore-import använder imagets låsta verktyg och korrekta
recurrence-/Prisma-moduler. Temporära credentials tas bort även vid fel.
`bash scripts/tests/run-db-scripts.test.sh` verifierar detta med en fake-runtime,
utan åtkomst till en verklig container eller databas.

## Fas 3 – Proxykompatibilitet utan Caddy-konfiguration här

**Berörda delar:** `packages/backend/src/app.ts`, `packages/backend/src/lib/session.ts`, `.env.example`, `README.md`.

1. Sätt Express `trust proxy` konfigurerbart och dokumentera att det ska aktiveras endast när appen verkligen ligger bakom betrodd proxy.
2. Behåll origin och callback-URL:er helt miljökonfigurerade; ingen domän får hårdkodas.
3. Dokumentera exempelmijö för HTTPS bakom reverse proxy: `COOKIE_SECURE=true`, publik origin och appens interna port.
4. Använd same-origin i produktion: frontend och `/api/v1` publiceras från samma publika origin. Då behövs inte bred CORS i produktion; lokal Vite-origin ska fortsatt stödjas i utveckling.
5. Dokumentera att proxyn måste vidarebefordra långlivade SSE-anslutningar utan olämplig buffring eller kort timeout.

README kan innehålla ett kort, generiskt exempel på nödvändiga proxyegenskaper, men ingen Caddy-konfiguration.

**Status 2026-10-11:** Validerad `TRUST_PROXY`-konfiguration, publik origin och
cookie-säkerhet är miljöstyrda. Same-origin-produktion skickar inga breda
CORS-headers; lokal Vite-origin stöds fortsatt. Appporten binds till loopback
som standard och dokumentationen beskriver privat proxy-nät samt SSE utan
buffring eller kort timeout. 84 app-/static-/proxytester och backendens
typkontroll passerar, inklusive säkra cookies och ignorerade förfalskade
forwarding-headers när avsändaren inte är betrodd.

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
