import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import bcrypt from 'bcrypt';
import prisma from '../db/prisma';

// ── Serialisering ─────────────────────────────────────────────────────────────
passport.serializeUser((user, done) => {
  done(null, (user as Express.User).id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, isAdmin: true },
    });
    done(null, user ?? false);
  } catch (err) {
    done(err);
  }
});

// ── Local strategy ────────────────────────────────────────────────────────────
passport.use(
  new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.passwordHash) {
        return done(null, false, { message: 'Fel e-post eller lösenord' });
      }
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        return done(null, false, { message: 'Fel e-post eller lösenord' });
      }
      return done(null, { id: user.id, email: user.email, isAdmin: user.isAdmin });
    } catch (err) {
      return done(err);
    }
  }),
);

// ── Google OAuth strategy (optionell — aktiveras om env-variabler finns) ──────
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL } = process.env;

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL ?? '/api/v1/auth/google/callback',
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) return done(new Error('Google-profil saknar e-post'));
          // Generera ett initialt id från e-postprefixet (versaler, max 8 tecken).
          // En admin kan byta till rätt signatur via /admin/users efteråt.
          const autoId = email.split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'USER';
          const user = await prisma.user.upsert({
            where: { email },
            create: { id: autoId, email },
            update: {},
            select: { id: true, email: true, isAdmin: true },
          });
          return done(null, user);
        } catch (err) {
          return done(err as Error);
        }
      },
    ),
  );
}

export default passport;
