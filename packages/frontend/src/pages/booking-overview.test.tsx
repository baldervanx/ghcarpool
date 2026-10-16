import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { addDays, format, startOfDay } from 'date-fns';
import store, { setAuthState, setBookings, setCarState } from '@/store';
import BookingOverview from './booking-overview';
import type { BookingCellParam } from '@/components/booking-cell';

const { navigate, loadMonth } = vi.hoisted(() => ({ navigate: vi.fn(), loadMonth: vi.fn() }));
vi.mock('react-router-dom', async importOriginal => ({
  ...await importOriginal<typeof import('react-router-dom')>(), useNavigate: () => navigate,
}));
vi.mock('@/db/use-booking-month-loader', () => ({
  useBookingMonthLoader: () => ({ loadMonth }),
}));
vi.mock('@/components/booking-cell', () => ({
  default: ({ date, car, readOnly, onClick }: BookingCellParam) => (
    <button disabled={readOnly} onClick={() => onClick({ date, car })}>
      {format(date, 'yyyy-MM-dd')}
    </button>
  ),
}));

beforeEach(() => {
  navigate.mockReset();
  store.dispatch(setBookings([]));
  store.dispatch(setCarState({
    cars: [{ id: 'car1', name: 'Car 1', range: 100, order: 1, hasLog: false }],
  }));
});

describe('historical booking creation in overview', () => {
  it.each([false, true])('only enables past dates when test mode is %s', allowPastBookings => {
    store.dispatch(setAuthState({
      user: null, isMember: false, loading: false, allowPastBookings,
    }));
    const date = startOfDay(addDays(new Date(), -1));
    render(<Provider store={store}><MemoryRouter initialEntries={[{
      pathname: '/booking-overview', state: { date },
    }]}><BookingOverview /></MemoryRouter></Provider>);
    const button = screen.getByRole('button', { name: format(date, 'yyyy-MM-dd') });
    if (allowPastBookings) {
      expect(button).toBeEnabled();
      expect(screen.getByRole('status')).toHaveTextContent('Testläge');
      fireEvent.click(button);
      expect(navigate).toHaveBeenCalledWith('/book-trip', { state: { car: 'car1', date } });
    } else {
      expect(button).toBeDisabled();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    }
  });
});
