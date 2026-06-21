import { Router } from 'express';
import passport from '../lib/passport';

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
router.get('/me', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Ej inloggad' });
    return;
  }
  res.json(req.user);
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
