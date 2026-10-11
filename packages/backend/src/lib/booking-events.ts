import type { Prisma } from '../generated/prisma/client';
import { serializeDateCarBooking } from './serializers';
import { sendEvent } from './sse';

export const bookingInclude = { bookings: { include: { users: true, recurrence: true } } } as const;

type BookingParent = Prisma.DateCarBookingGetPayload<{ include: typeof bookingInclude }>;

export async function touchBookingParents(tx: Prisma.TransactionClient, parentIds: string[]) {
  await tx.dateCarBooking.updateMany({
    where: { id: { in: [...new Set(parentIds)] } },
    data: { updatedAt: new Date() },
  });
}

export function publishBookingParent(
  parent: BookingParent,
  event: 'add' | 'update',
  extraUserIds: string[] = [],
) {
  const userIds = new Set([
    ...extraUserIds,
    ...parent.bookings.flatMap(booking => [
      booking.byUserId,
      ...booking.users.map(user => user.userId),
    ]),
  ]);
  const serialized = serializeDateCarBooking(parent);
  for (const userId of userIds) sendEvent(`bookings:${userId}`, event, serialized);
}
