import { Request, Response, NextFunction } from 'express';
import { firebaseAuth } from '../lib/firebase-admin';
import prisma from '../db/prisma';

// Utökar Express Request med autentiserad användare
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        isAdmin: boolean;
      };
    }
  }
}

/**
 * Verifierar Firebase ID-token från Authorization: Bearer <token>
 * Skapar användaren i databasen om den inte finns sedan tidigare.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Saknar Authorization-header' });
    return;
  }

  const token = header.slice(7);

  try {
    const decoded = await firebaseAuth.verifyIdToken(token);
    const email = decoded.email;

    if (!email) {
      res.status(401).json({ error: 'Token saknar e-post' });
      return;
    }

    // Upsert: skapa om ny, annars hämta befintlig
    const user = await prisma.user.upsert({
      where: { email },
      create: { email },
      update: {},
      select: { id: true, email: true, isAdmin: true },
    });

    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Ogiltig token' });
  }
}

/**
 * Kräver att användaren är inloggad OCH är admin.
 * Måste användas efter requireAuth.
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: 'Ej autentiserad' });
    return;
  }
  if (!req.user.isAdmin) {
    res.status(403).json({ error: 'Åtkomst nekad' });
    return;
  }
  next();
}
