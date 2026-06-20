import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, waitFor } from '@testing-library/react';
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
});
