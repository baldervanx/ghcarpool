/**
 * Test-setup: MSW server + DOM-polyfills.
 * Firebase-mockar borttagna — auth sker nu via session-cookie.
 */
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

// ── MSW server ────────────────────────────────────────────────────────────────

export const server = setupServer(...handlers);

// ── DOM-polyfills ─────────────────────────────────────────────────────────────

const htmlProto = HTMLElement.prototype as any;
if (!htmlProto.hasPointerCapture)     htmlProto.hasPointerCapture     = () => false;
if (!htmlProto.setPointerCapture)     htmlProto.setPointerCapture     = () => {};
if (!htmlProto.releasePointerCapture) htmlProto.releasePointerCapture = () => {};

const elProto = Element.prototype as any;
if (!elProto.scrollIntoView) elProto.scrollIntoView = () => {};
