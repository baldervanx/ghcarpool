jest.mock('../db/prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    oidcIdentity: { findUnique: jest.fn(), create: jest.fn() },
  },
}));

import prisma from '../db/prisma';
import { Prisma } from '../generated/prisma/client';
import { resolveOidcUser } from '../lib/oidc-user';
import { readOidcSettings, safeReturnTo } from '../lib/oidc-config';

const issuer = 'https://sso.example.com';
const user = { id: 'LOCAL', email: 'local@example.com', isAdmin: false };
const dbUser = {
  ...user, name: '', shortName: '', commentMandatory: false, passwordHash: null, createdAt: new Date(),
};
const claims = { iss: issuer, sub: 'stable-subject', email: user.email, email_verified: true };
const linkedIdentity = { issuer, subject: claims.sub, userId: user.id, user };
const identities = jest.mocked(prisma.oidcIdentity);
const users = jest.mocked(prisma.user);

beforeEach(() => {
  jest.resetAllMocks();
  identities.findUnique.mockResolvedValue(null);
  identities.create.mockResolvedValue({ issuer, subject: claims.sub, userId: user.id });
});

describe('existing-user identity linking', () => {
  it('links only an existing exact verified email and preserves local privileges', async () => {
    users.findUnique.mockResolvedValue(dbUser);
    const adminClaims = { ...claims, groups: ['admins'], isAdmin: true };
    expect(await resolveOidcUser(issuer, adminClaims)).toMatchObject(user);
    expect(identities.create).toHaveBeenCalledWith({
      data: { issuer, subject: claims.sub, userId: user.id },
    });
  });

  it.each([undefined, false, 'true', 1])('rejects email_verified=%s', async (email_verified) => {
    expect(await resolveOidcUser(issuer, { ...claims, email_verified })).toBe(false);
    expect(users.findUnique).not.toHaveBeenCalled();
    expect(identities.create).not.toHaveBeenCalled();
  });

  it.each([undefined, '', ' local@example.com'])('rejects missing or malformed email=%s', async (email) => {
    expect(await resolveOidcUser(issuer, { ...claims, email })).toBe(false);
    expect(identities.create).not.toHaveBeenCalled();
  });

  it('never provisions a nonexistent user', async () => {
    users.findUnique.mockResolvedValue(null);
    expect(await resolveOidcUser(issuer, claims)).toBe(false);
    expect(identities.create).not.toHaveBeenCalled();
  });

  it.each([
    { ...claims, iss: 'https://other.example.com' },
    { ...claims, sub: '' },
    { ...claims, sub: undefined },
  ])('rejects mismatched issuer or missing subject', async (invalid) => {
    expect(await resolveOidcUser(issuer, invalid)).toBe(false);
    expect(identities.findUnique).not.toHaveBeenCalled();
  });

  it('uses the stored identity even when email disappears or points to another user', async () => {
    identities.findUnique.mockResolvedValue(linkedIdentity);
    expect(await resolveOidcUser(issuer, { iss: issuer, sub: claims.sub })).toEqual(user);
    expect(await resolveOidcUser(issuer, { ...claims, email: 'admin@example.com', email_verified: false })).toEqual(user);
    expect(users.findUnique).not.toHaveBeenCalled();
    expect(identities.create).not.toHaveBeenCalled();
  });

  it('rejects email takeover when another subject is already linked to the user', async () => {
    users.findUnique.mockResolvedValue(dbUser);
    identities.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Conflict', {
      code: 'P2002', clientVersion: '7',
    }));
    expect(await resolveOidcUser(issuer, claims)).toBe(false);
  });

  it('accepts a concurrent link only when the same identity won for this local user', async () => {
    users.findUnique.mockResolvedValue(dbUser);
    identities.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(linkedIdentity);
    identities.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Conflict', {
      code: 'P2002', clientVersion: '7',
    }));
    expect(await resolveOidcUser(issuer, claims)).toEqual(user);
  });

  it('surfaces database failures rather than treating them as a successful link', async () => {
    users.findUnique.mockRejectedValue(new Error('Database unavailable'));
    await expect(resolveOidcUser(issuer, claims)).rejects.toThrow('Database unavailable');
  });

  it.each([
    { iss: issuer, sub: claims.sub },
    { ...claims, email: undefined },
    { ...claims, email_verified: undefined },
  ])('loads subject-bound UserInfo only for an incomplete first-link email', async (incomplete) => {
    users.findUnique.mockResolvedValue(dbUser);
    const loadUserInfo = jest.fn().mockResolvedValue({
      sub: claims.sub, email: user.email, email_verified: true,
      iss: 'https://not-the-validated-issuer.example', groups: ['admins'], isAdmin: true,
    });
    expect(await resolveOidcUser(issuer, incomplete, loadUserInfo)).toMatchObject(user);
    expect(loadUserInfo).toHaveBeenCalledWith(claims.sub);
    expect(identities.create).toHaveBeenCalledWith({
      data: { issuer, subject: claims.sub, userId: user.id },
    });
  });

  it('does not mix a signed email with a different UserInfo verification claim', async () => {
    const loadUserInfo = jest.fn().mockResolvedValue({ sub: claims.sub, email_verified: true });
    expect(await resolveOidcUser(issuer, { ...claims, email_verified: undefined }, loadUserInfo)).toBe(false);
    expect(users.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    { sub: 'other-subject', email: user.email, email_verified: true },
    { sub: claims.sub, email: user.email, email_verified: false },
    { sub: claims.sub, email: user.email, email_verified: 'true' },
    { sub: claims.sub, email: user.email },
    { sub: claims.sub, email_verified: true },
  ])('rejects mismatched, unverified or incomplete UserInfo', async (userInfo) => {
    const loadUserInfo = jest.fn().mockResolvedValue(userInfo);
    expect(await resolveOidcUser(issuer, { iss: issuer, sub: claims.sub }, loadUserInfo)).toBe(false);
    expect(users.findUnique).not.toHaveBeenCalled();
    expect(identities.create).not.toHaveBeenCalled();
  });

  it.each([false, 'false', 'true', null])('never overrides explicit ID-token verification %s', async (email_verified) => {
    const loadUserInfo = jest.fn().mockResolvedValue({
      sub: claims.sub, email: user.email, email_verified: true,
    });
    expect(await resolveOidcUser(issuer, { ...claims, email: undefined, email_verified }, loadUserInfo)).toBe(false);
    expect(loadUserInfo).not.toHaveBeenCalled();
  });

  it('does not substitute UserInfo email when complete signed verified email has no local user', async () => {
    users.findUnique.mockResolvedValue(null);
    const loadUserInfo = jest.fn();
    expect(await resolveOidcUser(issuer, claims, loadUserInfo)).toBe(false);
    expect(loadUserInfo).not.toHaveBeenCalled();
    expect(identities.create).not.toHaveBeenCalled();
  });

  it('never fetches UserInfo for a linked identity, even with missing email or explicit false', async () => {
    identities.findUnique.mockResolvedValue(linkedIdentity);
    const loadUserInfo = jest.fn().mockRejectedValue(new Error('Provider unavailable'));
    expect(await resolveOidcUser(issuer, { iss: issuer, sub: claims.sub }, loadUserInfo)).toEqual(user);
    expect(await resolveOidcUser(issuer, { ...claims, email_verified: false }, loadUserInfo)).toEqual(user);
    expect(loadUserInfo).not.toHaveBeenCalled();
  });

  it('surfaces UserInfo failure without linking or looking up a replacement email', async () => {
    const loadUserInfo = jest.fn().mockRejectedValue(new Error('Provider unavailable'));
    await expect(resolveOidcUser(issuer, { iss: issuer, sub: claims.sub }, loadUserInfo))
      .rejects.toThrow('Provider unavailable');
    expect(users.findUnique).not.toHaveBeenCalled();
    expect(identities.create).not.toHaveBeenCalled();
  });
});

