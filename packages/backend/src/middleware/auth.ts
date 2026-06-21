import { Request, Response, NextFunction } from 'express';

// Utökar Express med passport-kompatibelt User-objekt
declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      isAdmin: boolean;
    }
  }
}

/**
 * Kräver att användaren är inloggad via Passport-session.
 * Passport sätter req.user efter deserializeUser.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Ej autentiserad' });
    return;
  }
  next();
}

/**
 * Kräver att användaren är inloggad OCH är admin.
 * Måste användas efter requireAuth.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
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
