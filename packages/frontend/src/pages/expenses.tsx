import React, { useEffect, useState, useRef } from 'react';
import { useSelector } from 'react-redux';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { expensesApi, type ExpenseDto } from '@/api/expenses';
import { ApiError } from '@/api/client';
import type { Car } from '@/store';

interface RootState {
  car: { cars: Car[] };
  auth: { user: { uid: string; isAdmin: boolean } | null };
}

const STATUS_COLORS: Record<string, string> = {
  UNPAID: 'bg-orange-100 text-orange-800 border-orange-200',
  PAID: 'bg-green-100 text-green-800 border-green-200',
};

const STATUS_LABELS: Record<string, string> = {
  UNPAID: 'Obetald',
  PAID: 'Betald',
};

export function Expenses() {
  const cars = useSelector((s: RootState) => s.car.cars);
  const authUser = useSelector((s: RootState) => s.auth.user);

  const [expenses, setExpenses] = useState<ExpenseDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Ny utlägg-form
  const [newCarId, setNewCarId] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newFile, setNewFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cars.length > 0 && !newCarId) setNewCarId(cars[0].id);
  }, [cars]);

  useEffect(() => {
    setLoading(true);
    expensesApi.list()
      .then(setExpenses)
      .catch(e => setError(e instanceof ApiError ? e.message : 'Okänt fel'))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const amount = parseFloat(newAmount);
    if (isNaN(amount) || amount <= 0) { setFormError('Ange ett giltigt belopp'); return; }
    if (!newDesc.trim()) { setFormError('Ange en beskrivning'); return; }
    setSubmitting(true);
    try {
      const expense = await expensesApi.create({
        carId: newCarId,
        amount,
        description: newDesc.trim(),
        receipt: newFile ?? undefined,
      });
      setExpenses(prev => [expense, ...prev]);
      setNewAmount('');
      setNewDesc('');
      setNewFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Kunde inte skapa utlägg');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTogglePaid(expense: ExpenseDto) {
    const next = expense.status === 'UNPAID' ? 'PAID' : 'UNPAID';
    try {
      const updated = await expensesApi.updateStatus(expense.id, next);
      setExpenses(prev => prev.map(e => e.id === updated.id ? updated : e));
    } catch {
      // silent
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Radera utlägg?')) return;
    try {
      await expensesApi.remove(id);
      setExpenses(prev => prev.filter(e => e.id !== id));
    } catch {
      // silent
    }
  }

  if (loading) return <div className="p-6">Laddar...</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;

  return (
    <div className="p-4 space-y-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">Utlägg</h1>

      {/* Nytt utlägg */}
      <form onSubmit={handleCreate} className="border rounded-lg p-4 space-y-3 bg-muted/30">
        <h2 className="font-semibold text-sm uppercase tracking-wide">Nytt utlägg</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium mb-1 block">Bil</label>
            <select
              value={newCarId}
              onChange={e => setNewCarId(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background"
            >
              {cars.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Belopp (SEK)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={newAmount}
              onChange={e => setNewAmount(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background"
            />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Beskrivning</label>
          <input
            type="text"
            placeholder="T.ex. Bränsle, Service..."
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm bg-background"
          />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Kvitto (valfritt)</label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={e => setNewFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </div>
        {formError && <p className="text-red-600 text-sm">{formError}</p>}
        <Button type="submit" disabled={submitting} size="sm">
          {submitting ? 'Skickar...' : 'Skapa utlägg'}
        </Button>
      </form>

      {/* Utlägg-lista */}
      {expenses.length === 0 && (
        <p className="text-muted-foreground text-sm">Inga utlägg ännu.</p>
      )}
      {expenses.map(expense => {
        const car = cars.find(c => c.id === expense.carId);
        const isOwner = authUser?.uid === expense.byUserId;
        return (
          <div key={expense.id} className="border rounded-lg p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="font-medium text-sm">{car?.name ?? expense.carId}</p>
                <p className="text-sm">{expense.description}</p>
                <p className="text-lg font-semibold">{expense.amount.toFixed(2)} kr</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(expense.createdAt).toLocaleDateString('sv-SE')}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <Badge className={`text-xs border ${STATUS_COLORS[expense.status]}`}>
                  {STATUS_LABELS[expense.status]}
                </Badge>
                {authUser?.isAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 px-2"
                    onClick={() => handleTogglePaid(expense)}
                  >
                    Markera {expense.status === 'UNPAID' ? 'betald' : 'obetald'}
                  </Button>
                )}
                {expense.hasReceipt && (
                  <a
                    href={expensesApi.receiptUrl(expense.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 underline"
                  >
                    Visa kvitto
                  </a>
                )}
                {(isOwner || authUser?.isAdmin) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs h-7 px-2 text-red-600 hover:bg-red-50"
                    onClick={() => handleDelete(expense.id)}
                  >
                    Radera
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default Expenses;
