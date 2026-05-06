import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
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
export const db = getFirestore(app);
export const auth = getAuth(app);

// Konfigurera Firestore att använda emulatorn i utvecklingsläge
const isDev = import.meta.env.MODE === 'development';
const shouldUseEmulator =
    isDev && import.meta.env.VITE_USE_FIREBASE_EMULATOR !== 'false';

if (shouldUseEmulator) {
  connectAuthEmulator(auth, 'http://localhost:9099');
  connectFirestoreEmulator(db, 'localhost', 9090);
}
