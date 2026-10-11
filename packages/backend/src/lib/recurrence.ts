import type { Prisma } from '../generated/prisma/client';

export type RecurrenceMetadata = {
  isMultiDay: boolean | null;
  recurringStartDate: string;
  recurringEndDate: string;
  recurringDays: number[];
  createdAt?: Date;
  updatedAt?: Date;
};

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isRecurringDays(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(day => Number.isInteger(day) && day >= 0 && day <= 6)
    && new Set(value).size === value.length;
}

export function recurrenceWeekday(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function inferLegacyRecurrenceMetadata(entries: {
  date: string; carId: string; startTime: number; endTime: number;
}[]): RecurrenceMetadata | null {
  if (entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const valid = entries.every(entry => isCalendarDate(entry.date) && !!entry.carId
    && Number.isInteger(entry.startTime) && Number.isInteger(entry.endTime)
    && entry.startTime >= 0 && entry.endTime <= 1440 && entry.startTime < entry.endTime)
    && new Set(entries.map(entry => entry.carId)).size === 1
    && new Set(entries.map(entry => entry.date)).size === entries.length;
  const allFullDay = entries.every(entry => entry.startTime === 0 && entry.endTime === 1440);
  const joined = valid && sorted.every((entry, index) => {
    if (index === 0) return true;
    const previous = sorted[index - 1];
    const next = new Date(`${previous.date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return entry.startTime === 0 && previous.endTime === 1440 && next.toISOString().slice(0, 10) === entry.date;
  });
  const sameTimes = entries.every(entry => entry.startTime === sorted[0].startTime && entry.endTime === sorted[0].endTime);
  const interior = entries.every(entry => entry.startTime > 0 && entry.endTime < 1440);
  const isMultiDay = valid && entries.length >= 2 && joined && !allFullDay ? true
    : valid && (interior || (entries.length >= 2 && sameTimes && !allFullDay)) ? false : null;
  return {
    isMultiDay,
    recurringStartDate: sorted[0].date,
    recurringEndDate: sorted[sorted.length - 1].date,
    recurringDays: [...new Set(entries.filter(entry => isCalendarDate(entry.date)).map(entry => recurrenceWeekday(entry.date)))].sort(),
  };
}

export async function lockRecurrences(tx: Prisma.TransactionClient, ids: (string | null | undefined)[]) {
  // Unlike a row lock this also serializes creation of a previously unseen recurrence ID.
  for (const id of [...new Set(ids.filter((id): id is string => id != null))].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
  }
}

export async function restoreLegacyRecurrence(
  tx: Prisma.TransactionClient,
  id: string,
  metadata: RecurrenceMetadata,
) {
  await lockRecurrences(tx, [id]);
  const existing = await tx.recurrence.findUnique({ where: { id } });
  if (!existing) return tx.recurrence.create({ data: { id, ...metadata } });
  if (metadata.isMultiDay !== null && existing.isMultiDay !== null && existing.isMultiDay !== metadata.isMultiDay) {
    throw new Error(`Recurrence '${id}' conflicts with the authoritative source kind`);
  }
  const isMultiDay = metadata.isMultiDay ?? existing.isMultiDay;
  const changed = existing.isMultiDay !== isMultiDay
    || existing.recurringStartDate !== metadata.recurringStartDate
    || existing.recurringEndDate !== metadata.recurringEndDate
    || JSON.stringify(existing.recurringDays) !== JSON.stringify(metadata.recurringDays)
    || (metadata.createdAt !== undefined && existing.createdAt.getTime() !== metadata.createdAt.getTime())
    || (metadata.updatedAt !== undefined && existing.updatedAt.getTime() !== metadata.updatedAt.getTime());
  if (!changed) return existing;
  // Explicit metadata may resolve a legacy unknown, but a known kind is immutable.
  const recurrence = await tx.recurrence.update({ where: { id }, data: { ...metadata, isMultiDay } });
  await tx.dateCarBooking.updateMany({
    where: { bookings: { some: { recurrenceId: id } } },
    data: { updatedAt: new Date() },
  });
  return recurrence;
}
