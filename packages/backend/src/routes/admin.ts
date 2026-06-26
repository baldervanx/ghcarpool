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
  const { id, email, name = '', isAdmin = false, shortName = '', commentMandatory = false } = req.body;
  if (!id) return void res.status(400).json({ error: 'id (signatur, t.ex. "AS") krävs' });
  if (!email) return void res.status(400).json({ error: 'email krävs' });
  try {
    const user = await prisma.user.create({
      data: { id, email, name, isAdmin, shortName, commentMandatory },
    });
    res.status(201).json(serializeUser(user));
  } catch {
    res.status(409).json({ error: 'Användare med detta id eller denna e-post finns redan' });
  }
});

// PUT /api/v1/admin/users/:id
router.put('/users/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, isAdmin, shortName, commentMandatory } = req.body;
  try {
    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
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
  const { id, name, range = 0, order = 0, hasLog = true } = req.body;
  if (!id) return void res.status(400).json({ error: 'id (reg-nummer, t.ex. "ABC123") krävs' });
  if (!name) return void res.status(400).json({ error: 'name (smeknamn) krävs' });
  try {
    const car = await prisma.car.create({ data: { id, name, range, order, hasLog } });
    res.status(201).json(serializeCar(car));
  } catch {
    res.status(409).json({ error: 'Bil med detta reg-nummer finns redan' });
  }
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

// GET /api/v1/admin/destinations[?temporary=true]
// Med ?temporary=true returneras även bookingCount per destination
router.get('/destinations', async (req: Request, res: Response) => {
  const onlyTemporary = req.query.temporary === 'true';

  if (onlyTemporary) {
    // Hämta temporära destinationer med antal bokningar kopplade till dem
    const dests = await prisma.destination.findMany({
      where: { temporary: true },
      orderBy: { name: 'asc' },
      include: { _count: { select: { bookings: true } } },
    });
    res.json(dests.map(d => ({
      ...serializeDestination(d),
      bookingCount: d._count.bookings,
    })));
    return;
  }

  const dests = await prisma.destination.findMany({ orderBy: { name: 'asc' } });
  res.json(dests.map(serializeDestination));
});

// POST /api/v1/admin/destinations
router.post('/destinations', async (req: Request, res: Response) => {
  const { name, shortName = '', distance } = req.body;
  const dest = await prisma.destination.create({
    data: { name, shortName, distance: distance ?? null, temporary: false },
  });
  res.status(201).json(serializeDestination(dest));
});

// PUT /api/v1/admin/destinations/:id
// Används även för att "promota" en temporär destination: sätt temporary=false,
// ange shortName och eventuellt distance.
router.put('/destinations/:id', async (req: Request, res: Response) => {
  const { name, shortName, distance, temporary } = req.body;
  try {
    const dest = await prisma.destination.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(shortName !== undefined && { shortName }),
        ...(distance !== undefined && { distance }),
        ...(temporary !== undefined && { temporary: Boolean(temporary) }),
      },
    });
    res.json(serializeDestination(dest));
  } catch {
    res.status(404).json({ error: 'Destination hittades inte' });
  }
});

// DELETE /api/v1/admin/destinations/:id
// Vägrar ta bort om det finns bokningar som refererar till destinationen.
router.delete('/destinations/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  try {
    const bookingCount = await prisma.booking.count({ where: { destinationId: id } });
    if (bookingCount > 0) {
      res.status(409).json({
        error: `Kan inte ta bort destination — ${bookingCount} bokning${bookingCount === 1 ? '' : 'ar'} refererar till den`,
      });
      return;
    }
    await prisma.destination.delete({ where: { id } });
    res.json({ id });
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

// GET /api/v1/admin/trips  (optional ?carId=&month=yyyy-MM)
router.get('/trips', async (req: Request, res: Response) => {
  const { carId, month } = req.query as Record<string, string | undefined>;

  const where: Record<string, unknown> = {};
  if (carId) where.carId = carId;
  if (month) {
    const start = new Date(`${month}-01T00:00:00Z`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    where.timestamp = { gte: start, lt: end };
  }

  const trips = await prisma.trip.findMany({
    where,
    include: { users: true },
    orderBy: { odo: 'desc' },
  });
  res.json(trips.map(t => serializeTrip(t)));
});

// DELETE /api/v1/admin/trips/:id
router.delete('/trips/:id', async (req: Request, res: Response) => {
  await prisma.trip.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

export default router;
