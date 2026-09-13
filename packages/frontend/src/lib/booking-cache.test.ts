/** Tests for the booking cache lock grace period. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isMonthLocked } from './booking-cache';

describe('isMonthLocked', () => {
  beforeEach(() => {
    vi.useFakeTimers();
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

