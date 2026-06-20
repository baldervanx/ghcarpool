import express from 'express';
import cors from 'cors';
import { buildSessionMiddleware } from './lib/session';
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
app.use(buildSessionMiddleware());

// Health (no auth)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// API v1
app.use('/api/v1', generalRouter);
app.use('/api/v1/bookings', bookingsRouter);
app.use('/api/v1/trips', tripsRouter);
app.use('/api/v1/admin', adminRouter);

// 404 catch-all
app.use((_req, res) => {
  res.status(404).json({ error: 'Resursen finns inte' });
});

export default app;
