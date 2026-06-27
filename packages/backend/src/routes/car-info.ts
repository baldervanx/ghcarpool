import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { requireAuth } from '../middleware/auth';
import { serializeCarInfo } from '../lib/serializers';

const router = Router();
router.use(requireAuth);

// ---- GET /api/v1/car-info/:carId ----
router.get('/:carId', async (req: Request, res: Response) => {
  const { carId } = req.params;

  const info = await prisma.carInfo.findUnique({ where: { carId } });
  if (!info) {
    res.status(404).json({ error: 'Ingen bilinfo finns ännu' });
    return;
  }

  res.json(serializeCarInfo(info));
});

// ---- PUT /api/v1/car-info/:carId (admin only, upsert) ----
router.put('/:carId', async (req: Request, res: Response) => {
  if (!req.user!.isAdmin) {
    res.status(403).json({ error: 'Kräver admin' });
    return;
  }

  const { carId } = req.params;
  const { inspectionDue, lastService, owner, insuranceCompany } = req.body as {
    inspectionDue?: string;
    lastService?: string;
    owner?: string;
    insuranceCompany?: string;
  };

  const car = await prisma.car.findUnique({ where: { id: carId }, select: { id: true } });
  if (!car) {
    res.status(404).json({ error: 'Bil finns inte' });
    return;
  }

  const info = await prisma.carInfo.upsert({
    where: { carId },
    create: {
      carId,
      inspectionDue: inspectionDue ?? null,
      lastService: lastService ?? null,
      owner: owner ?? null,
      insuranceCompany: insuranceCompany ?? null,
    },
    update: {
      inspectionDue: inspectionDue ?? null,
      lastService: lastService ?? null,
      owner: owner ?? null,
      insuranceCompany: insuranceCompany ?? null,
    },
  });

  res.json(serializeCarInfo(info));
});

export default router;
