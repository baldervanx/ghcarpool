import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/api/client';
import { format, subMonths } from 'date-fns';
import type { ExpenseDto } from '@/api/expenses';

interface TripRow {
  id: string;
  car: { id: string };
  odo: number;
  distance: number;
  users: { id: string }[];
  cost: number;
  comment?: string;
  timestamp: string;    // formaterad visningssträng ("20/06 14:30")
  timestampISO: string; // ISO 8601, används för datumfiltrering
  byUser: { id: string };
}

/**
 * Exporterar resor för perioden dag 20 föregående månad → dag 20 denna månad,
 * grupperade per bil, samt alla obetalda utlägg, som CSV (UTF-8 med BOM för
 * Excel-kompatibilitet).
 *
 * Trippar: backend GET /api/v1/admin/trips?month=yyyy-MM
 * Utlägg:  backend GET /api/v1/expenses?status=UNPAID
 */
const CarPoolCSVExporter = () => {
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const now        = new Date();
      const thisMonth  = format(now, 'yyyy-MM');
      const prevMonth  = format(subMonths(now, 1), 'yyyy-MM');

      // Hämta resor för båda månaderna + obetalda utlägg parallellt
      const [thisMonthTrips, prevMonthTrips, unpaidExpenses] = await Promise.all([
        api.get<TripRow[]>(`/admin/trips?month=${thisMonth}`),
        api.get<TripRow[]>(`/admin/trips?month=${prevMonth}`),
        api.get<ExpenseDto[]>('/expenses?status=UNPAID'),
      ]);

      const startDate = new Date(now.getFullYear(), now.getMonth() - 1, 20);
      const endDate   = new Date(now.getFullYear(), now.getMonth(), 20);

      const allTrips = [...prevMonthTrips, ...thisMonthTrips]
        .filter(t => {
          const ts = new Date(t.timestampISO);
          return ts >= startDate && ts < endDate;
        })
        .sort((a, b) => {
          if (a.car.id !== b.car.id) return a.car.id.localeCompare(b.car.id);
          return a.odo - b.odo;
        });

      const header = 'Odo;Distance;User1;User2;User3;Cost;Comment;Timestamp;By User\n';
      const fill   = new Array(2).fill('');
      let csvData  = '\ufeff'; // BOM för Excel
      let currentCarId = '';

      for (const { car, odo, distance, users, cost, comment, timestampISO, byUser } of allTrips) {
        if (car.id !== currentCarId) {
          csvData += '\n\n';
          csvData += `${car.id}\n`;
          csvData += header;
          currentCarId = car.id;
        }
        const userIds = users.map(u => u.id).concat(fill).slice(0, 3);
        const ts      = timestampISO;
        const costStr = cost != null ? cost.toFixed(2).replace('.', ',') : '';
        csvData += `${odo};${distance ?? ''};${userIds.join(';')};${costStr};"${comment ?? ''}";${ts};${byUser?.id}\n`;
      }

      // Sektion: obetalda utlägg
      if (unpaidExpenses.length > 0) {
        csvData += '\n\n';
        csvData += 'OBETALDA UTLÄGG\n';
        csvData += 'Datum;Bil;Belopp;Beskrivning;Registrerad av\n';
        for (const e of unpaidExpenses) {
          const dateStr = new Date(e.createdAt).toLocaleDateString('sv-SE');
          const amtStr  = e.amount.toFixed(2).replace('.', ',');
          csvData += `${dateStr};${e.carId ?? ''};"${amtStr}";\"${e.description.replace(/"/g, '""')}\";${e.byUserId}\n`;
        }
      }

      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href     = url;
      link.download = `ghbilpool-${format(endDate, 'yyyy-MM-dd')}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('CSV export failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handleExport}
      disabled={loading}
      variant="outline"
      size="icon"
      className="fixed bottom-4 left-4 rounded-full h-12 w-12 shadow-lg [&_svg]:size-6"
      aria-label="Export to CSV"
    >
      <Download />
    </Button>
  );
};

export default CarPoolCSVExporter;
