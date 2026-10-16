/**
 * Testar RegisterTrip-sidan (packages/frontend/src/pages/register-trip.tsx):
 *   tripsApi.create → POST /trips   (normalt flöde)
 *   tripsApi.update → PUT /trips/:id (redigeringsläge)
 */
import React from 'react';
import { addDays, format } from 'date-fns';
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  setBookings,
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
  store.dispatch(setBookings([]));
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

function otherUserBooking() {
  return {
    id: 'other-booking', parent_id: 'other-parent', car: { id: 'c1' },
    date: format(addDays(new Date(), -1), 'yyyy-MM-dd'),
    users: [{ id: 'u2' }], byUser: { id: 'u2' },
    startTime: 480, endTime: 540, distance: 25, destination: '',
  };
}

const confirmationLabel = 'Jag bekräftar att rätt användare och resa är valda.';

describe('RegisterTrip', () => {
  beforeEach(() => {
    navMock.mockReset();
    seedStore();
  });
  afterEach(() => vi.useRealTimers());

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

  it.each([
    { daysAgo: 0, userId: 'u2', logged: undefined, warns: true },
    { daysAgo: 1, userId: 'u2', logged: undefined, warns: true },
    { daysAgo: 3, userId: 'u2', logged: undefined, warns: true },
    { daysAgo: 0, userId: 'u1', logged: undefined, warns: false },
    { daysAgo: 1, userId: 'u1', logged: undefined, warns: false },
    { daysAgo: 1, userId: 'u2', logged: 'trip', warns: false },
  ])('handles a predecessor from $daysAgo days ago by $userId (logged=$logged)', ({ daysAgo, userId, logged, warns }) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 11, 10));
    const date = format(new Date(), 'yyyy-MM-dd');
    const previousDate = format(addDays(new Date(), -daysAgo), 'yyyy-MM-dd');
    const previous = {
      id: 'previous', users: [{ id: userId }], byUser: { id: userId }, logged,
      startTime: 480, endTime: 540, distance: 25, destination: '',
    };
    const current = {
      ...previous, id: 'current', logged: undefined, users: [{ id: 'u1' }], startTime: 600, endTime: 660,
      date, parent_id: 'current-parent', car: { id: 'c1' },
    };
    store.dispatch(setBookings([
      { id: 'current-parent', date, car: { id: 'c1' }, bookings: daysAgo === 0 ? [previous, current] : [current] },
      ...(daysAgo === 0 ? [] : [{ id: 'previous-parent', date: previousDate, car: { id: 'c1' }, bookings: [previous] }]),
    ]));
    renderPage({ booking: current });
    const warning = screen.queryByText(/Föregående bokning på Volvo XC60 har inte loggats/);
    if (warns) expect(warning).toBeInTheDocument();
    else expect(warning).not.toBeInTheDocument();
  });

  it('auto-selects the oldest unlogged booking, prefills its users and warns before logging for others', async () => {
    store.dispatch(setUsers([
      { id: 'u1', name: 'Me', email: 'u1@test.com', isAdmin: false, shortName: 'U1' },
      { id: 'u2', name: 'Other', email: 'u2@test.com', isAdmin: false, shortName: 'U2' },
    ]));
    const date = format(addDays(new Date(), -2), 'yyyy-MM-dd');
    const old = {
      id: 'old', users: [{ id: 'u2' }], byUser: { id: 'u2' }, startTime: 480, endTime: 540,
      distance: 25, destination: '',
    };
    store.dispatch(setBookings([
      { id: 'new-parent', date: format(addDays(new Date(), -1), 'yyyy-MM-dd'), car: { id: 'c1' }, bookings: [{ ...old, id: 'new' }] },
      { id: 'old-parent', date, car: { id: 'c1' }, bookings: [old] },
    ]));
    const calls: unknown[] = [];
    server.use(http.post('/api/v1/trips', async ({ request }) => {
      calls.push(await request.json());
      return HttpResponse.json({ id: 'trip' }, { status: 201 });
    }));
    renderPage();
    expect(screen.getByText('Notera: Du loggar bokning åt U2.')).toBeInTheDocument();
    expect(screen.getByText(/Observera: Du loggar en bokning från/)).toBeInTheDocument();
    expect(store.getState().user.selectedUsers).toEqual(['u2']);
    fireEvent.change(screen.getByLabelText('Sista siffror'), { target: { value: '7225' } });
    const save = screen.getByRole('button', { name: 'Spara resa' });
    const confirmation = screen.getByRole('checkbox', { name: confirmationLabel });
    expect(confirmation).not.toBeChecked();
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(calls).toHaveLength(0);
    fireEvent.click(confirmation);
    expect(save).toBeEnabled();
    fireEvent.click(confirmation);
    expect(save).toBeDisabled();
    fireEvent.click(confirmation);
    fireEvent.click(save);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(calls[0]).toMatchObject({ bookingId: 'old', parentId: 'old-parent', userIds: ['u2'] });
  });

  it('resets confirmation when switching away from a car and back', () => {
    renderPage({ booking: otherUserBooking() });
    fireEvent.click(screen.getByRole('checkbox', { name: confirmationLabel }));
    expect(screen.getByRole('checkbox', { name: confirmationLabel })).toBeChecked();
    act(() => { store.dispatch(setSelectedCar('c2')); });
    expect(screen.queryByRole('checkbox', { name: confirmationLabel })).not.toBeInTheDocument();
    act(() => { store.dispatch(setSelectedCar('c1')); });
    expect(screen.getByRole('checkbox', { name: confirmationLabel })).not.toBeChecked();
  });

  it('requires a fresh confirmation after unlinking and relinking the booking', () => {
    renderPage({ booking: otherUserBooking() });
    fireEvent.change(screen.getByLabelText('Sista siffror'), { target: { value: '7225' } });
    fireEvent.click(screen.getByRole('checkbox', { name: confirmationLabel }));
    const linked = screen.getByRole('checkbox', { name: /För bokning/ });
    fireEvent.click(linked);
    expect(screen.queryByRole('checkbox', { name: confirmationLabel })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spara resa' })).toBeEnabled();
    fireEvent.click(linked);
    expect(screen.getByRole('checkbox', { name: confirmationLabel })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Spara resa' })).toBeDisabled();
  });

  it('resets confirmation when the selected trip users change', () => {
    renderPage({ booking: otherUserBooking() });
    fireEvent.click(screen.getByRole('checkbox', { name: confirmationLabel }));
    act(() => { store.dispatch(setSelectedUsers(['u1', 'u2'])); });
    expect(screen.getByRole('checkbox', { name: confirmationLabel })).not.toBeChecked();
  });

  it('keeps confirmation across clock ticks and unrelated booking updates', () => {
    vi.useFakeTimers();
    const booking = otherUserBooking();
    const container = { id: booking.parent_id, date: booking.date, car: booking.car, bookings: [booking] };
    store.dispatch(setBookings([container]));
    renderPage({ booking });
    fireEvent.click(screen.getByRole('checkbox', { name: confirmationLabel }));
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => {
      store.dispatch(setBookings([
        container, { id: 'unrelated', date: booking.date, car: { id: 'c2' }, bookings: [] },
      ]));
    });
    expect(screen.getByRole('checkbox', { name: confirmationLabel })).toBeChecked();
  });

  it('resets confirmation after switching to edit mode and back', () => {
    renderPage({ booking: otherUserBooking() });
    fireEvent.click(screen.getByRole('checkbox', { name: confirmationLabel }));
    const editMode = screen.getByRole('checkbox', { name: /Redigera din senaste resa/ });
    fireEvent.click(editMode);
    expect(screen.queryByRole('checkbox', { name: confirmationLabel })).not.toBeInTheDocument();
    fireEvent.click(editMode);
    expect(screen.getByRole('checkbox', { name: confirmationLabel })).not.toBeChecked();
  });

  it('resets confirmation when a different booking is selected automatically after an update', () => {
    const first = otherUserBooking();
    const second = { ...first, id: 'next-booking', startTime: 600, endTime: 660 };
    store.dispatch(setBookings([{
      id: first.parent_id, date: first.date, car: first.car, bookings: [first, second],
    }]));
    renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: confirmationLabel }));
    act(() => {
      store.dispatch(setBookings([{
        id: first.parent_id, date: first.date, car: first.car,
        bookings: [{ ...first, logged: 'trip' }, second],
      }]));
    });
    expect(screen.getByRole('checkbox', { name: /För bokning.*11:00/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: confirmationLabel })).not.toBeChecked();
  });

  it('does not require confirmation for a shared booking that includes the current user', () => {
    const booking = { ...otherUserBooking(), users: [{ id: 'u2' }, { id: 'u1' }] };
    renderPage({ booking });
    fireEvent.change(screen.getByLabelText('Sista siffror'), { target: { value: '7225' } });
    expect(screen.queryByText(/Notera: Du loggar bokning åt/)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: confirmationLabel })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spara resa' })).toBeEnabled();
  });

  it('retains distance confirmation after confirming a booking for someone else', async () => {
    const calls: unknown[] = [];
    server.use(http.post('/api/v1/trips', async ({ request }) => {
      calls.push(await request.json());
      return HttpResponse.json({ id: 'trip' }, { status: 201 });
    }));
    renderPage({ booking: otherUserBooking() });
    fireEvent.change(screen.getByLabelText('Sista siffror'), { target: { value: '7250' } });
    fireEvent.click(screen.getByRole('checkbox', { name: confirmationLabel }));
    fireEvent.click(screen.getByRole('button', { name: 'Spara resa' }));
    expect(await screen.findByRole('alertdialog', { name: 'Bekräfta sträcka' })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ bookingId: 'other-booking', distance: 50 });
  });

  it('retains long-distance confirmation for trips without a linked booking', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Sista siffror'), { target: { value: '7800' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spara resa' }));
    expect(await screen.findByRole('alertdialog', { name: 'Bekräfta lång sträcka' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Avbryt' }));
    expect(navMock).not.toHaveBeenCalled();
  });

  it('warns when no unlogged booking exists', () => {
    renderPage();
    expect(screen.getByText(/Ingen ologgad bokning hittades/)).toBeInTheDocument();
  });

  it('prevents creating a trip when a no-log vehicle remains selected', () => {
    store.dispatch(setCarState({ cars: [{ ...TEST_CARS[0], hasLog: false }], selectedCar: 'c1' }));
    renderPage();
    expect(screen.getByText(/Valt fordon saknar körjournal/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Sista siffror'), { target: { value: '7225' } });
    expect(screen.getByRole('button', { name: 'Spara resa' })).toBeDisabled();
  });

  it('restores an explicitly selected booking after switching away and back to its car', () => {
    const booking = {
      id: 'explicit', parent_id: 'parent', car: { id: 'c1' }, users: [{ id: 'u1' }],
      byUser: { id: 'u1' }, startTime: 480, endTime: 540, distance: 25, destination: '',
    };
    renderPage({ booking });
    expect(screen.getByRole('checkbox', { name: /För bokning/ })).toBeChecked();
    act(() => { store.dispatch(setSelectedCar('c2')); });
    expect(screen.queryByRole('checkbox', { name: /För bokning/ })).not.toBeInTheDocument();
    act(() => { store.dispatch(setSelectedCar('c1')); });
    expect(screen.getByRole('checkbox', { name: /För bokning/ })).toBeChecked();
    expect(store.getState().user.selectedUsers).toEqual(['u1']);
  });

  it('does not allow a stale explicit link to create another trip after an SSE logged update', () => {
    const date = format(new Date(), 'yyyy-MM-dd');
    const booking = {
      id: 'stale', parent_id: 'parent', car: { id: 'c1' }, date, users: [{ id: 'u1' }],
      byUser: { id: 'u1' }, startTime: 480, endTime: 540, distance: 25, destination: '',
    };
    renderPage({ booking });
    act(() => { store.dispatch(setBookings([{
      id: 'parent', date, car: { id: 'c1' }, bookings: [{ ...booking, logged: 'trip' }],
    }])); });
    fireEvent.change(screen.getByLabelText('Sista siffror'), { target: { value: '7225' } });
    expect(screen.getByRole('button', { name: 'Spara resa' })).toBeDisabled();
    expect(screen.getByText(/Bokningen har redan loggats/)).toBeInTheDocument();
  });
});
