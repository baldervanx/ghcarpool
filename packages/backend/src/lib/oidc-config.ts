export interface OidcSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
}

function absoluteUrl(value: string, key: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be an absolute URL`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${key} must be an HTTPS URL without credentials, query or fragment`);
  }
  return value;
}

export function readOidcSettings(env: NodeJS.ProcessEnv = process.env): OidcSettings | null {
  const keys = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI'] as const;
  if (!keys.some((key) => env[key])) return null;
  if (keys.some((key) => !env[key]?.trim())) {
    throw new Error(`OIDC requires ${keys.join(', ')}`);
  }
  const scopes = [...new Set((env.OIDC_SCOPES ?? 'openid email profile').trim().split(/\s+/))];
  if (!scopes.includes('openid') || !scopes.includes('email')) {
    throw new Error('OIDC_SCOPES must include openid and email');
  }
  return {
    issuer: absoluteUrl(env.OIDC_ISSUER!, 'OIDC_ISSUER'),
    clientId: env.OIDC_CLIENT_ID!,
    clientSecret: env.OIDC_CLIENT_SECRET!,
    redirectUri: absoluteUrl(env.OIDC_REDIRECT_URI!, 'OIDC_REDIRECT_URI'),
    scopes: scopes.join(' '),
  };
}

export const oidcSettings = readOidcSettings();

export function frontendUrl(path: string): string {
  return new URL(path, process.env.FRONTEND_URL ?? 'http://localhost:5173').href;
}

export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') ||
      /[\\\u0000-\u0020]/.test(value)) return '/home';
  const url = new URL(value, 'https://return.invalid');
  if (url.origin !== 'https://return.invalid' || url.pathname.startsWith('//') ||
      url.pathname === '/login' || url.pathname === '/api' ||
      url.pathname.startsWith('/api/') || url.pathname === '/health') return '/home';
  return `${url.pathname}${url.search}${url.hash}`;
}
