import express from 'express';
import 'express-async-errors'; // Monkey-patchar Express 4: async-fel → next(err) automatiskt
import cors from 'cors';
import { buildSessionMiddleware } from './lib/session';
import passport from './lib/passport';
import authRouter from './routes/auth';
import generalRouter from './routes/general';
import bookingsRouter from './routes/bookings';
import tripsRouter from './routes/trips';
import adminRouter from './routes/admin';

const app = express();

app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  credentials: true,
}));

// Session måste initieras före passport
app.use(buildSessionMiddleware());
app.use(passport.initialize());
app.use(passport.session());

// Health (no auth)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Auth-routes (ingen requireAuth här — hanteras internt)
app.use('/api/v1/auth', authRouter);

// API v1
app.use('/api/v1', generalRouter);
app.use('/api/v1/bookings', bookingsRouter);
app.use('/api/v1/trips', tripsRouter);
app.use('/api/v1/admin', adminRouter);

// 404 catch-all
app.use((_req, res) => {
  res.status(404).json({ error: 'Resursen finns inte' });
});

// Global error handler — fångar fel vidarebefordrade med next(err) och
// även ohanterade async-undantag i Express 5-stil via express-async-errors
// (om paketet laddas). Utan detta riskerar processen att krascha på
// Prisma-fel och liknande, vilket stänger alla öppna SSE-anslutningar.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[app error]', err);
  if (!res.headersSent) {
    res.status(500).json({ error: err.message });
  }
});

export default app;
