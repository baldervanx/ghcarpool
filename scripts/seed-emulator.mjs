/**
 * Seed-skript för Firebase-emulatorn.
 *
 * Skapar testdata med:
 *  - 3 användare (alice, bob, charlie/admin)
 *  - 3 bilar (Bil 1, Bil 2, Bil 3) med hasLog=true
 *  - 2 destinationer
 *  - inställningar (cost_per_km)
 *  - baslinje-resor (ger bilarna ett mätarställningsvärde)
 *  - bokningar som täcker båda varningsscenarion på hemsidan:
 *      Scenario 1 – Idag: Bob 08–11 (ologgad) → Alice 11–17 på Bil 1
 *      Scenario 2 – Igår: Alice 09–15 (ologgad) på Bil 1
 *      Scenario 2 – 3 dagar sedan: Alice 08–18 (ologgad) på Bil 2
 *      Kontrolldata – 5 dagar sedan: Alice (loggad) på Bil 2 → ska EJ visas
 *      Flerdag-test – Bil 3: pågående flerdag-bokning (2 dagar sedan → imorgon)
 *        → mellandagarna ska EJ trigga Scenario 2-varning
 *
 * Förutsättning: Emulatorn körs (firebase emulators:start)
 *
 * Kör med:
 *   npm run seed
 *   – eller –
 *   node scripts/seed-emulator.mjs
 */

// Sätt emulatormiljövariabler INNAN firebase-admin laddas (dynamic import).
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:9090';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

const { initializeApp }             = await import('firebase-admin/app');
const { getFirestore, Timestamp }   = await import('firebase-admin/firestore');
const { getAuth }                   = await import('firebase-admin/auth');

initializeApp({ projectId: 'ghcarpool-f49f9' });

const db   = getFirestore();
const auth = getAuth();

// ── Hjälpfunktioner ──────────────────────────────────────────────────────────

