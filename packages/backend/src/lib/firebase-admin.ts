import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { ServiceAccount } from 'firebase-admin';

// Stöder tre initialiserings-sätt:
//  1. FIREBASE_SERVICE_ACCOUNT_JSON — hel JSON-sträng (CI / env-var)
//  2. GOOGLE_APPLICATION_CREDENTIALS — sökväg till service-account-fil (prod)
//  3. Application Default Credentials (Cloud Run, GKE)

function buildCredential() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    const parsed = JSON.parse(json) as ServiceAccount;
    return cert(parsed);
  }
  return applicationDefault();
}

if (!getApps().length) {
  initializeApp({ credential: buildCredential() });
}

export const firebaseAuth = getAuth();
