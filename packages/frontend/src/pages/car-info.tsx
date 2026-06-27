import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Button } from '@/components/ui/button';
import { carInfoApi, type CarInfoDto } from '@/api/car-info';
import { ApiError } from '@/api/client';
import type { Car } from '@/store';

interface RootState {
  car: { cars: Car[] };
  auth: { user: { uid: string; isAdmin: boolean } | null };
}

interface FormState {
  inspectionDue: string;
  lastService: string;
  owner: string;
  insuranceCompany: string;
}

function emptyForm(): FormState {
  return { inspectionDue: '', lastService: '', owner: '', insuranceCompany: '' };
}

function infoToForm(info: CarInfoDto | null): FormState {
  if (!info) return emptyForm();
  return {
    inspectionDue: info.inspectionDue ?? '',
    lastService: info.lastService ?? '',
    owner: info.owner ?? '',
    insuranceCompany: info.insuranceCompany ?? '',
  };
}

export function CarInfoPage() {
  const cars = useSelector((s: RootState) => s.car.cars);
  const authUser = useSelector((s: RootState) => s.auth.user);

  const [selectedCarId, setSelectedCarId] = useState('');
  const [info, setInfo] = useState<CarInfoDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (cars.length > 0 && !selectedCarId) setSelectedCarId(cars[0].id);
  }, [cars]);

  useEffect(() => {
    if (!selectedCarId) return;
    setLoading(true);
    setInfo(null);
    setError(null);
    setEditing(false);
    carInfoApi.get(selectedCarId)
      .then(data => { setInfo(data); setForm(infoToForm(data)); })
      .catch(e => {
        if (e instanceof ApiError && e.status === 404) {
          setInfo(null);
          setForm(emptyForm());
        } else {
          setError(e instanceof ApiError ? e.message : 'Okänt fel');
        }
      })
      .finally(() => setLoading(false));
  }, [selectedCarId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaving(true);
    try {
      const updated = await carInfoApi.upsert(selectedCarId, {
        inspectionDue: form.inspectionDue || null,
        lastService: form.lastService || null,
        owner: form.owner || null,
        insuranceCompany: form.insuranceCompany || null,
      });
      setInfo(updated);
      setForm(infoToForm(updated));
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Kunde inte spara');
    } finally {
      setSaving(false);
    }
  }

  function field(key: keyof FormState, label: string, type = 'text') {
    return (
      <div>
        <label className="text-sm font-medium mb-1 block">{label}</label>
        {editing ? (
          <input
            type={type}
            value={form[key]}
            onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
            className="w-full border rounded px-3 py-2 text-sm bg-background"
          />
        ) : (
          <p className="text-sm py-2 px-3 border rounded bg-muted/20 min-h-[36px]">
            {info?.[key] ?? <span className="text-muted-foreground italic">–</span>}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold">Bilinfo</h1>

      {/* Bilväljare */}
      <div>
        <label className="text-sm font-medium mb-1 block">Välj bil</label>
        <select
          value={selectedCarId}
          onChange={e => setSelectedCarId(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm bg-background"
        >
          {cars.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Laddar...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && selectedCarId && (
        <form onSubmit={handleSave} className="border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm uppercase tracking-wide">Information</h2>
            {authUser?.isAdmin && !editing && (
              <Button size="sm" variant="outline" type="button" onClick={() => setEditing(true)}>
                Redigera
              </Button>
            )}
          </div>

          {field('inspectionDue', 'Nästa besiktning (datum)', 'date')}
          {field('lastService', 'Senaste service (datum)', 'date')}
          {field('owner', 'Ägare')}
          {field('insuranceCompany', 'Försäkringsbolag')}

          {info?.updatedAt && (
            <p className="text-xs text-muted-foreground">
              Uppdaterad: {new Date(info.updatedAt).toLocaleDateString('sv-SE')}
            </p>
          )}

          {!info && !editing && (
            <p className="text-sm text-muted-foreground italic">Ingen info registrerad ännu.</p>
          )}

          {editing && (
            <div className="flex gap-2 pt-2">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? 'Sparar...' : 'Spara'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => { setEditing(false); setForm(infoToForm(info)); setSaveError(null); }}
              >
                Avbryt
              </Button>
            </div>
          )}
          {saveError && <p className="text-sm text-red-600">{saveError}</p>}
        </form>
      )}
    </div>
  );
}

export default CarInfoPage;