describe('OIDC configuration', () => {
  const env = {
    OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'client', OIDC_CLIENT_SECRET: 'test-secret',
    OIDC_REDIRECT_URI: 'https://app.example.com/api/v1/auth/oidc/callback',
  };
  it('is opt-in and defaults to standard OIDC scopes', () => {
    expect(readOidcSettings({})).toBeNull();
    expect(readOidcSettings({ OIDC_SCOPES: 'openid email profile' })).toBeNull();
    expect(readOidcSettings(env)?.scopes).toBe('openid email profile');
  });
  it('fails closed on partial configuration without disclosing secret values', () => {
    expect(() => readOidcSettings({ OIDC_CLIENT_SECRET: 'never-print-this' }))
      .toThrow('OIDC requires OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI');
  });
  it.each([
    { OIDC_ISSUER: 'http://sso.example.com' },
    { OIDC_ISSUER: 'not-a-url' },
    { OIDC_REDIRECT_URI: 'https://user:password@app.example.com/callback' },
    { OIDC_REDIRECT_URI: 'https://app.example.com/callback?secret=value' },
    { OIDC_SCOPES: 'profile' },
  ])('rejects insecure URLs and incomplete scopes', (override) => {
    expect(() => readOidcSettings({ ...env, ...override })).toThrow();
  });
  it.each([
    'https://evil.example', '//evil.example', '/\\evil.example', '/a/..//evil.example',
    '/a/%2e%2e//evil.example', '/login', '/api', '/api/v1/auth/logout', '/health',
  ])
    ('rejects unsafe return targets %s', (target) => {
      expect(safeReturnTo(target)).toBe('/home');
    });
  it('retains a same-origin deep link including query and fragment', () => {
    expect(safeReturnTo('/book-trip?car=ABC#details')).toBe('/book-trip?car=ABC#details');
  });
});
