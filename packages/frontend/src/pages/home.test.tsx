import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { format } from 'date-fns';
import store, { setAuthState, setBookings, setCarState } from '@/store';
import { HomePage } from './home';

const navigate = vi.fn();
vi.mock('react-router-dom', async importOriginal => ({
  ...await importOriginal<typeof import('react-router-dom')>(), useNavigate: () => navigate,
}));
vi.mock('@/components/theme-context', () => ({
  useTheme: () => ({ darkMode: false, toggleDarkMode: vi.fn() }),
}));
vi.mock('@/lib/utils', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/utils')>(),
  useAccessibility: () => ({
    settings: { isHighContrast: false, textSize: 'normal' }, updateSettings: vi.fn(),
  }),
}));
vi.mock('@/components/help-dialog', () => ({ default: () => null }));

const car = { id: 'c1', name: 'Volvo', range: 100, order: 1, hasLog: true };
describe('HomePage booking actions', () => {
  beforeEach(() => {
    navigate.mockReset();
    store.dispatch(setAuthState({
      user: { uid: 'u1', user_id: 'u1', email: 'me@example.com', isAdmin: false },
      isMember: true, loading: false,
    }));
    store.dispatch(setCarState({ cars: [], selectedCar: 'c1' }));
    store.dispatch(setBookings([{
      id: 'parent', car: { id: 'c1' }, date: format(new Date(), 'yyyy-MM-dd'),
      bookings: [{
        id: 'booking', users: [{ id: 'u1' }], byUser: { id: 'u1' },
        startTime: 1380, endTime: 1440, distance: 25, destination: '',
      }],
    }]));
  });

  it('updates when cars load and passes the parent ID to edit and logging routes', () => {
    render(<Provider store={store}><MemoryRouter><HomePage /></MemoryRouter></Provider>);
    expect(screen.queryByText('Bokat Volvo')).not.toBeInTheDocument();
    act(() => { store.dispatch(setCarState({ cars: [car] })); });
    expect(screen.getByText('Bokat Volvo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ändra' }));
    expect(navigate).toHaveBeenCalledWith('/book-trip', {
      state: { parent_id: 'parent', booking_id: 'booking' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Logga' }));
    expect(navigate).toHaveBeenCalledWith('/register-trip', {
      state: { booking: expect.objectContaining({ id: 'booking', parent_id: 'parent' }) },
    });
  });

  it('offers bookings but no log action for a vehicle without a journal', () => {
    store.dispatch(setCarState({ cars: [{ ...car, hasLog: false }] }));
    render(<Provider store={store}><MemoryRouter><HomePage /></MemoryRouter></Provider>);
    expect(screen.getByRole('button', { name: 'Ändra' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Logga' })).not.toBeInTheDocument();
  });
});
