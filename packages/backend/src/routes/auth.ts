import { Router } from 'express';
import bcrypt from 'bcrypt';
import passport from '../lib/passport';
import prisma from '../db/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();

// POST /api/v1/auth/login
router.post('/login', (req, res, next) => {
  passport.authenticate(
    'local',
    (err: unknown, user: Express.User | false, info: { message: string } | undefined) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ error: info?.message ?? 'Inloggning misslyckades' });
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        return res.json(user);
      });
    },
  )(req, res, next);
});

// POST /api/v1/auth/logout
router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.json({ ok: true });
  });
});

// GET /api/v1/auth/me
// Returnerar alltid 200. Icke-autentiserade klienter får { user: null }
// istället för 401, så att dev-tools inte visar ett rött fel vid sidladdning.
router.get('/me', (req, res) => {
  if (!req.user) {
    res.json({ user: null });
    return;
  }
  res.json(req.user);
});

// POST /api/v1/auth/change-password (kräver inloggning)
router.post('/change-password', requireAuth, async (req, res, next) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'currentPassword och newPassword krävs' });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: 'Nytt lösenord måste vara minst 8 tecken' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user?.passwordHash) {
      res.status(400).json({ error: 'Kontot saknar lösenord (Google-inloggning?)' });
      return;
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: 'Nuvarande lösenord stämmer inte' });
      return;
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Google OAuth — bara aktiv om strategin är konfigurerad
const googleEnabled =
  Boolean(process.env.GOOGLE_CLIENT_ID) && Boolean(process.env.GOOGLE_CLIENT_SECRET);

if (googleEnabled) {
  router.get('/google', passport.authenticate('google', { scope: ['email', 'profile'] }));

  router.get(
    '/google/callback',
    passport.authenticate('google', { failureRedirect: '/login' }),
    (_req, res) => {
      res.redirect(process.env.FRONTEND_URL ?? '/');
    },
  );
}

export default router;
