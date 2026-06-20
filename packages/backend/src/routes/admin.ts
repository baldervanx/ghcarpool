import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  serializeUser,
  serializeCar,
  serializeDestination,
  serializeSettings,
  serializeTrip,
} from '../lib/serializers';

const router = Router();
router.use(requireAuth, requireAdmin);

// ============================================================
// USERS
// ============================================================

// GET /api/v1/admin/users
router.get('/users', async (_req, res: Response) => {
  const users = await prisma.user.findMany({ orderBy: { email: 'asc' } });
  res.json(users.map(serializeUser));
});

// POST /api/v1/admin/users
router.post('/users', async (req: Request, res: Response) => {
  const { email, isAdmin = false, shortName = '', commentMandatory = false } = req.body;
  const user = await prisma.user.create({
    data: { email, isAdmin, shortName, commentMandatory },
  });
  res.status(201).json(serializeUser(user));
});

// PUT /api/v1/admin/users/:id
router.put('/users/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { isAdmin, shortName, commentMandatory } = req.body;
  try {
    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(isAdmin !== undefined && { isAdmin }),
        ...(shortName !== undefined && { shortName }),
        ...(commentMandatory !== undefined && { commentMandatory }),
      },
    });
    res.json(serializeUser(user));
  } catch {
    res.status(404).json({ error: 'Användare hittades inte' });
  }
});

// DELETE /api/v1/admin/users/:id
router.delete('/users/:id', async (req: Request, res: Response) => {
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ id: req.params.id });
  } catch {
    res.status(404).json({ error: 'Användare hittades inte' });
  }
});

// ============================================================
// CARS
// ============================================================

// GET /api/v1/admin/cars
router.get('/cars', async (_req, res: Response) => {
  const cars = await prisma.car.findMany({ orderBy: { order: 'asc' } });
  res.json(cars.map(serializeCar));
});

// POST /api/v1/admin/cars
router.post('/cars', async (req: Request, res: Response) => {
  const { name, range = 0, order = 0, hasLog = true } = req.body;
  const car = await prisma.car.create({ data: { name, range, order, hasLog } });
  res.status(201).json(serializeCar(car));
});

// PUT /api/v1/admin/cars/:id
router.put('/cars/:id', async (req: Request, res: Response) => {
  const { name, range, order, hasLog } = req.body;
  try {
    const car = await prisma.car.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(range !== undefined && { range }),
        ...(order !== undefined && { order }),
        ...(hasLog !== undefined && { hasLog }),
      },
    });
    res.json(serializeCar(car));
  } catch {
    res.status(404).json({ error: 'Bil hittades inte' });
  }
});

// DELETE /api/v1/admin/cars/:id
router.delete('/cars/:id', async (req: Request, res: Response) => {
  try {
    await prisma.car.delete({ where: { id: req.params.id } });
    res.json({ id: req.params.id });
  } catch {
    res.status(404).json({ error: 'Bil hittades inte' });
  }
});

// ============================================================
// DESTINATIONS
// ============================================================

// GET /api/v1/admin/destinations
router.get('/destinations', async (_req, res: Response) => {
  const dests = await prisma.destination.findMany({ orderBy: { name: 'asc' } });
  res.json(dests.map(serializeDestination));
});

// POST /api/v1/admin/destinations
router.post('/destinations', async (req: Request, res: Response) => {
  const { name, shortName, distance } = req.body;
  const dest = await prisma.destination.create({
    data: { name, shortName, distance: distance ?? null },
  });
  res.status(201).json(serializeDestination(dest));
});

// PUT /api/v1/admin/destinations/:id
router.put('/destinations/:id', async (req: Request, res: Response) => {
  const { name, shortName, distance } = req.body;
  try {
    const dest = await prisma.destination.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(shortName !== undefined && { shortName }),
        ...(distance !== undefined && { distance }),
      },
    });
    res.json(serializeDestination(dest));
  } catch {
    res.status(404).json({ error: 'Destination hittades inte' });
  }
});

// DELETE /api/v1/admin/destinations/:id
router.delete('/destinations/:id', async (req: Request, res: Response) => {
  try {
    await prisma.destination.delete({ where: { id: req.params.id } });
    res.json({ id: req.params.id });
  } catch {
    res.status(404).json({ error: 'Destination hittades inte' });
  }
});

// ============================================================
// SETTINGS
// ============================================================

// GET /api/v1/admin/settings
router.get('/settings', async (_req, res: Response) => {
  const s = await prisma.settings.findUnique({ where: { id: 'main' } });
  res.json(s ? serializeSettings(s) : { cost_per_km: 1.0 });
});

// PUT /api/v1/admin/settings  (upsert)
router.put('/settings', async (req: Request, res: Response) => {
  const { cost_per_km, ...extra } = req.body;
  const s = await prisma.settings.upsert({
    where: { id: 'main' },
    create: {
      id: 'main',
      costPerKm: cost_per_km ?? 1.0,
      extra: Object.keys(extra).length ? extra : undefined,
    },
    update: {
      ...(cost_per_km !== undefined && { costPerKm: cost_per_km }),
      ...(Object.keys(extra).length && { extra }),
    },
  });
  res.json(serializeSettings(s));
});

// ============================================================
// ADMIN: trip log overview (all trips, not just last 30 days)
// ============================================================

// GET /api/v1/admin/trips
router.get('/trips', async (_req, res: Response) => {
  const trips = await prisma.trip.findMany({
    include: { users: true },
    orderBy: { odo: 'desc' },
  });
  res.json(trips.map(t => serializeTrip(t)));
});

export default router;
