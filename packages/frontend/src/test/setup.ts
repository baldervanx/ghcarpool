import '@testing-library/jest-dom';
import { vi, beforeAll, afterAll, afterEach } from 'vitest';
import { server } from './mocks';

// ── MSW livscykel ─────────────────────────────────────────────────────────────
beforeAll(()  => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(()  => server.resetHandlers());
afterAll(()   => server.close());

// ── Crypto polyfill ───────────────────────────────────────────────────────────
const g = globalThis as Record<string, unknown>;
if (!(g.crypto as any)?.randomUUID) {
  g.crypto = {
    ...(g.crypto as object),
    randomUUID: () =>
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replaceAll(/[xy]/g, c => {
        const r = Math.trunc(Math.random() * 16);
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }),
  };
}

// ── Global navigate mock ──────────────────────────────────────────────────────
vi.mock('react-router-dom', async (importOrig) => {
  const mod = await importOrig<typeof import('react-router-dom')>();
  return { ...mod, useNavigate: () => vi.fn() };
});
