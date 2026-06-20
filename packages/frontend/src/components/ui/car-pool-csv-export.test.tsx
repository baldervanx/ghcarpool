/**
 * Testar CarPoolCSVExporter (packages/frontend/src/components/ui/car-pool-csv-export.tsx):
 *   GET /admin/trips?month=yyyy-MM  (anropas 2 gånger — denna + förra månaden)
 *
 * Verifierar att:
 *   - Rätt månader förfrågas
 *   - CSV-filen triggrar en nedladdning (a.click)
 *   - Knappen inaktiveras under hämtning
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks';
import { TEST_ADMIN_TRIPS } from '@/test/handlers';
import store from '@/store';
import CarPoolCSVExporter from './car-pool-csv-export';
import { format, subMonths } from 'date-fns';

function renderExporter() {
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <CarPoolCSVExporter />
      </MemoryRouter>
    </Provider>,
  );
}

describe('CarPoolCSVExporter', () => {
  it('anropar GET /admin/trips?month= för denna och förra månaden', async () => {
    const calledMonths: string[] = [];
    const now       = new Date();
    const thisMonth = format(now, 'yyyy-MM');
    const prevMonth = format(subMonths(now, 1), 'yyyy-MM');

    server.use(
      http.get('/api/v1/admin/trips', ({ request }) => {
        const month = new URL(request.url).searchParams.get('month');
        if (month) calledMonths.push(month);
        return HttpResponse.json(TEST_ADMIN_TRIPS);
      }),
    );

    renderExporter();
    fireEvent.click(screen.getByRole('button', { name: /Export to CSV/i }));

    await waitFor(() => expect(calledMonths.length).toBeGreaterThanOrEqual(2));
    expect(calledMonths).toContain(thisMonth);
    expect(calledMonths).toContain(prevMonth);
  });

  it('triggar en a.click (nedladdning) efter lyckad export', async () => {
    // Mocka URL.createObjectURL + a.click
    const clickSpy = vi.fn();
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');

    // Spionera på document.createElement för att fånga <a>-elementet
    const origCreate2 = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate2(tag);
      if (tag === 'a') {
        Object.defineProperty(el, 'click', { value: clickSpy, writable: true });
      }
      return el;
    });

    server.use(
      http.get('/api/v1/admin/trips', () => HttpResponse.json(TEST_ADMIN_TRIPS)),
    );

    renderExporter();
    fireEvent.click(screen.getByRole('button', { name: /Export to CSV/i }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalled());

    URL.createObjectURL = origCreate;
    vi.restoreAllMocks();
  });

  it('visar knappen som disabled medan export pågår', async () => {
    // Fördröj svaret så att laddningstillståndet hinner synas
    server.use(
      http.get('/api/v1/admin/trips', async () => {
        await new Promise(r => setTimeout(r, 50));
        return HttpResponse.json(TEST_ADMIN_TRIPS);
      }),
    );

    renderExporter();
    const btn = screen.getByRole('button', { name: /Export to CSV/i });
    fireEvent.click(btn);

    // Direkt efter klick ska knappen vara disabled
    expect(btn).toBeDisabled();

    // Och enabled igen när export är klar
    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});
