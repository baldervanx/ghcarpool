/** Tests for the booking cache lock grace period. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookingCacheRead, bookingCacheWrite, isMonthLocked } from './booking-cache';

describe('isMonthLocked', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe('booking cache schema', () => {
    beforeEach(() => localStorage.clear());

    it('invalidates pre-recurrence-metadata caches, including locked historical months', () => {
      localStorage.setItem('bookings:month:2026-01', JSON.stringify({
        bookings: [], cachedAt: '2026-01-01T00:00:00Z',
      }));
      expect(bookingCacheRead('2026-01')).toBeNull();
    });

    it('roundtrips the current metadata-aware cache format', () => {
      bookingCacheWrite('2026-10', [], '2026-10-11T00:00:00Z');
      expect(bookingCacheRead('2026-10')).toEqual({
        version: 2, bookings: [], cachedAt: '2026-10-11T00:00:00Z',
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the current month unlocked', () => {
    vi.setSystemTime(new Date(2026, 9, 13, 12, 0, 0));

    expect(isMonthLocked('2026-10')).toBe(false);
  });

  it('keeps the previous month unlocked during the 14-day grace period', () => {
    vi.setSystemTime(new Date(2026, 9, 14, 23, 59, 59));

    expect(isMonthLocked('2026-09')).toBe(false);
  });

  it('locks the previous month after the grace period ends', () => {
    vi.setSystemTime(new Date(2026, 9, 15, 0, 0, 0));

    expect(isMonthLocked('2026-09')).toBe(true);
  });
});
