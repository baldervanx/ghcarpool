/**
 * trip-cache.ts
 *
 * Global localStorage-cache för körloggen (Trip-rader).
 *
 * Trips ändras i praktiken aldrig — en ny rad appendas för varje körning.
 * Därför cachas HELA loggen som en enda post och delta-sync hämtar enbart
 * rader med timestamp > cachedAt sedan förra sessionen.
 *
 * Nyckelformat: "trips:global"
 * Värdeformat:  { trips: TripDto[], cachedAt: ISO8601 }
 */

import type { TripDto } from '@/api/trips';

const KEY = 'trips:global';

export interface TripCacheEntry {
  trips: TripDto[];
  /** ISO 8601 — tidpunkt då cachen senast skrevs */
  cachedAt: string;
}

/** Läs cache. Returnerar null om inget finns. */
export function tripCacheRead(): TripCacheEntry | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TripCacheEntry;
  } catch {
    return null;
  }
}

/** Skriv/uppdatera cache med en komplett lista. */
export function tripCacheWrite(trips: TripDto[], cachedAt: string): void {
  try {
    const entry: TripCacheEntry = { trips, cachedAt };
    localStorage.setItem(KEY, JSON.stringify(entry));
  } catch (e) {
    // localStorage kan vara full — ignorera tyst
    console.warn('[trip-cache] write failed:', e);
  }
}

/** Invalidera (radera) cachen — används t.ex. vid delete. */
export function tripCacheInvalidate(): void {
  localStorage.removeItem(KEY);
}

/**
 * Slå ihop befintlig cache med nyankomna rader.
 * Incoming-rader vinner vid id-kollision (uppdaterad rad).
 * Sorteras odo DESC som backend/store förväntar sig.
 */
export function mergeTripCache(existing: TripDto[], incoming: TripDto[]): TripDto[] {
  const map = new Map<string, TripDto>();
  for (const t of existing) map.set(t.id, t);
  for (const t of incoming) map.set(t.id, t);
  return Array.from(map.values()).sort((a, b) => b.odo - a.odo);
}
