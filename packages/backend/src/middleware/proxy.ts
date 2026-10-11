import { isIP } from 'node:net';
import type { CorsOptions } from 'cors';

export type TrustProxy = false | number | string[];

export function parseTrustProxy(value = 'false'): TrustProxy {
  if (value === 'false' || value === '0') return false;
  if (/^[1-9]\d*$/.test(value)) {
    const hops = Number(value);
    if (Number.isSafeInteger(hops)) return hops;
  }

  const addresses = value.split(',').map(address => address.trim());
  const valid = addresses.every(address => {
    if (['loopback', 'linklocal', 'uniquelocal'].includes(address)) return true;
    const [ip, prefix, ...extra] = address.split('/');
    const version = isIP(ip);
    if (!version || extra.length) return false;
    if (prefix === undefined) return true;
    return /^\d+$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128);
  });
  if (valid) return addresses;
  throw new Error('TRUST_PROXY must be false, a positive hop count, or a comma-separated list of proxy IPs/CIDRs.');
}

export function proxyConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  const cookieSecure = env.COOKIE_SECURE ?? 'false';
  if (!['true', 'false'].includes(cookieSecure)) {
    throw new Error('COOKIE_SECURE must be true or false.');
  }

  const production = env.NODE_ENV === 'production';
  const frontendUrl = env.FRONTEND_URL ?? (production ? '' : 'http://localhost:5173');
  let origin: URL;
  try {
    origin = new URL(frontendUrl);
  } catch {
    throw new Error('FRONTEND_URL must be an absolute HTTP(S) origin.');
  }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('FRONTEND_URL must be an HTTP(S) origin without credentials, path, query, or fragment.');
  }
  if (production && origin.protocol === 'https:' && cookieSecure !== 'true') {
    throw new Error('COOKIE_SECURE=true is required for an HTTPS production FRONTEND_URL.');
  }
  if (cookieSecure === 'true' && origin.protocol !== 'https:') {
    throw new Error('COOKIE_SECURE=true requires an HTTPS FRONTEND_URL.');
  }

  const corsOptions: CorsOptions | undefined = production ? undefined : {
    origin: origin.origin,
    credentials: true,
  };
  return { trustProxy, corsOptions };
}
