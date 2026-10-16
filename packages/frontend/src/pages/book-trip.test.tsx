import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks';
import store, {
  setAuthState,
  setBookings,
  setCarState,
  setSelectedUsers,
  setUsers,
  DateCarBooking,
  Booking,
} from '@/store';
import BookTrip from './book-trip';
import { BookTripPage } from '@/test/bookTripPage';
import { format, addDays } from 'date-fns';

const navMock = vi.fn();
vi.mock('react-router-dom', async (importOrig) => {
  const mod = await importOrig<typeof import('react-router-dom')>();
  return { ...mod, useNavigate: () => navMock };
});

function seedBaseStore() {
  store.dispatch(setAuthState({
    user: { uid: 'uid-1', email: 'u1@example.com', user_id: 'u1', isAdmin: false },
    isMember: true,
    loading: false,
  }));
  store.dispatch(setUsers([
    { id: 'u1', email: 'u1@example.com', isAdmin: false, shortName: 'U1' },
  ] as any));
  store.dispatch(setCarState({
    cars: [{ id: 'car1', name: 'Car 1', range: 100, order: 1, hasLog: false }],
    selectedCar: 'car1',
  }));
  store.dispatch(setSelectedUsers(['u1']));
  store.dispatch(setBookings([]));
}

function buildExistingSingle(date: string): DateCarBooking {
  return {
    id: 'dcb-existing',
    date,
    car: { id: 'car1' },
    bookings: [{
      id: 'b-existing',
      users: [{ id: 'u1' }],
      startTime: 480,
      endTime: 540,
      distance: 5,
      destination: 'X',
      byUser: { id: 'u1' },
      comment: 'Existing',
    }],
  } as any;
}

// ── Hjälpare: samla POST /bookings-anrop ──────────────────────────────────────

function captureBookingRequests() {
  const calls: unknown[] = [];
  server.use(
    http.post('/api/v1/bookings', async ({ request }) => {
      const body = await request.json();
      calls.push(body);
      return HttpResponse.json({ id: `new-${calls.length}` }, { status: 201 });
    }),
  );
  return calls;
}

function capturePutRequests() {
  const calls: unknown[] = [];
  server.use(
    http.put('/api/v1/bookings/:id', async ({ request }) => {
      const body = await request.json();
      calls.push(body);
      return HttpResponse.json({ id: 'b-existing', ...body as object });
    }),
  );
  return calls;
}

