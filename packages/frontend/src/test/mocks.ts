/**
 * Ersätter det gamla firebase-mock-baserade mocks.ts.
 * Importeras av vitest setup (setup.ts).
 */
import { setupServer } from 'msw/node';
import { handlers } from './handlers';
import { vi } from 'vitest';

// ── MSW server ────────────────────────────────────────────────────────────────

export const server = setupServer(...handlers);

// ── DOM-polyfills ─────────────────────────────────────────────────────────────

const htmlProto = HTMLElement.prototype as any;
if (!htmlProto.hasPointerCapture)    htmlProto.hasPointerCapture    = () => false;
if (!htmlProto.setPointerCapture)    htmlProto.setPointerCapture    = () => {};
if (!htmlProto.releasePointerCapture) htmlProto.releasePointerCapture = () => {};

const elProto = Element.prototype as any;
if (!elProto.scrollIntoView) elProto.scrollIntoView = () => {};

// ── Firebase Auth mock ────────────────────────────────────────────────────────
// Testerna behöver inte riktiga Firebase-tokens; mockar getAuth + currentUser.

vi.mock('firebase/auth', () => ({
  getAuth:               vi.fn(() => ({
    currentUser: {
      uid: 'u1',
      email: 'anna@example.com',
      getIdToken: vi.fn(() => Promise.resolve('mock-firebase-token')),
    },
  })),
  onAuthStateChanged:    vi.fn((_auth: unknown, cb: (u: unknown) => void) => {
    cb({ uid: 'u1', email: 'anna@example.com' });
    return () => {};
  }),
  signInWithPopup:       vi.fn(() => Promise.resolve({ user: { uid: 'u1' } })),
  signOut:               vi.fn(() => Promise.resolve()),
  GoogleAuthProvider:    vi.fn(),
  connectAuthEmulator:   vi.fn(),
}));

vi.mock('@/db/firebase', () => ({
  app:  {},
  auth: { currentUser: { uid: 'u1', email: 'anna@example.com' } },
}));
