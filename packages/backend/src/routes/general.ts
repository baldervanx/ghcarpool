import { Router } from 'express';
import prisma from '../db/prisma';
import { requireAuth } from '../middleware/auth';
import {
  serializeUser,
  serializeCar,
  serializeDestination,
  serializeSettings,
} from '../lib/serializers';

const router = Router();

// All routes require auth
router.use(requireAuth);

// GET /api/v1/users
router.get('/users', async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { email: 'asc' } });
  res.json(users.map(serializeUser));
});

// GET /api/v1/cars
router.get('/cars', async (_req, res) => {
  const cars = await prisma.car.findMany({ orderBy: { order: 'asc' } });
  res.json(cars.map(serializeCar));
});

// GET /api/v1/destinations
router.get('/destinations', async (_req, res) => {
  const destinations = await prisma.destination.findMany({
    orderBy: { name: 'asc' },
  });
  res.json(destinations.map(serializeDestination));
});

// GET /api/v1/settings
router.get('/settings', async (_req, res) => {
  const settings = await prisma.settings.findUnique({ where: { id: 'main' } });
  if (!settings) {
    res.json({ cost_per_km: 1.0 });
    return;
  }
  res.json(serializeSettings(settings));
});

// GET /api/v1/me
router.get('/me', (req, res) => {
  res.json(req.user);
});

export default router;
