# Migreringsscript – Firestore → PostgreSQL

Engångsmigreringsscript för att flytta produktionsdata från Firebase/Firestore
till den nya PostgreSQL-databasen. Kan tas bort när migreringen är slutgiltigt
genomförd och verifierad.

---

## Förutsättningar

- `DATABASE_URL` satt i `packages/backend/.env` (eller som miljövariabel)
- En Firebase service account-nyckel (JSON) nedladdad från Firebase Console

### Skaffa service account-nyckel

1. Gå till [Firebase Console](https://console.firebase.google.com) → projekt **ghcarpool-f49f9**
2. Kugghjulet → Project Settings → fliken **Service accounts**
3. Klicka **Generate new private key** → spara JSON-filen
4. Lägg filen som `packages/backend/serviceAccount.json`
   — filen får aldrig committas (kontrollera `.gitignore`)

---

## migrate-from-firestore.ts

Läser samtliga Firestore-samlingar och skriver till Postgres via Prisma.
Alla inserts är `upsert` — skriptet kan köras om utan att skapa dubbletter.

### Samlingar som migreras

| Firestore-samling   | Postgres-tabell    | Notering                                      |
|---------------------|--------------------|-----------------------------------------------|
| `users`             | `User`             | `passwordHash` sätts till `null` (se nedan)   |
| `cars`              | `Car`              |                                               |
| `destinations`      | `Destination`      |                                               |
| `settings`          | `Settings`         | Dokumentet `main` används                     |
| `date-car-bookings` | `DateCarBooking` + `Booking` + `BookingUser` | Nästlad struktur plattas ut |
| `trips`             | `Trip` + `TripUser`|                                               |

### Kör mot staging/kopia först

```bash
# Använd en annan DATABASE_URL för att verifiera mot kopia
DATABASE_URL="postgresql://ghcarpool:***@localhost:5432/ghcarpool_staging" \
SERVICE_ACCOUNT=/path/till/serviceAccount.json \
  pnpm --filter @ghcarpool/backend migrate:***

# Om serviceAccount.json ligger på standardplatsen (packages/backend/serviceAccount.json):
pnpm --filter @ghcarpool/backend migrate:***
```

### Kör mot produktion

```bash
# Kör från monorepo-roten:
pnpm --filter @ghcarpool/backend migrate:***

# Eller direkt i packages/backend/:
cd packages/backend
pnpm migrate:***
```

Förväntat utfall i terminalen:

```
[migrate] Läser från Firestore...
[migrate] Hittade: 8 users, 4 cars, 3 destinations, 1 settings, 312 date-car-bookings, 156 trips
[migrate] Skriver till PostgreSQL...

[migrate] ✓ Klar!
  Migrerade: 8 users
  Migrerade: 4 cars
  Migrerade: 3 destinations
  Migrerade: 1 settings
  Migrerade: 312 date-car-bookings
  Migrerade: 487 bookings
  Migrerade: 156 trips

[migrate] OBS: Migrerade användare saknar lösenord (passwordHash = null).
  Sätt lösenord manuellt via: node dist/scripts/set-password.js <email> <lösenord>
```

### Varningar i utskriften

Rader som börjar med `[migrate] Hoppar över ...` är förväntade om det finns
references i Firestore som inte har något matchande dokument (t.ex. en bokning
som pekar på en bil som tagits bort). Dessa rader är inte fel — skriptet skippar
posten och fortsätter.

---

## set-password.ts

Migrerade användare saknar lösenord eftersom Firebase hanterade autentiseringen.
Sätt lösenord för varje användare med detta skript innan de kan logga in.

```bash
# Från monorepo-roten:
pnpm --filter @ghcarpool/backend set-password -- user@example.com nyttlösenord

# Eller direkt i packages/backend/:
cd packages/backend
pnpm set-password -- user@example.com nyttlösenord
```

Skriptet skapar användaren om den inte finns, annars uppdateras enbart `passwordHash`.

---

## Städa upp efteråt

När migreringen är verifierad och alla användare har fått lösenord:

1. Ta bort `packages/backend/serviceAccount.json`
2. Ta bort katalogen `packages/backend/scripts/` (inklusive den här README)
3. Ta bort `firebase-admin` och `tsx` ur `devDependencies` i `packages/backend/package.json`:
   ```bash
   cd packages/backend && pnpm remove firebase-admin tsx
   ```
4. Ta bort skript-entries `migrate:firestore` och `set-password` ur `package.json`