/** yyyy-MM-dd för ett datumoffset från idag. */
function dateStr(daysOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

/** Firestore Timestamp offset från idag (midnatt). */
function tsDate(daysOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(12, 0, 0, 0);
  return Timestamp.fromDate(d);
}

// ── Rensa befintlig emulatordata ─────────────────────────────────────────────

console.log('🗑️  Rensar emulatordata...');
try {
  const resp = await fetch(
    'http://localhost:9090/emulator/v1/projects/ghcarpool-f49f9/databases/(default)/documents',
    { method: 'DELETE' }
  );
  if (resp.ok) {
    console.log('   Klart.');
  } else {
    console.warn('   Kunde inte rensa:', resp.status, await resp.text());
  }
} catch (e) {
  console.warn('   Hoppar över rensning (emulatorn kanske inte stöder det):', e.message);
}

// ── Användare ────────────────────────────────────────────────────────────────

console.log('\n👤 Skapar användare...');

const usersData = [
  { id: 'user_alice',   email: 'alice@test.se',   shortName: 'Alice',   isAdmin: false },
  { id: 'user_bob',     email: 'bob@test.se',     shortName: 'Bob',     isAdmin: false },
  { id: 'user_charlie', email: 'charlie@test.se', shortName: 'Charlie', isAdmin: true  },
];

for (const u of usersData) {
  await db.doc(`users/${u.id}`).set({
    email:     u.email,
    shortName: u.shortName,
    isAdmin:   u.isAdmin,
  });

  try {
    await auth.getUserByEmail(u.email);
    console.log(`   Auth-konto finns redan: ${u.email}`);
  } catch {
    await auth.createUser({ email: u.email, password: 'test123', displayName: u.shortName });
    console.log(`   Skapade: ${u.email}`);
  }
}

// ── Bilar ────────────────────────────────────────────────────────────────────

console.log('\n🚗 Skapar bilar...');
await db.doc('cars/car_bil1').set({ name: 'Bil 1', range: 400, order: 1, hasLog: true });
await db.doc('cars/car_bil2').set({ name: 'Bil 2', range: 350, order: 2, hasLog: true });
await db.doc('cars/car_bil3').set({ name: 'Bil 3', range: 300, order: 3, hasLog: true });
console.log('   Bil 1, Bil 2, Bil 3 skapade.');

// ── Destinationer ─────────────────────────────────────────────────────────────

console.log('\n📍 Skapar destinationer...');
await db.doc('destinations/dest_kontor').set({ name: 'Kontoret',    shortName: 'Kontor', distance: 15 });
await db.doc('destinations/dest_flyg'  ).set({ name: 'Flygplatsen', shortName: 'Flyg',   distance: 30 });
console.log('   Kontoret, Flygplatsen skapade.');

// ── Inställningar ─────────────────────────────────────────────────────────────

console.log('\n⚙️  Skapar inställningar...');
await db.doc('settings/main').set({ cost_per_km: 3.5 });
console.log('   cost_per_km = 3.5');

// ── Dokumentreferenser ────────────────────────────────────────────────────────

const rAlice = db.doc('users/user_alice');
const rBob   = db.doc('users/user_bob');
const rBil1  = db.doc('cars/car_bil1');
const rBil2  = db.doc('cars/car_bil2');
const rBil3  = db.doc('cars/car_bil3');

// ── Baslinjeturer (ger bilarna ett mätarställningsvärde) ─────────────────────

console.log('\n🛣️  Skapar baslinjeturer...');
await db.doc('trips/trip_bil1_base').set({
  car: rBil1, byUser: rAlice, users: [rAlice],
  odo: 10050, distance: 50, cost: 175.0, comment: 'Kontoret',
  timestamp: tsDate(-20),
});
await db.doc('trips/trip_bil2_base').set({
  car: rBil2, byUser: rBob, users: [rBob],
  odo: 20030, distance: 30, cost: 105.0, comment: 'Kontoret',
  timestamp: tsDate(-20),
});
await db.doc('trips/trip_bil3_base').set({
  car: rBil3, byUser: rAlice, users: [rAlice],
  odo: 30080, distance: 80, cost: 280.0, comment: 'Kontoret',
  timestamp: tsDate(-20),
});
console.log('   Bil 1 odo=10050, Bil 2 odo=20030, Bil 3 odo=30080.');

// ── Bokningar ─────────────────────────────────────────────────────────────────

console.log('\n📅 Skapar bokningar...');

// ── IDAG – Bil 1: Bob 08:00–11:00 (OLOGGAD) → Alice 11:00–17:00
// Testar Scenario 1: Alice ser varning "Bokning av Bob har inte loggats"
await db.doc('date-car-bookings/dcb_today_bil1').set({
  car:  rBil1,
  date: dateStr(0),
  bookings: [
    {
      id: 'bk_today_bil1_bob',
      byUser: rBob, users: [rBob],
      startTime: 480, endTime: 660,       // 08:00–11:00
      distance: 15, destination: 'Kontoret',
    },
    {
      id: 'bk_today_bil1_alice',
      byUser: rAlice, users: [rAlice],
      startTime: 660, endTime: 1020,      // 11:00–17:00
      distance: 30, destination: 'Flygplatsen',
    },
  ],
});
console.log(`   ${dateStr(0)} Bil 1: Bob 08–11 (ologgad) + Alice 11–17  ← Scenario 1`);

// ── IDAG – Bil 2: Alice 09:00–12:00 (ingen föregående ologgad bokning)
await db.doc('date-car-bookings/dcb_today_bil2').set({
  car:  rBil2,
  date: dateStr(0),
  bookings: [
    {
      id: 'bk_today_bil2_alice',
      byUser: rAlice, users: [rAlice],
      startTime: 540, endTime: 720,       // 09:00–12:00
      distance: 15, destination: 'Kontoret',
    },
  ],
});
console.log(`   ${dateStr(0)} Bil 2: Alice 09–12`);

// ── IGÅR – Bil 1: Alice 09:00–15:00 (OLOGGAD)
// Testar Scenario 2: "Bokning igår har inte loggats" för Bil 1
await db.doc('date-car-bookings/dcb_yest_bil1').set({
  car:  rBil1,
  date: dateStr(-1),
  bookings: [
    {
      id: 'bk_yest_bil1_alice',
      byUser: rAlice, users: [rAlice],
      startTime: 540, endTime: 900,       // 09:00–15:00
      distance: 15, destination: 'Kontoret',
    },
  ],
});
console.log(`   ${dateStr(-1)} Bil 1: Alice 09–15 (ologgad)  ← Scenario 2`);

// ── 3 DAGAR SEDAN – Bil 2: Alice 08:00–18:00 (OLOGGAD)
// Testar Scenario 2: "Bokning [datum] har inte loggats" för Bil 2
await db.doc('date-car-bookings/dcb_3d_bil2').set({
  car:  rBil2,
  date: dateStr(-3),
  bookings: [
    {
      id: 'bk_3d_bil2_alice',
      byUser: rAlice, users: [rAlice],
      startTime: 480, endTime: 1080,      // 08:00–18:00
      distance: 30, destination: 'Flygplatsen',
    },
  ],
});
console.log(`   ${dateStr(-3)} Bil 2: Alice 08–18 (ologgad)  ← Scenario 2`);

// ── 5 DAGAR SEDAN – Bil 2: Alice (LOGGAD – kontrolldata, ska EJ visas)
// dcb_3d_bil2 är nyare, så denna skulle ändå inte synas i Scenario 2 p.g.a.
// "senaste per bil"-logiken. Men loggad=true säkerställer att den filtreras bort.
const rTripBil2Base = db.doc('trips/trip_bil2_base');
await db.doc('date-car-bookings/dcb_5d_bil2').set({
  car:  rBil2,
  date: dateStr(-5),
  bookings: [
    {
      id: 'bk_5d_bil2_alice',
      byUser: rAlice, users: [rAlice],
      startTime: 600, endTime: 840,       // 10:00–14:00
      distance: 20, destination: 'Kontoret',
      logged: rTripBil2Base,              // loggad ✓
    },
  ],
});
console.log(`   ${dateStr(-5)} Bil 2: Alice 10–14 (loggad ✓ – kontrolldata)`);

// ── PÅGÅENDE FLERDAG – Bil 3: Alice (2 dagar sedan → imorgon)
// Testar att mellandagarna (igår, 2 dagar sedan) EJ triggar Scenario 2-varning,
// och att sista dagen (imorgon) visas korrekt på hemsidan som en aktiv flerdag-bokning.
const multiDayRecId = 'rec_multiday_bil3';
await db.doc(`recurrence/${multiDayRecId}`).set({
  isMultiDay: true,
  recurringStartDate: dateStr(-2),
  recurringEndDate:   dateStr(+1),
});
// Dag 1: 2 dagar sedan – startTid 08:00 → 24:00
await db.doc('date-car-bookings/dcb_md_bil3_d1').set({
  car: rBil3, date: dateStr(-2),
  bookings: [{
    id: 'bk_md_bil3_d1', byUser: rAlice, users: [rAlice],
    startTime: 480, endTime: 1440,
    distance: 0, destination: 'Flygplatsen',
    recurrenceId: multiDayRecId,
  }],
});
// Dag 2: igår – 00:00 → 24:00
await db.doc('date-car-bookings/dcb_md_bil3_d2').set({
  car: rBil3, date: dateStr(-1),
  bookings: [{
    id: 'bk_md_bil3_d2', byUser: rAlice, users: [rAlice],
    startTime: 0, endTime: 1440,
    distance: 0, destination: 'Flygplatsen',
    recurrenceId: multiDayRecId,
  }],
});
// Dag 3: idag – 00:00 → 24:00
await db.doc('date-car-bookings/dcb_md_bil3_d3').set({
  car: rBil3, date: dateStr(0),
  bookings: [{
    id: 'bk_md_bil3_d3', byUser: rAlice, users: [rAlice],
    startTime: 0, endTime: 1440,
    distance: 0, destination: 'Flygplatsen',
    recurrenceId: multiDayRecId,
  }],
});
// Dag 4: imorgon – 00:00 → 16:00 (sista dag, med faktisk distans)
await db.doc('date-car-bookings/dcb_md_bil3_d4').set({
  car: rBil3, date: dateStr(+1),
  bookings: [{
    id: 'bk_md_bil3_d4', byUser: rAlice, users: [rAlice],
    startTime: 0, endTime: 960,
    distance: 80, destination: 'Flygplatsen',
    recurrenceId: multiDayRecId,
  }],
});
console.log(`   ${dateStr(-2)}–${dateStr(+1)} Bil 3: Alice flerdag (pågående) ← Flerdag-test`);

// ── Klart ─────────────────────────────────────────────────────────────────────

console.log('\n✅ Seed-skript klart!\n');
console.log('Logga in på http://localhost:5173 med något av dessa konton:');
console.log('┌─────────────────────┬──────────┬─────────┐');
console.log('│ E-post              │ Lösenord │ Roll    │');
console.log('├─────────────────────┼──────────┼─────────┤');
usersData.forEach(u =>
  console.log(`│ ${u.email.padEnd(19)} │ test123  │ ${u.isAdmin ? 'Admin  ' : 'Medlem '} │`)
);
console.log('└─────────────────────┴──────────┴─────────┘');
console.log('\nFörväntade varningar på hemsidan (inloggad som alice@test.se):');
console.log('  🟡 Scenario 1 – Inuti "Bokat Bil 1"-kortet:');
console.log('     "Bokning av Bob har inte loggats" + Logga-knapp');
console.log('  🟡 Scenario 2 – Ovanför dagsbokningarna:');
console.log('     Bil 1: "Bokning igår har inte loggats" + Logga-knapp');
console.log('     Bil 2: "Bokning [datum] har inte loggats" + Logga-knapp');
console.log('  ✅ Bil 3 flerdag-bokning visas som aktiv (ingen felaktig Scenario 2-varning)');

