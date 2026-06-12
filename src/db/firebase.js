import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyDTquDT5hvgxOSutHhbdWRLi5TKshiE_yw",
  authDomain: "ghcarpool-f49f9.firebaseapp.com",
  projectId: "ghcarpool-f49f9",
  storageBucket: "ghcarpool-f49f9.appspot.com",
  messagingSenderId: "1005598472656",
  appId: "1:1005598472656:web:c42cf217a2ff84948661d5",
  measurementId: "G-3N16KHM59M"
};

export const app = initializeApp(firebaseConfig);

// Enable an IndexedDB-backed offline cache. With this, onSnapshot serves the
// first snapshot immediately from local cache (metadata.fromCache === true) and
// then updates from the server, so the landing page spinner clears quickly on
// warm/repeat loads instead of waiting for the full multi-month query each time.
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (e) {
  // initializeFirestore throws if called more than once (e.g. HMR) – fall back.
  console.warn('Falling back to default Firestore cache:', e);
  db = getFirestore(app);
}
export { db };

export const auth = getAuth(app);

// Konfigurera Firestore att använda emulatorn i utvecklingsläge
const isDev = import.meta.env.MODE === 'development';
const shouldUseEmulator =
    isDev && import.meta.env.VITE_USE_FIREBASE_EMULATOR !== 'false';

if (shouldUseEmulator) {
  connectAuthEmulator(auth, 'http://localhost:9099');
  connectFirestoreEmulator(db, 'localhost', 9090);
}
