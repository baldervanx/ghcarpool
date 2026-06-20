/**
 * Testar RegisterTrip-sidan (packages/frontend/src/pages/register-trip.tsx):
 *   tripsApi.create → POST /trips   (normalt flöde)
 *   tripsApi.update → PUT /trips/:id (redigeringsläge)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks';
import { TEST_TRIPS, TEST_CARS } from '@/test/handlers';
import store, {
  setAuthState,
  setCarState,
  setSelectedCar,
  setSelectedUsers,
  setUsers,
  setTrips,
  fetchSettings,
} from '@/store';
import { RegisterTrip } from './register-trip';

const navMock = vi.fn();
vi.mock('react-router-dom', async (importOrig) => {
  const mod = await importOrig<typeof import('react-router-dom')>();
  return { ...mod, useNavigate: () => navMock };
});

function seedStore(opts: { editMode?: boolean } = {}) {
  store.dispatch(setAuthState({
    user: { uid: 'u1', email: 'u1@test.com', user_id: 'u1', isAdmin: false },
    isMember: true,
    loading: false,
  }));
  store.dispatch(setUsers([
    { id: 'u1', email: 'u1@test.com', isAdmin: false, shortName: 'U1', commentMandatory: false },
  ] as any));
  store.dispatch(setCarState({ cars: TEST_CARS, selectedCar: 'c1' }));
  store.dispatch(setSelectedCar('c1'));
  store.dispatch(setSelectedUsers(['u1']));
  store.dispatch(setTrips(TEST_TRIPS as any));
}

// Initialisera settings en gång för alla tester
beforeAll(async () => {
  await store.dispatch(fetchSettings());
});

function renderPage(locationState?: unknown) {
  const initialEntry = locationState
    ? { pathname: '/register-trip', state: locationState }
    : '/register-trip';
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <RegisterTrip />
      </MemoryRouter>
    </Provider>,
  );
}

describe('RegisterTrip', () => {
  beforeEach(() => {
    navMock.mockReset();
    seedStore();
  });

  it('skapar en ny resa (POST /trips) och navigerar till /trip-log', async () => {
    const calls: unknown[] = [];
    server.use(
      http.post('/api/v1/trips', async ({ request }) => {
        const body = await request.json();
        calls.push(body);
        return HttpResponse.json({ id: 'new-trip', ...(body as object) }, { status: 201 });
      }),
    );

    renderPage();

    // Fyll i "sista siffror" — sista 4 siffror av ny mätarställning
    // Senaste trip har odo=87200, vi skriver in 7225 → odo=87225, dist=25
    const odoInput = screen.getByLabelText('Sista siffror');
    fireEvent.change(odoInput, { target: { value: '7225' } });

    const submitBtn = await waitFor(() =>
      screen.getByRole('button', { name: /Spara resa/i }),
    );
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() =>
      expect(navMock).toHaveBeenCalledWith('/trip-log'),
    );
    expect(calls.length).toBe(1);
    expect((calls[0] as any).distance).toBe(25);
    expect((calls[0] as any).carId).toBe('c1');
  });

  it('skapar resa kopplad till bokning — skickar bookingId + parentId', async () => {
    const calls: unknown[] = [];
    server.use(
      http.post('/api/v1/trips', async ({ request }) => {
        const body = await request.json();
        calls.push(body);
        return HttpResponse.json({ id: 'new-trip', ...(body as object) }, { status: 201 });
      }),
    );

    const booking = {
      id: 'b1',
      parent_id: 'dcb1',
      car: { id: 'c1' },
      users: [{ id: 'u1' }],
      endTime: 540,
      distance: 25,
      destination: 'LN',
    };

    renderPage({ booking });

    const odoInput = screen.getByLabelText('Sista siffror');
    fireEvent.change(odoInput, { target: { value: '7225' } });

    const submitBtn = await waitFor(() =>
      screen.getByRole('button', { name: /Spara resa/i }),
    );
    fireEvent.click(submitBtn);

    await waitFor(() => expect(navMock).toHaveBeenCalledWith('/trip-log'));
    expect((calls[0] as any).bookingId).toBe('b1');
    expect((calls[0] as any).parentId).toBe('dcb1');
  });

  it('uppdaterar senaste resa (PUT /trips/:id) i redigeringsläge', async () => {
    const putCalls: unknown[] = [];
    server.use(
      http.put('/api/v1/trips/:id', async ({ request, params }) => {
        const body = await request.json();
        putCalls.push({ id: params.id, ...(body as object) });
        return HttpResponse.json({ id: params.id, ...(body as object) });
      }),
    );

    renderPage();

    // Aktivera redigeringsläge — kryssrutan visas när canEdit=true (byUser.id === u1)
    const editCheckbox = await waitFor(() =>
      screen.getByRole('checkbox', { name: /Redigera din senaste resa/i }),
    );
    fireEvent.click(editCheckbox);

    // I redigeringsläge är odo förifyllt med lastTrip.odo; ändra sista siffror
    const odoInput = screen.getByLabelText('Sista siffror');
    fireEvent.change(odoInput, { target: { value: '7225' } });

    const submitBtn = await waitFor(() =>
      screen.getByRole('button', { name: /Uppdatera resa/i }),
    );
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => expect(navMock).toHaveBeenCalledWith('/trip-log'));
    expect(putCalls.length).toBe(1);
    expect((putCalls[0] as any).id).toBe('t1'); // senaste trip = t1
  });
});
