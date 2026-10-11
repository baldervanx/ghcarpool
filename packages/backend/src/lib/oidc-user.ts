import prisma from '../db/prisma';
import { Prisma } from '../generated/prisma/client';

interface IdentityClaims {
  iss?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
}

interface UserInfoClaims {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
}

const userSelect = { id: true, email: true, isAdmin: true } as const;

function validEmail(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value) && value === value.trim();
}

export async function resolveOidcUser(
  issuer: string,
  claims: IdentityClaims,
  loadUserInfo?: (subject: string) => Promise<UserInfoClaims>,
): Promise<Express.User | false> {
  if (claims.iss !== issuer || typeof claims.sub !== 'string' || !claims.sub) return false;
  const identity = { issuer_subject: { issuer, subject: claims.sub } };
  const linked = await prisma.oidcIdentity.findUnique({
    where: identity,
    select: { user: { select: userSelect } },
  });
  if (linked) return linked.user;

  // Only the first link uses email; never reassign a linked account by email.
  // An explicit unverified/malformed ID-token claim cannot be overridden.
  if ((claims.email_verified !== undefined && claims.email_verified !== true) ||
      (claims.email !== undefined && !validEmail(claims.email))) return false;
  let emailClaims: Pick<IdentityClaims, 'email' | 'email_verified'> = claims;
  if (claims.email === undefined || claims.email_verified === undefined) {
    if (!loadUserInfo) return false;
    const userInfo = await loadUserInfo(claims.sub);
    if (userInfo.sub !== claims.sub) return false;
    emailClaims = { email: userInfo.email, email_verified: userInfo.email_verified };
  }
  if (emailClaims.email_verified !== true || !validEmail(emailClaims.email)) return false;
  const user = await prisma.user.findUnique({
    where: { email: emailClaims.email },
    select: userSelect,
  });
  if (!user) return false;
  try {
    await prisma.oidcIdentity.create({
      data: { issuer, subject: claims.sub, userId: user.id },
    });
    return user;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
    // Concurrent first logins can race. Accept only the same committed identity.
    const winner = await prisma.oidcIdentity.findUnique({
      where: identity,
      select: { user: { select: userSelect } },
    });
    return winner?.user.id === user.id ? winner.user : false;
  }
}
