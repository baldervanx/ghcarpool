type GoogleVerify = (
  accessToken: string,
  refreshToken: string,
  profile: { id: string; emails?: { value: string; verified?: boolean }[] },
  done: (err: unknown, user?: Express.User | false) => void,
) => Promise<unknown>;

let mockGoogleVerify: GoogleVerify;
const mockGoogleOptions: Record<string, unknown>[] = [];

jest.mock('passport-google-oauth20', () => ({
  Strategy: class {
    name = 'google';
    constructor(options: Record<string, unknown>, verify: GoogleVerify) {
      mockGoogleOptions.push(options);
      mockGoogleVerify = verify;
    }
  },
}));

jest.mock('../db/prisma', () => ({
  __esModule: true,
  default: { user: { upsert: jest.fn(), findUnique: jest.fn() } },
}));

import prisma from '../db/prisma';

const keys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'] as const;
const originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const publicUser = { id: 'NEWUSER', email: 'new-user@example.com', isAdmin: false };
const dbUser = {
  ...publicUser, name: '', shortName: '', commentMandatory: false, passwordHash: null, createdAt: new Date(),
};
const upsert = jest.mocked(prisma.user.upsert);

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = 'test-google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
  process.env.GOOGLE_CALLBACK_URL = 'https://app.example.com/api/v1/auth/google/callback';
  jest.isolateModules(() => require('../lib/passport'));
});

beforeEach(() => {
  upsert.mockReset();
  upsert.mockResolvedValue(dbUser);
});

afterAll(() => {
  for (const key of keys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('existing Google policy remains independent of OIDC', () => {
  it('retains email-based upsert provisioning without adopting OIDC verified-email policy', async () => {
    const done = jest.fn();
    await mockGoogleVerify('test-access-token', 'test-refresh-token', {
      id: 'google-subject', emails: [{ value: publicUser.email, verified: false }],
    }, done);
    expect(upsert).toHaveBeenCalledWith({
      where: { email: publicUser.email },
      create: { id: 'NEWUSER', email: publicUser.email },
      update: {},
      select: { id: true, email: true, isAdmin: true },
    });
    expect(done).toHaveBeenCalledWith(null, dbUser);
    expect(mockGoogleOptions[0]).toEqual({
      clientID: 'test-google-client',
      clientSecret: 'test-google-secret',
      callbackURL: 'https://app.example.com/api/v1/auth/google/callback',
    });
  });

  it('retains an existing user and local admin status without updating the account', async () => {
    const existing = { ...dbUser, id: 'EXISTING', isAdmin: true };
    upsert.mockResolvedValue(existing);
    const done = jest.fn();
    await mockGoogleVerify('test-access-token', 'test-refresh-token', {
      id: 'different-google-subject', emails: [{ value: publicUser.email }],
    }, done);
    expect(upsert.mock.calls[0][0].update).toEqual({});
    expect(done).toHaveBeenCalledWith(null, existing);
  });

  it('keeps missing-email failure without provisioning', async () => {
    const done = jest.fn();
    await mockGoogleVerify('test-access-token', 'test-refresh-token', { id: 'google-subject' }, done);
    expect(done.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('keeps Google optional when either credential is missing', () => {
    const configuredCount = mockGoogleOptions.length;
    delete process.env.GOOGLE_CLIENT_SECRET;
    jest.isolateModules(() => require('../lib/passport'));
    expect(mockGoogleOptions).toHaveLength(configuredCount);
  });
});
