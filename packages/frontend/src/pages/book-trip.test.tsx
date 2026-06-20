import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, waitFor } from '@testing-library/react';
import store, { setAuthState, setBookings, setCarState, setSelectedUsers, setUsers, DateCarBooking, Booking } from '@/store';
import BookTrip from './book-trip';
import { BookTripPage } from '@/test/bookTripPage';
import { getCollectionDocs, resetMockData } from '@/test/mocks';
import { format, addDays } from 'date-fns';

const navMock = vi.fn();
vi.mock('react-router-dom', async (orig) => { const mod = await orig(); return { ...mod, useNavigate: () => navMock }; });

function seedBaseStore() {
  store.dispatch(setAuthState({ user: { uid: 'uid-1', email: 'u1@example.com', user_id: 'u1', isAdmin: false }, isMember: true, loading: false }));
  store.dispatch(setUsers([{ id: 'u1', email: 'u1@example.com', isAdmin: false, shortName: 'U1' }] as any));
  store.dispatch(setCarState({ cars: [{ id: 'car1', name: 'Car 1', range: 100, order: 1, hasLog: false }], selectedCar: 'car1' }));
  store.dispatch(setSelectedUsers(['u1']));
  store.dispatch(setBookings([]));
}

function buildExistingSingle(date: string): DateCarBooking {
  return { id: 'dcb-existing', date, car: { id: 'car1' }, bookings: [{ id: 'b-existing', users: [{ id: 'u1' }], startTime: 480, endTime: 540, distance: 5, destination: 'X', byUser: { id: 'u1' }, comment: 'Existing' }] } as any;
}
const pushBookingsState = (dcb: DateCarBooking[]) => store.dispatch(setBookings(dcb));

describe('BookTrip scenarios', () => {
  beforeEach(() => { resetMockData(); navMock.mockReset(); seedBaseStore(); });

  it('creates a simple booking and persists it', async () => {
    const page = new BookTripPage();
    render(<Provider store={store}><MemoryRouter initialEntries={['/book-trip']}><BookTrip /></MemoryRouter></Provider>);
    await page.selectStart('08', '00');
    await page.selectEnd('09', '00');
    await page.setDistance('10');
    await page.submit();
    await waitFor(() => expect(navMock.mock.calls.some(c => c[0].toString().includes('/booking-overview'))).toBe(true));
    const docs = getCollectionDocs('date-car-bookings');
    expect(docs.length).toBe(1); expect(docs[0].bookings.length).toBe(1);
  });

  it('creates a recurring booking across selected weekdays', async () => {
    const page = new BookTripPage();
    render(<Provider store={store}><MemoryRouter initialEntries={['/book-trip']}><BookTrip /></MemoryRouter></Provider>);
    const endDateStr = format(addDays(new Date(), 7), 'yyyy-MM-dd');
    await page.selectStart('10', '00');
    await page.selectEnd('11', '00');
    await page.toggleRecurring();
    await page.selectRecurringDay(0); // Monday
    await page.selectRecurringDay(2); // Wednesday
    await page.setEndDate(endDateStr);
    await page.setDistance('12');
    await page.submit();
    await waitFor(() => expect(navMock.mock.calls.some(c => c[0].toString().includes('/booking-overview'))).toBe(true));
    const docs = getCollectionDocs('date-car-bookings');
    expect(docs.length).toBeGreaterThanOrEqual(2);
    docs.forEach(d => d.bookings.forEach((b: Booking) => { expect(b.recurrenceId).toBeTruthy(); expect(b.startTime).toBe(600); expect(b.endTime).toBe(660); }));
  });

  it('creates a multi-day booking spanning several days', async () => {
    const page = new BookTripPage();
    render(<Provider store={store}><MemoryRouter initialEntries={['/book-trip']}><BookTrip /></MemoryRouter></Provider>);
    const endDate = addDays(new Date(), 2); const endDateStr = format(endDate, 'yyyy-MM-dd');
    await page.toggleMultiDay();
    await page.selectStart('08', '00');
    await page.selectEnd('10', '00');
    await page.setEndDate(endDateStr);
    await page.setDistance('50');
    await page.submit();
    await waitFor(() => expect(navMock.mock.calls.some(c => c[0].toString().includes('/booking-overview'))).toBe(true));
    const docs = getCollectionDocs('date-car-bookings');
    expect(docs.length).toBe(3);
    const lastDay = docs.find(d => d.date === endDateStr); expect(lastDay).toBeTruthy();
    const lastBooking = lastDay!.bookings.find((b: Booking) => b.endTime === 600); expect(lastBooking).toBeTruthy();
  });

  it('edits an existing booking (same date) and updates distance', async () => {
    const existingDate = format(new Date(), 'yyyy-MM-dd'); pushBookingsState([buildExistingSingle(existingDate)]);
    const page = new BookTripPage();
    render(<Provider store={store}><MemoryRouter initialEntries={[{ pathname: '/book-trip', state: { parent_id: 'dcb-existing', booking_id: 'b-existing' } }]}><BookTrip /></MemoryRouter></Provider>);
    await page.selectEnd('10', '00');
    await page.setDistance('15');
    await page.submit();
    await waitFor(() => expect(navMock.mock.calls.some(c => c[0].toString().includes('/booking-overview'))).toBe(true));
    const docs = getCollectionDocs('date-car-bookings');
    expect(docs.length).toBe(1);
    const updated = docs[0].bookings.find((b: Booking) => b.id === 'b-existing');
    expect(updated).toBeTruthy(); expect(updated!.endTime).toBe(600); expect(updated!.distance).toBe(15);
  });
});

