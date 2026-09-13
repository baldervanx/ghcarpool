/**
 * booking-cache.ts
 *
 * Enkel localStorage-cache för bokningar per månad.
 *
 * Nyckelformat: "bookings:month:yyyy-MM"
 * Värdeformat:  { bookings: DateCarBooking[], cachedAt: ISO8601 }
 *
 * Låsta månader (14 dagar efter endOfMonth) cachas permanent utan TTL.
 * Icke-låsta månader cachas men uppdateras alltid vid delta-sync.
 */

import type { DateCarBooking } from '@/store';
import { addDays, endOfMonth } from 'date-fns';

const PREFIX = 'bookings:month:';

export interface BookingCacheEntry {
  bookings: DateCarBooking[];
  cachedAt: string; // ISO 8601
}

/** Returnera nyckel "yyyy-MM" för ett datum-strängen "yyyy-MM-dd" */
export function bookingCacheMonthKey(date: string): string {
  return date.slice(0, 7); // "2026-06-15" → "2026-06"
}

/** Läs cache för en månad. Returnerar null om det inte finns något. */
export function bookingCacheRead(monthKey: string): BookingCacheEntry | null {
  try {
    const raw = localStorage.getItem(PREFIX + monthKey);
    if (!raw) return null;
    return JSON.parse(raw) as BookingCacheEntry;
  } catch {
    return null;
  }
}

/** Skriv/uppdatera cache för en månad. */
export function bookingCacheWrite(
  monthKey: string,
  bookings: DateCarBooking[],
  cachedAt: string,
): void {
  try {
    const entry: BookingCacheEntry = { bookings, cachedAt };
    localStorage.setItem(PREFIX + monthKey, JSON.stringify(entry));
  } catch (e) {
    // localStorage kan vara full — ignorera tyst
    console.warn('[booking-cache] write failed:', e);
  }
}

/** Ta bort cache för en månad. */
export function bookingCacheInvalidate(monthKey: string): void {
  localStorage.removeItem(PREFIX + monthKey);
}

/**
 * Avgör om en månad är "låst" — dvs 14 hela dagar har passerat sedan
 * månadens slut. Grace-perioden behövs eftersom bokningar kan loggas sent.
 */
export function isMonthLocked(monthKey: string): boolean {
  // monthKey = "yyyy-MM"
  const [y, m] = monthKey.split('-').map(Number);
  const monthStart = new Date(y, m - 1, 1);
  const lockAt = addDays(endOfMonth(monthStart), 14);
  return new Date() >= lockAt;
}
