import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { errorLogsApi, type ErrorLogDto } from '@/api/error-logs';
import { ApiError } from '@/api/client';
import type { Car } from '@/store';

interface RootState {
  car: { cars: Car[] };
  auth: { user: { uid: string; isAdmin: boolean } | null };
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Öppen',
  IN_PROGRESS: 'Pågår',
  RESOLVED: 'Löst',
};

const STATUS_NEXT: Record<string, string> = {
  OPEN: 'IN_PROGRESS',
  IN_PROGRESS: 'RESOLVED',
  RESOLVED: 'OPEN',
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-red-100 text-red-800 border-red-200',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  RESOLVED: 'bg-green-100 text-green-800 border-green-200',
};

export function ErrorLog() {
  const cars = useSelector((s: RootState) => s.car.cars);
  const authUser = useSelector((s: RootState) => s.auth.user);

  const [logs, setLogs] = useState<ErrorLogDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Ny fellogg-form
  const [newCarId, setNewCarId] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Kommentar-form per logg
  const [commentText, setCommentText] = useState<Record<string, string>>({});
  const [commentLoading, setCommentLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (cars.length > 0 && !newCarId) {
      setNewCarId(cars[0].id);
    }
  }, [cars]);

  useEffect(() => {
    setLoading(true);
    errorLogsApi.list()
      .then(setLogs)
      .catch(e => setError(e instanceof ApiError ? e.message : 'Okänt fel'))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!newDesc.trim()) { setFormError('Beskriv felet'); return; }
    setSubmitting(true);
    try {
      const log = await errorLogsApi.create({ carId: newCarId, description: newDesc.trim() });
      setLogs(prev => [log, ...prev]);
      setNewDesc('');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Kunde inte skapa fellogg');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(log: ErrorLogDto) {
    try {
      const updated = await errorLogsApi.updateStatus(log.id, STATUS_NEXT[log.status]);
      setLogs(prev => prev.map(l => l.id === updated.id ? updated : l));
    } catch {
      // silent
    }
  }

  async function handleAddComment(logId: string) {
    const text = commentText[logId]?.trim();
    if (!text) return;
    setCommentLoading(prev => ({ ...prev, [logId]: true }));
    try {
      const updated = await errorLogsApi.addComment(logId, text);
      setLogs(prev => prev.map(l => l.id === updated.id ? updated : l));
      setCommentText(prev => ({ ...prev, [logId]: '' }));
    } catch {
      // silent
    } finally {
      setCommentLoading(prev => ({ ...prev, [logId]: false }));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Radera fellogg?')) return;
    try {
      await errorLogsApi.remove(id);
      setLogs(prev => prev.filter(l => l.id !== id));
    } catch {
      // silent
    }
  }

  if (loading) return <div className="p-6">Laddar...</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;

  return (
    <div className="p-4 space-y-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">Fellogg</h1>

      {/* Ny fellogg */}
      <form onSubmit={handleCreate} className="border rounded-lg p-4 space-y-3 bg-muted/30">
        <h2 className="font-semibold text-sm uppercase tracking-wide">Rapportera fel</h2>
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
          <label className="text-sm font-medium mb-1 block">Beskrivning</label>
          <textarea
            placeholder="Beskriv felet..."
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            rows={3}
            className="w-full border rounded px-3 py-2 text-sm bg-background resize-none"
          />
        </div>
        {formError && <p className="text-red-600 text-sm">{formError}</p>}
        <Button type="submit" disabled={submitting} size="sm">
          {submitting ? 'Skickar...' : 'Rapportera'}
        </Button>
      </form>

      {/* Logg-lista */}
      {logs.length === 0 && (
        <p className="text-muted-foreground text-sm">Inga felloggar ännu.</p>
      )}
      {logs.map(log => {
        const car = cars.find(c => c.id === log.carId);
        return (
          <div key={log.id} className="border rounded-lg p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="font-medium text-sm">{car?.name ?? log.carId}</p>
                <p className="text-sm">{log.description}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(log.createdAt).toLocaleDateString('sv-SE')}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge className={`text-xs border ${STATUS_COLORS[log.status]}`}>
                  {STATUS_LABELS[log.status]}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 px-2"
                  onClick={() => handleStatusChange(log)}
                >
                  → {STATUS_LABELS[STATUS_NEXT[log.status]]}
                </Button>
                {authUser?.isAdmin && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs h-7 px-2 text-red-600 hover:bg-red-50"
                    onClick={() => handleDelete(log.id)}
                  >
                    Radera
                  </Button>
                )}
              </div>
            </div>

            {/* Kommentarer */}
            {log.comments.length > 0 && (
              <div className="space-y-1 border-t pt-2">
                {log.comments.map(c => (
                  <p key={c.id} className="text-xs text-muted-foreground">
                    <span className="font-medium">{c.byUserId.slice(0, 6)}</span>: {c.text}
                  </p>
                ))}
              </div>
            )}

            {/* Lägg till kommentar */}
            <div className="flex gap-2 border-t pt-2">
              <input
                type="text"
                placeholder="Kommentera..."
                value={commentText[log.id] ?? ''}
                onChange={e => setCommentText(prev => ({ ...prev, [log.id]: e.target.value }))}
                className="flex-1 border rounded px-2 py-1 text-sm bg-background"
                onKeyDown={e => e.key === 'Enter' && handleAddComment(log.id)}
              />
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8"
                disabled={commentLoading[log.id]}
                onClick={() => handleAddComment(log.id)}
              >
                Skicka
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default ErrorLog;
