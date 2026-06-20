import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Anslut till Auth-emulatorn i dev om VITE_USE_FIREBASE_EMULATOR !== 'false'
if (
  import.meta.env.MODE === 'development' &&
  import.meta.env.VITE_USE_FIREBASE_EMULATOR !== 'false'
) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
}
