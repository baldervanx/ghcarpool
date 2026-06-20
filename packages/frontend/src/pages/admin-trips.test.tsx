/**
 * Testar AdminTrips-sidan (packages/frontend/src/pages/admin-trips.tsx):
 *   GET /admin/trips        → hämtar resor för listning + filtrering
 *   DELETE /admin/trips/:id → tar bort en resa (bulk)
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks';
import { TEST_ADMIN_TRIPS } from '@/test/handlers';
import store from '@/store';
import AdminTrips from './admin-trips';

function renderPage() {
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <AdminTrips />
      </MemoryRouter>
    </Provider>,
  );
}

describe('AdminTrips', () => {
  it('hämtar resor via GET /admin/trips och visar antal icke-Init-resor', async () => {
    let getCalled = false;
    server.use(
      http.get('/api/v1/admin/trips', () => {
        getCalled = true;
        return HttpResponse.json(TEST_ADMIN_TRIPS);
      }),
    );

    renderPage();

    // Klicka på knappen som triggar GET /admin/trips
    const deleteBtn = screen.getByRole('button', { name: /Delete Non-Init Trips/i });
    fireEvent.click(deleteBtn);

    // Vänta på att antalet icke-Init-resor visas (at2 = 'Regular trip', at1 = 'Init' filtreras bort)
    await waitFor(() => expect(getCalled).toBe(true));

    // TEST_ADMIN_TRIPS har 1 utan 'Init'-kommentar → "1 trips found"
    await waitFor(() =>
      expect(screen.getByText(/1 trips found without/i)).toBeTruthy(),
    );
  });

  it('DELETE /admin/trips/:id anropas för varje icke-Init-resa vid bekräftelse', async () => {
    const deletedIds: string[] = [];
    server.use(
      http.delete('/api/v1/admin/trips/:id', ({ params }) => {
        deletedIds.push(params.id as string);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderPage();

    // Öppna dialog
    fireEvent.click(screen.getByRole('button', { name: /Delete Non-Init Trips/i }));

    // Vänta tills dialogen är öppen (bekräftelseknapp finns)
    const confirmBtn = await waitFor(() =>
      screen.getByRole('button', { name: /Delete Trips/i }),
    );
    fireEvent.click(confirmBtn);

    // Vänta på att at2 (enda icke-Init) deletas
    await waitFor(() => expect(deletedIds).toContain('at2'));
    expect(deletedIds).not.toContain('at1'); // 'Init'-resan ska inte tas bort
  });
});
