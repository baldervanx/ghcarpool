import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import store, { setAuthState, setBookings, setCarState, setUsers } from '@/store';
import type { Booking, DateCarBooking } from '@/store';
import { BookingWarnings } from './booking-warnings';

const car = { id: 'c1', name: 'Volvo', range: 100, order: 1, hasLog: true };
function booking(id: string, userId: string, startTime = 480, endTime = 540): Booking {
  return { id, startTime, endTime, users: [{ id: userId }], byUser: { id: userId }, distance: 25, destination: '' };
}
function day(date: string, bookings: Booking[], carId = 'c1'): DateCarBooking {
  return { id: `parent-${date}-${carId}`, date, car: { id: carId }, bookings };
}
function renderWarnings() {
  const onLog = vi.fn();
  render(<Provider store={store}><BookingWarnings onLog={onLog} /></Provider>);
  return onLog;
}

describe('home booking warnings', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 11, 8, 59, 59));
    store.dispatch(setAuthState({ user: { uid: 'u1', user_id: 'u1', email: 'test@example.com', isAdmin: false }, isMember: true, loading: false }));
    store.dispatch(setCarState({ cars: [car, { ...car, id: 'c2', name: 'Tesla' }, { ...car, id: 'trailer', hasLog: false }], selectedCar: 'c1' }));
    store.dispatch(setUsers([{ id: 'u2', name: 'Other', shortName: 'Andra', email: 'other@example.com', isAdmin: false }]));
    store.dispatch(setBookings([]));
  });
  afterEach(() => vi.useRealTimers());

  it('shows the car and other user only after the previous slot ends without a reload', () => {
    store.dispatch(setBookings([day('2026-10-11', [booking('other', 'u2'), booking('mine', 'u1', 600, 660)])]));
    const onLog = renderWarnings();
    expect(screen.queryByText('Föregående bokning ej loggad')).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('Bokning av Andra på Volvo har inte loggats.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Logga' }));
    expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ id: 'other', parent_id: 'parent-2026-10-11-c1' }));
  });

  it('shows the latest missed own booking per car, including completed slots today', () => {
    vi.setSystemTime(new Date(2026, 9, 11, 10));
    store.dispatch(setBookings([
      day('2026-10-01', [booking('older', 'u1')]),
      day('2026-10-10', [booking('yesterday', 'u1')]),
      day('2026-10-11', [booking('today', 'u1')]),
      day('2026-10-09', [booking('second-car', 'u1')], 'c2'),
      day('2026-10-10', [booking('no-log', 'u1')], 'trailer'),
      day('2026-09-26', [booking('too-old', 'u1')]),
    ]));
    const onLog = renderWarnings();
    const buttons = screen.getAllByRole('button', { name: 'Logga' });
    expect(buttons).toHaveLength(2);
    buttons.forEach(button => fireEvent.click(button));
    expect(onLog.mock.calls.map(([entry]) => entry.id)).toEqual(['today', 'second-car']);
  });

  it('offers correction, not logging, for unresolved legacy series', () => {
    store.dispatch(setBookings([day('2026-10-10', [{
      ...booking('unknown', 'u1'), recurrenceId: 'unknown',
      recurrence: {
        id: 'unknown', isMultiDay: null, recurringStartDate: '2026-10-09',
        recurringEndDate: '2026-10-10', recurringDays: [4, 5],
      },
    }])]));
    const onEdit = vi.fn();
    render(<Provider store={store}><BookingWarnings onLog={vi.fn()} onEdit={onEdit} /></Provider>);
    expect(screen.getByText('Bokningsseriens typ saknas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Logga' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ändra' }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'unknown', parent_id: 'parent-2026-10-10-c1' }));
  });
});
