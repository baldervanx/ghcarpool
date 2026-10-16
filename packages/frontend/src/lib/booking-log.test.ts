import { describe, expect, it } from 'vitest';
import type { Booking, Car, DateCarBooking } from '@/store';
import { getLogBookings, getPrecedingUnloggedBooking, getRecentLogBookings, hasBookingEnded } from './booking-log';

const cars: Car[] = [
  { id: 'c1', name: 'Bil ett', range: 100, order: 1, hasLog: true },
  { id: 'c2', name: 'Släp', range: 0, order: 2, hasLog: false },
];
const now = new Date(2026, 9, 11, 10, 0);
function booking(id: string, startTime = 480, endTime = 540): Booking {
  return { id, startTime, endTime, users: [{ id: 'u1' }], byUser: { id: 'u1' }, distance: 25, destination: '' };
}
function day(date: string, bookings: Booking[], car = 'c1'): DateCarBooking {
  return { id: `${date}-${car}`, date, car: { id: car }, bookings };
}

describe('booking log selection', () => {
  it('sorts history chronologically and attaches authoritative container IDs', () => {
    const entries = getRecentLogBookings(getLogBookings([
      day('2026-10-11', [booking('today')]),
      day('2026-10-01', [booking('old')]),
      day('2026-09-26', [booking('too-old')]),
      day('2026-10-12', [booking('future')]),
      day('2026-10-10', [booking('trailer')], 'c2'),
    ], cars), now);
    expect(entries.map(entry => entry.id)).toEqual(['old', 'today']);
    expect(entries[0].parent_id).toBe('2026-10-01-c1');
  });

  it('keeps the final multi-day instance and ordinary full-day recurring bookings', () => {
    const entries = getLogBookings([
      day('2026-10-09', [{ ...booking('first', 600, 1440), recurrenceId: 'multi' }]),
      day('2026-10-10', [{ ...booking('middle', 0, 1440), recurrenceId: 'multi' }]),
      day('2026-10-11', [{ ...booking('last', 0, 600), recurrenceId: 'multi' }]),
      day('2026-10-01', [{ ...booking('weekly', 0, 1440), recurrenceId: 'weekly' }]),
      day('2026-10-08', [{ ...booking('weekly-next', 0, 1440), recurrenceId: 'weekly' }]),
    ], cars);
    expect(entries.map(entry => entry.id)).toEqual(['weekly', 'weekly-next', 'last']);
  });

  it('warns only after the preceding booking ends, including the exact boundary', () => {
    const entries = getLogBookings([day('2026-10-11', [booking('before'), booking('current', 600, 660)])], cars);
    const current = entries[1];
    expect(getPrecedingUnloggedBooking(entries, current, new Date(2026, 9, 11, 8, 59, 59))).toBeUndefined();
    expect(getPrecedingUnloggedBooking(entries, current, new Date(2026, 9, 11, 9, 0))?.id).toBe('before');
    expect(hasBookingEnded(entries[0], new Date(2026, 9, 11, 9, 0))).toBe(true);
  });

  it('does not skip a logged immediate predecessor to warn about an older booking', () => {
    const entries = getLogBookings([day('2026-10-11', [
      booking('old', 420, 480), { ...booking('logged', 480, 540), logged: 'trip' }, booking('current', 600, 660),
    ])], cars);
    expect(getPrecedingUnloggedBooking(entries, entries[2], now)).toBeUndefined();
  });

  it('selects the nearest predecessor across dates rather than the largest time of day', () => {
    const entries = getLogBookings([
      day('2026-10-09', [booking('older', 1200, 1380)]),
      day('2026-10-10', [booking('previous', 480, 540)]),
      day('2026-10-11', [booking('current', 600, 660)]),
      day('2026-10-12', [booking('future')]),
    ], cars);
    expect(getPrecedingUnloggedBooking(entries, entries[2], now, 'u2')?.id).toBe('previous');
  });

  it('handles a midnight boundary across years', () => {
    const entries = getLogBookings([
      day('2025-12-31', [booking('previous', 1200, 1440)]),
      day('2026-01-01', [booking('current', 0, 60)]),
    ], cars);
    expect(getPrecedingUnloggedBooking(entries, entries[1], new Date(2025, 11, 31, 23, 59, 59), 'u2')).toBeUndefined();
    expect(getPrecedingUnloggedBooking(entries, entries[1], new Date(2026, 0, 1), 'u2')?.id).toBe('previous');
  });

  it('does not skip a logged predecessor on another date', () => {
    const entries = getLogBookings([
      day('2026-10-09', [booking('older')]),
      day('2026-10-10', [{ ...booking('previous'), logged: 'trip' }]),
      day('2026-10-11', [booking('current', 600, 660)]),
    ], cars);
    expect(getPrecedingUnloggedBooking(entries, entries[2], now, 'u2')).toBeUndefined();
  });

  it('suppresses an own predecessor without falling back to an older booking by someone else', () => {
    const entries = getLogBookings([
      day('2026-10-09', [{ ...booking('older'), users: [{ id: 'u2' }] }]),
      day('2026-10-10', [booking('own')]),
      day('2026-10-11', [booking('current', 600, 660)]),
    ], cars);
    expect(getPrecedingUnloggedBooking(entries, entries[2], now, 'u1')).toBeUndefined();
  });

  it('treats shared bookings as own regardless of their creator or participant order', () => {
    const entries = getLogBookings([
      day('2026-10-10', [{
        ...booking('shared'), byUser: { id: 'u2' }, users: [{ id: 'u2' }, { id: 'u1' }],
      }]),
      day('2026-10-11', [booking('current', 600, 660)]),
    ], cars);
    expect(getPrecedingUnloggedBooking(entries, entries[1], now, 'u1')).toBeUndefined();
  });

  it('ignores preceding bookings on other cars', () => {
    const entries = getLogBookings([
      day('2026-10-10', [booking('other-car')], 'c3'),
      day('2026-10-11', [booking('current', 600, 660)]),
    ], [...cars, { ...cars[0], id: 'c3' }]);
    expect(getPrecedingUnloggedBooking(entries, entries[1], now, 'u2')).toBeUndefined();
  });

  it('uses persisted series type and boundaries rather than midnight heuristics', () => {
    const ordinary = {
      id: 'daily', isMultiDay: false, recurringStartDate: '2026-10-10',
      recurringEndDate: '2026-10-11', recurringDays: [5, 6],
    };
    const multi = { ...ordinary, id: 'multi', isMultiDay: true, recurringDays: [] };
    const entries = getLogBookings([
      day('2026-10-10', [{ ...booking('ordinary-first', 0, 1440), recurrenceId: 'daily', recurrence: ordinary }]),
      day('2026-10-11', [
        { ...booking('ordinary-last', 0, 1440), recurrenceId: 'daily', recurrence: ordinary },
        { ...booking('multi-final-midnight', 0, 1440), recurrenceId: 'multi', recurrence: multi },
        { ...booking('unknown'), recurrenceId: 'unknown', recurrence: { ...ordinary, id: 'unknown', isMultiDay: null } },
      ]),
    ], cars);
    expect(entries.map(entry => entry.id)).toEqual(['ordinary-first', 'ordinary-last', 'multi-final-midnight']);
  });

  it('does not mistake a partial loaded middle day for the final day of a multi-day series', () => {
    const entries = getLogBookings([day('2026-10-11', [{
      ...booking('middle', 0, 1440), recurrenceId: 'multi',
      recurrence: {
        id: 'multi', isMultiDay: true, recurringStartDate: '2026-10-01',
        recurringEndDate: '2026-10-20', recurringDays: [],
      },
    }])], cars);
    expect(entries).toEqual([]);
  });
});