describe('BookTrip scenarios', () => {
  beforeEach(() => {
    navMock.mockReset();
    seedBaseStore();
  });

  it('rejects a new historical booking without test mode, even if the date input is bypassed', async () => {
    const calls = captureBookingRequests();
    const { container } = render(
      <Provider store={store}><MemoryRouter><BookTrip /></MemoryRouter></Provider>,
    );
    const input = container.querySelector('input[type="date"]');
    expect(input).toHaveAttribute('min', format(new Date(), 'yyyy-MM-dd'));
    fireEvent.change(input, { target: { value: format(addDays(new Date(), -3), 'yyyy-MM-dd') } });
    const page = new BookTripPage();
    await page.selectStart('08', '00');
    await page.selectEnd('09', '00');
    await page.setDistance('10');
    await page.submit();
    expect(await screen.findByText('Nya bokningar får inte ligga före dagens datum')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    expect(navMock).not.toHaveBeenCalled();
  });

  it.each(['single', 'recurring', 'multi-day'])('creates historical %s bookings in test mode', async kind => {
    store.dispatch(setAuthState({ ...store.getState().auth, allowPastBookings: true }));
    const calls = captureBookingRequests();
    const start = addDays(new Date(), -7);
    const end = addDays(start, 2);
    const { container } = render(
      <Provider store={store}><MemoryRouter initialEntries={[{
        pathname: '/book-trip', state: { car: 'car1', date: start },
      }]}><BookTrip /></MemoryRouter></Provider>,
    );
    expect(container.querySelector('input[type="date"]')).not.toHaveAttribute('min');
    expect(screen.getByRole('status')).toHaveTextContent('Testläge');
    const page = new BookTripPage();
    if (kind === 'recurring') {
      await page.toggleRecurring();
      await page.selectRecurringDay((start.getDay() + 6) % 7);
      await page.setEndDate(format(end, 'yyyy-MM-dd'));
    } else if (kind === 'multi-day') {
      await page.toggleMultiDay();
      await page.setEndDate(format(end, 'yyyy-MM-dd'));
    }
    await page.selectStart('08', '00');
    await page.selectEnd('09', '00');
    await page.setDistance('10');
    await page.submit();
    await waitFor(() => expect(navMock).toHaveBeenCalled());
    expect(calls).toHaveLength(kind === 'multi-day' ? 3 : 1);
    expect(calls[0]).toMatchObject({ date: format(start, 'yyyy-MM-dd') });
    expect(calls.every(call => (call as { date: string }).date < format(new Date(), 'yyyy-MM-dd'))).toBe(true);
  });

  it('creates a simple booking and persists it via REST', async () => {
    const calls = captureBookingRequests();
    const page  = new BookTripPage();

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/book-trip']}>
          <BookTrip />
        </MemoryRouter>
      </Provider>,
    );

    await page.selectStart('08', '00');
    await page.selectEnd('09', '00');
    await page.setDistance('10');
    await page.submit();

    await waitFor(() =>
      expect(navMock.mock.calls.some(c => String(c[0]).includes('/booking-overview'))).toBe(true),
    );
    expect(calls.length).toBe(1);
  });

  it('creates a recurring booking across selected weekdays', async () => {
    const calls      = captureBookingRequests();
    const page       = new BookTripPage();
    const endDateStr = format(addDays(new Date(), 7), 'yyyy-MM-dd');

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/book-trip']}>
          <BookTrip />
        </MemoryRouter>
      </Provider>,
    );

    await page.selectStart('10', '00');
    await page.selectEnd('11', '00');
    await page.toggleRecurring();
    await page.selectRecurringDay(0); // Måndag
    await page.selectRecurringDay(2); // Onsdag
    await page.setEndDate(endDateStr);
    await page.setDistance('12');
    await page.submit();

    await waitFor(() =>
      expect(navMock.mock.calls.some(c => String(c[0]).includes('/booking-overview'))).toBe(true),
    );
    // Minst 2 anrop (en per vald dag som matchar inom perioden)
    expect(calls.length).toBeGreaterThanOrEqual(2);
    calls.forEach((call: any) => {
      expect(call).toMatchObject({ startTime: 600, endTime: 660 });
      expect(call.recurrenceId).toBeTruthy();
      expect(call.isMultiDay).toBe(false);
      expect(call.recurringDays).toEqual([0, 2]);
      expect(call.recurringEndDate).toBe(endDateStr);
    });
  });

  it('creates a multi-day booking spanning several days', async () => {
    const calls      = captureBookingRequests();
    const page       = new BookTripPage();
    const endDate    = addDays(new Date(), 2);
    const endDateStr = format(endDate, 'yyyy-MM-dd');

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/book-trip']}>
          <BookTrip />
        </MemoryRouter>
      </Provider>,
    );

    await page.toggleMultiDay();
    await page.selectStart('08', '00');
    await page.selectEnd('10', '00');
    await page.setEndDate(endDateStr);
    await page.setDistance('50');
    await page.submit();

    await waitFor(() =>
      expect(navMock.mock.calls.some(c => String(c[0]).includes('/booking-overview'))).toBe(true),
    );
    // Tre dagar: idag + dag 1 + dag 2
    expect(calls.length).toBe(3);
    const lastCall = calls[calls.length - 1] as any;
    expect(lastCall.date).toBe(endDateStr);
    expect(lastCall).toMatchObject({
      isMultiDay: true, recurringStartDate: format(new Date(), 'yyyy-MM-dd'),
      recurringEndDate: endDateStr, recurringDays: [],
    });
  });

  it('edits an existing booking and updates distance via REST', async () => {
    // book-trip använder POST /bookings (upsert) även vid edit
    const postCalls = captureBookingRequests();
    const existingDate = format(new Date(), 'yyyy-MM-dd');
    store.dispatch(setBookings([buildExistingSingle(existingDate)]));

    const page = new BookTripPage();
    render(
      <Provider store={store}>
        <MemoryRouter
          initialEntries={[{
            pathname: '/book-trip',
            state: { parent_id: 'dcb-existing', booking_id: 'b-existing' },
          }]}
        >
          <BookTrip />
        </MemoryRouter>
      </Provider>,
    );

    await page.selectEnd('10', '00');
    await page.setDistance('15');
    await page.submit();

    await waitFor(() =>
      expect(navMock.mock.calls.some(c => String(c[0]).includes('/booking-overview'))).toBe(true),
    );
    expect(postCalls.length).toBeGreaterThanOrEqual(1);
    expect((postCalls[postCalls.length - 1] as any).distance).toBe(15);
    expect((postCalls[postCalls.length - 1] as any).endTime).toBe(600);
  });

  it('edits an unlogged past booking without forcing its date to today', async () => {
    const calls = captureBookingRequests();
    const date = format(addDays(new Date(), -3), 'yyyy-MM-dd');
    store.dispatch(setBookings([buildExistingSingle(date)]));
    const { container } = render(
      <Provider store={store}><MemoryRouter initialEntries={[{
        pathname: '/book-trip', state: { parent_id: 'dcb-existing', booking_id: 'b-existing' },
      }]}><BookTrip /></MemoryRouter></Provider>,
    );
    expect(container.querySelector('input[type="date"]')).not.toHaveAttribute('min');
    const page = new BookTripPage();
    await page.setDistance('15');
    await page.submit();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ date, existingBookingId: 'b-existing' });
  });

  it('does not offer editing a logged booking via direct navigation', () => {
    const existing = buildExistingSingle(format(new Date(), 'yyyy-MM-dd'));
    existing.bookings[0].logged = 'trip';
    store.dispatch(setBookings([existing]));
    render(<Provider store={store}><MemoryRouter initialEntries={[{
      pathname: '/book-trip', state: { parent_id: 'dcb-existing', booking_id: 'b-existing' },
    }]}><BookTrip /></MemoryRouter></Provider>);
    expect(screen.getByText('Bokningen är loggad och kan inte ändras.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Spara|Boka/ })).not.toBeInTheDocument();
  });

  it('preserves logged historical instances when editing a recurring series', async () => {
    const calls = captureBookingRequests();
    const deleted: string[] = [];
    server.use(http.delete('/api/v1/bookings/:parentId/:bookingId', ({ params }) => {
      deleted.push(String(params.bookingId));
      return new HttpResponse(null, { status: 204 });
    }));
    const series = [0, 1, 2].map(offset => {
      const entry = buildExistingSingle(format(addDays(new Date(), offset), 'yyyy-MM-dd'));
      entry.id = `parent-${offset}`;
      entry.bookings[0] = {
        ...entry.bookings[0], id: `instance-${offset}`, parent_id: entry.id, recurrenceId: 'series',
        logged: offset === 0 ? 'logged-trip' : undefined,
      };
      return entry;
    });
    store.dispatch(setBookings(series));
    render(<Provider store={store}><MemoryRouter initialEntries={[{
      pathname: '/book-trip', state: { parent_id: 'parent-1', booking_id: 'instance-1' },
    }]}><BookTrip /></MemoryRouter></Provider>);
    const page = new BookTripPage();
    await page.submit();
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map(call => (call as { existingBookingId: string }).existingBookingId))
      .toEqual(['instance-1', 'instance-2']);
    expect(deleted).toEqual([]);
  });

  it('loads a complete persisted multi-day series before editing from a partial booking window', async () => {
    const calls = captureBookingRequests();
    const start = format(addDays(new Date(), -2), 'yyyy-MM-dd');
    const end = format(new Date(), 'yyyy-MM-dd');
    const recurrence = { id: 'multi', isMultiDay: true, recurringStartDate: start, recurringEndDate: end, recurringDays: [] };
    const series = [0, 1, 2].map(offset => {
      const entry = buildExistingSingle(format(addDays(new Date(), offset - 2), 'yyyy-MM-dd'));
      entry.id = `parent-${offset}`;
      entry.bookings[0] = {
        ...entry.bookings[0], id: `part-${offset}`, parent_id: entry.id,
        recurrenceId: 'multi', recurrence,
        startTime: offset === 0 ? 480 : 0, endTime: offset === 2 ? 600 : 1440,
        distance: offset === 2 ? 50 : 0,
      };
      return entry;
    });
    const ranges: string[][] = [];
    server.use(http.get('/api/v1/bookings', ({ request }) => {
      const query = new URL(request.url).searchParams;
      ranges.push([query.get('startDate')!, query.get('endDate')!]);
      return HttpResponse.json({ startDate: start, endDate: end, since: null, bookings: series });
    }));
    store.dispatch(setBookings([series[1]]));
    render(<Provider store={store}><MemoryRouter initialEntries={[{
      pathname: '/book-trip', state: { parent_id: 'parent-1', booking_id: 'part-1' },
    }]}><BookTrip /></MemoryRouter></Provider>);
    await waitFor(() => expect(screen.getByRole('spinbutton')).toHaveValue(50));
    expect(screen.getByRole('checkbox', { name: 'Flerdagars' })).toBeChecked();
    expect(ranges).toEqual([[start, end]]);
    const page = new BookTripPage();
    await page.submit();
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls.map(call => (call as { existingBookingId: string }).existingBookingId))
      .toEqual(['part-0', 'part-1', 'part-2']);
    expect(calls.every(call => (call as { isMultiDay: boolean }).isMultiDay)).toBe(true);
  });

  it('requires an explicit series type before saving unresolved legacy recurrence metadata', async () => {
    const entry = buildExistingSingle(format(new Date(), 'yyyy-MM-dd'));
    entry.bookings[0] = {
      ...entry.bookings[0], recurrenceId: 'unknown',
      recurrence: {
        id: 'unknown', isMultiDay: null, recurringStartDate: entry.date,
        recurringEndDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'), recurringDays: [0, 1, 2, 3, 4, 5, 6],
      },
    };
    server.use(http.get('/api/v1/bookings', () => HttpResponse.json({ bookings: [entry] })));
    store.dispatch(setBookings([entry]));
    render(<Provider store={store}><MemoryRouter initialEntries={[{
      pathname: '/book-trip', state: { parent_id: entry.id, booking_id: entry.bookings[0].id },
    }]}><BookTrip /></MemoryRouter></Provider>);
    await screen.findByText(/Välj Återkommande eller Flerdagars innan du sparar/);
    expect(screen.getByRole('button', { name: 'Spara ändringar' })).toBeDisabled();
    const page = new BookTripPage();
    await page.toggleRecurring();
    expect(screen.getByRole('button', { name: 'Spara ändringar' })).not.toBeDisabled();
  });

  it('treats consecutive full-day bookings as ordinary recurrence when metadata says so', async () => {
    const start = format(new Date(), 'yyyy-MM-dd');
    const end = format(addDays(new Date(), 1), 'yyyy-MM-dd');
    const recurrence = {
      id: 'ordinary', isMultiDay: false, recurringStartDate: start, recurringEndDate: end,
      recurringDays: [0, 1, 2, 3, 4, 5, 6],
    };
    const series = [start, end].map((date, index) => {
      const entry = buildExistingSingle(date);
      entry.id = `ordinary-parent-${index}`;
      entry.bookings[0] = {
        ...entry.bookings[0], id: `ordinary-${index}`, startTime: 0, endTime: 1440,
        recurrenceId: recurrence.id, recurrence,
      };
      return entry;
    });
    server.use(http.get('/api/v1/bookings', () => HttpResponse.json({ bookings: series })));
    store.dispatch(setBookings([series[0]]));
    render(<Provider store={store}><MemoryRouter initialEntries={[{
      pathname: '/book-trip', state: { parent_id: series[0].id, booking_id: series[0].bookings[0].id },
    }]}><BookTrip /></MemoryRouter></Provider>);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Återkommande' })).toBeChecked());
    expect(screen.getByRole('checkbox', { name: 'Flerdagars' })).not.toBeChecked();
  });

  it('explicitly detaches only the chosen instance when recurring mode is disabled', async () => {
    const calls = captureBookingRequests();
    const series = [0, 1].map(offset => {
      const entry = buildExistingSingle(format(addDays(new Date(), offset), 'yyyy-MM-dd'));
      entry.id = `parent-${offset}`;
      entry.bookings[0] = { ...entry.bookings[0], id: `part-${offset}`, recurrenceId: 'series' };
      return entry;
    });
    store.dispatch(setBookings(series));
    render(<Provider store={store}><MemoryRouter initialEntries={[{
      pathname: '/book-trip', state: { parent_id: 'parent-0', booking_id: 'part-0' },
    }]}><BookTrip /></MemoryRouter></Provider>);
    const page = new BookTripPage();
    await page.toggleRecurring();
    await page.setDistance('15');
    await page.submit();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ existingBookingId: 'part-0', recurrenceId: null, distance: 15 });
  });
});
