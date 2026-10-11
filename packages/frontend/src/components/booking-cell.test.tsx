import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Booking } from '@/store';
import BookingCell from './booking-cell';

const booking: Booking = {
  id: 'b1', startTime: 480, endTime: 540, distance: 25, destination: '',
  users: [{ id: 'u1' }], byUser: { id: 'u1' }, parent_id: 'container',
};

describe('historical booking cells', () => {
  it('allows editing an unlogged booking on a past read-only date', () => {
    const onClick = vi.fn();
    render(<BookingCell bookings={[booking]} car="c1" date={new Date(2026, 0, 1)}
      destinations={[]} onClick={onClick} readOnly accessibleCn={(value: string) => value} />);
    fireEvent.click(screen.getByText(/u1/));
    expect(onClick).toHaveBeenCalledWith(booking);
    expect(screen.queryByText('+')).not.toBeInTheDocument();
  });

  it('keeps logged historical bookings immutable', () => {
    const onClick = vi.fn();
    render(<BookingCell bookings={[{ ...booking, logged: 'trip' }]} car="c1" date={new Date(2026, 0, 1)}
      destinations={[]} onClick={onClick} readOnly accessibleCn={(value: string) => value} />);
    fireEvent.click(screen.getByText(/u1/));
    expect(onClick).not.toHaveBeenCalled();
  });
});
