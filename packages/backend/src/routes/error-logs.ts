import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { requireAuth } from '../middleware/auth';
import { serializeErrorLog } from '../lib/serializers';
import { subscribe, unsubscribe, sendEvent } from '../lib/sse';

const router = Router();
router.use(requireAuth);

const ERROR_LOG_CHANNEL = 'error-logs';

const errorLogInclude = {
  comments: {
    include: { byUser: { select: { id: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

// ---- GET /api/v1/error-logs ----
router.get('/', async (req: Request, res: Response) => {
  const { carId, status } = req.query as { carId?: string; status?: string };

  const where: Record<string, unknown> = {};
  if (carId) where.carId = carId;
  if (status) where.status = status;

  const logs = await prisma.errorLog.findMany({
    where,
    include: errorLogInclude,
    orderBy: { updatedAt: 'desc' },
  });

  res.json(logs.map(serializeErrorLog));
});

// ---- GET /api/v1/error-logs/stream (SSE) ----
router.get('/stream', (req: Request, res: Response) => {
  const client = subscribe(ERROR_LOG_CHANNEL, res);
  req.on('close', () => unsubscribe(client));
});

// ---- POST /api/v1/error-logs ----
router.post('/', async (req: Request, res: Response) => {
  const { carId, description, assignedToId } = req.body as {
    carId?: string;
    description?: string;
    assignedToId?: string;
  };

  if (!carId) {
    res.status(400).json({ error: 'carId saknas' });
    return;
  }
  if (!description || description.trim() === '') {
    res.status(400).json({ error: 'description saknas' });
    return;
  }

  const car = await prisma.car.findUnique({ where: { id: carId }, select: { id: true } });
  if (!car) {
    res.status(400).json({ error: `Bil '${carId}' finns inte` });
    return;
  }

  const log = await prisma.errorLog.create({
    data: {
      carId,
      description: description.trim(),
      assignedToId: assignedToId || null,
      updatedById: req.user!.id,
    },
    include: errorLogInclude,
  });

  const serialized = serializeErrorLog(log);
  sendEvent(ERROR_LOG_CHANNEL, 'add', serialized);
  res.status(201).json(serialized);
});

// ---- PATCH /api/v1/error-logs/:id ----
router.patch('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, assignedToId, description } = req.body as {
    status?: string;
    assignedToId?: string;
    description?: string;
  };

  const existing = await prisma.errorLog.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    res.status(404).json({ error: 'Fellogg hittades inte' });
    return;
  }

  const data: Record<string, unknown> = { updatedById: req.user!.id };
  if (status !== undefined) data.status = status;
  if (assignedToId !== undefined) data.assignedToId = assignedToId || null;
  if (description !== undefined && description.trim() !== '') data.description = description.trim();

  const log = await prisma.errorLog.update({
    where: { id },
    data,
    include: errorLogInclude,
  });

  const serialized = serializeErrorLog(log);
  sendEvent(ERROR_LOG_CHANNEL, 'update', serialized);
  res.json(serialized);
});

// ---- POST /api/v1/error-logs/:id/comments ----
router.post('/:id/comments', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { text } = req.body as { text?: string };

  if (!text || text.trim() === '') {
    res.status(400).json({ error: 'text saknas' });
    return;
  }

  const existing = await prisma.errorLog.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    res.status(404).json({ error: 'Fellogg hittades inte' });
    return;
  }

  await prisma.errorLogComment.create({
    data: { errorLogId: id, text: text.trim(), byUserId: req.user!.id },
  });

  // Uppdatera updatedAt på felloggen
  const log = await prisma.errorLog.update({
    where: { id },
    data: { updatedById: req.user!.id },
    include: errorLogInclude,
  });

  const serialized = serializeErrorLog(log);
  sendEvent(ERROR_LOG_CHANNEL, 'update', serialized);
  res.status(201).json(serialized);
});

// ---- DELETE /api/v1/error-logs/:id (admin only) ----
router.delete('/:id', async (req: Request, res: Response) => {
  if (!req.user!.isAdmin) {
    res.status(403).json({ error: 'Kräver admin' });
    return;
  }

  const existing = await prisma.errorLog.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!existing) {
    res.status(404).json({ error: 'Fellogg hittades inte' });
    return;
  }

  await prisma.errorLog.delete({ where: { id: req.params.id } });
  sendEvent(ERROR_LOG_CHANNEL, 'remove', { id: req.params.id });
  res.json({ ok: true });
});

export default router;
