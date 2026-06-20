import express from 'express';
import cors from 'cors';
import { buildSessionMiddleware } from './lib/session';

const app = express();

app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  credentials: true,
}));
app.use(buildSessionMiddleware());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

export default app;
