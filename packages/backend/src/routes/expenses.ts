import { Router, Request, Response } from 'express';
import multer from 'multer';
import prisma from '../db/prisma';
import { requireAuth } from '../middleware/auth';
import { serializeExpense } from '../lib/serializers';

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ---- GET /api/v1/expenses ----
router.get('/', async (req: Request, res: Response) => {
  const { carId, status } = req.query as { carId?: string; status?: string };

  const where: Record<string, unknown> = {};
  if (carId) where.carId = carId;
  if (status) where.status = status;

  const expenses = await prisma.expense.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  res.json(expenses.map(serializeExpense));
});

// ---- POST /api/v1/expenses (multipart) ----
router.post('/', upload.single('receipt'), async (req: Request, res: Response) => {
  const { carId, amount: amountRaw, description } = req.body as {
    carId?: string;
    amount?: string;
    description?: string;
  };

  if (!carId) {
    res.status(400).json({ error: 'carId saknas' });
    return;
  }
  if (!description || description.trim() === '') {
    res.status(400).json({ error: 'description saknas' });
    return;
  }
  const amount = parseFloat(amountRaw ?? '');
  if (isNaN(amount) || amount <= 0) {
    res.status(400).json({ error: 'amount måste vara ett positivt tal' });
    return;
  }

  const car = await prisma.car.findUnique({ where: { id: carId }, select: { id: true } });
  if (!car) {
    res.status(400).json({ error: `Bil '${carId}' finns inte` });
    return;
  }

  const receiptData = (req.file?.buffer ?? null) as Uint8Array<ArrayBuffer> | null;
  const receiptMime = req.file?.mimetype ?? null;

  const expense = await prisma.expense.create({
    data: {
      carId,
      amount,
      description: description.trim(),
      byUserId: req.user!.id,
      receiptData,
      receiptMime,
    },
  });

  res.status(201).json(serializeExpense(expense));
});

// ---- GET /api/v1/expenses/:id/receipt ----
router.get('/:id/receipt', async (req: Request, res: Response) => {
  const expense = await prisma.expense.findUnique({
    where: { id: req.params.id },
    select: { receiptData: true, receiptMime: true },
  });

  if (!expense || !expense.receiptData) {
    res.status(404).json({ error: 'Kvitto saknas' });
    return;
  }

  res.setHeader('Content-Type', expense.receiptMime ?? 'application/octet-stream');
  res.send(expense.receiptData);
});

// ---- PATCH /api/v1/expenses/:id ----
router.patch('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body as { status?: string };

  const existing = await prisma.expense.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Utlägg hittades inte' });
    return;
  }

  const data: Record<string, unknown> = {};
  if (status !== undefined) data.status = status;

  const expense = await prisma.expense.update({ where: { id }, data });
  res.json(serializeExpense(expense));
});

// ---- DELETE /api/v1/expenses/:id (admin eller ägare) ----
router.delete('/:id', async (req: Request, res: Response) => {
  const existing = await prisma.expense.findUnique({
    where: { id: req.params.id },
    select: { id: true, byUserId: true },
  });

  if (!existing) {
    res.status(404).json({ error: 'Utlägg hittades inte' });
    return;
  }

  const isOwner = existing.byUserId === req.user!.id;
  const isAdmin = req.user!.isAdmin;

  if (!isOwner && !isAdmin) {
    res.status(403).json({ error: 'Åtkomst nekad' });
    return;
  }

  await prisma.expense.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

export default router;
