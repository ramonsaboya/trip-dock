import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/client.js';
import { trips, tripStops } from '../db/schema.js';
import { AppError } from '../domain.js';
import { orderStopsByDate, validateStopsWithinTrip, withLinkedTripBoundaryDates } from './policy.js';

export async function lockTrip(
  tx: DbTransaction,
  tripId: string,
  expectedRevision: number,
): Promise<typeof trips.$inferSelect> {
  const [trip] = await tx
    .select()
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1)
    .for('update');
  if (!trip) throw new AppError('Trip not found.', 'NOT_FOUND');
  if (trip.revision !== expectedRevision) {
    throw new AppError('This trip changed in another request. Refresh and try again.', 'REVISION_CONFLICT', {
      currentRevision: trip.revision,
    });
  }
  return trip;
}

export async function finishManualMutation(
  tx: DbTransaction,
  tripId: string,
  revision: number,
): Promise<void> {
  const now = new Date().toISOString();
  await tx
    .update(trips)
    .set({ revision: revision + 1, updatedAt: now })
    .where(and(eq(trips.id, tripId), eq(trips.revision, revision)));
}

export async function assertStopsBelong(
  tx: DbTransaction,
  tripId: string,
  stopIds: string[],
): Promise<void> {
  if (new Set(stopIds).size !== stopIds.length) {
    throw new AppError('Stop identifiers must be unique.', 'BAD_USER_INPUT');
  }
  const found = await tx
    .select({ id: tripStops.id })
    .from(tripStops)
    .where(and(eq(tripStops.tripId, tripId), inArray(tripStops.id, stopIds)));
  if (found.length !== stopIds.length) {
    throw new AppError('Every referenced stop must belong to this trip.', 'BAD_USER_INPUT');
  }
}

export async function orderedTripStops(tx: DbTransaction, tripId: string) {
  const rows = await tx.select().from(tripStops).where(eq(tripStops.tripId, tripId));
  return orderStopsByDate(rows);
}

export async function resequenceTripStops(
  tx: DbTransaction,
  tripId: string,
  ordered: Array<typeof tripStops.$inferSelect>,
): Promise<void> {
  if (ordered.every((stop, position) => stop.position === position)) return;
  // Deleted stops can leave gaps. Shift above the largest occupied position so
  // PostgreSQL's immediate unique constraint never collides with an old row.
  const offset = Math.max(...ordered.map(stop => stop.position)) + 1;
  await tx
    .update(tripStops)
    .set({ position: sql`${tripStops.position} + ${offset}` })
    .where(eq(tripStops.tripId, tripId));
  for (const [position, stop] of ordered.entries()) {
    await tx.update(tripStops).set({ position }).where(eq(tripStops.id, stop.id));
  }
}

export async function synchronizeStopsFromTripDates(
  tx: DbTransaction,
  trip: typeof trips.$inferSelect,
  startDate: string,
  endDate: string,
): Promise<void> {
  const current = await orderedTripStops(tx, trip.id);
  const linked = withLinkedTripBoundaryDates(
    current,
    trip.startDate,
    trip.endDate,
    startDate,
    endDate,
  );
  validateStopsWithinTrip(linked, startDate, endDate);
  const currentFirst = current[0]!;
  const currentLast = current.at(-1)!;
  const linkedFirst = linked[0]!;
  const linkedLast = linked.at(-1)!;
  const now = new Date().toISOString();
  if (currentFirst.arrivalDate !== linkedFirst.arrivalDate) {
    await tx
      .update(tripStops)
      .set({ arrivalDate: linkedFirst.arrivalDate, updatedAt: now })
      .where(eq(tripStops.id, linkedFirst.id));
  }
  if (currentLast.departureDate !== linkedLast.departureDate) {
    await tx
      .update(tripStops)
      .set({ departureDate: linkedLast.departureDate, updatedAt: now })
      .where(eq(tripStops.id, linkedLast.id));
  }
  await resequenceTripStops(tx, trip.id, linked);
}

export async function persistStopChronology(
  tx: DbTransaction,
  trip: typeof trips.$inferSelect,
  startDate = trip.startDate,
  endDate = trip.endDate,
): Promise<Array<typeof tripStops.$inferSelect>> {
  const ordered = await orderedTripStops(tx, trip.id);
  validateStopsWithinTrip(ordered, startDate, endDate);
  await resequenceTripStops(tx, trip.id, ordered);
  if (startDate !== trip.startDate || endDate !== trip.endDate) {
    await tx
      .update(trips)
      .set({ startDate, endDate, updatedAt: new Date().toISOString() })
      .where(eq(trips.id, trip.id));
  }
  return ordered;
}
