import '@testing-library/jest-dom';
import './mocks.ts';
import { vi } from 'vitest';

// Crypto randomUUID polyfill (behövs av vissa delar av koden)
if (!(globalThis as any).crypto?.randomUUID) {
  (globalThis as any).crypto = {
    ...(globalThis as any).crypto,
    randomUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replaceAll(/[xy]/g, c => {
      const r = Math.trunc(Math.random() * 16);
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    })
  };
}

// Global navigate mock (kan ersättas per test vid behov)
vi.mock('react-router-dom', async (orig) => {
  const mod = await orig();
  return { ...mod, useNavigate: () => vi.fn() };
});

