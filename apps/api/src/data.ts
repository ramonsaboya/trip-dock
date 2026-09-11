import { asc, eq, inArray } from 'drizzle-orm';

import type { DatabaseReader } from './db/client.js';
import {
  activities,
  stays,
  transportLegs,
  trips,
  tripStops,
} from './db/schema.js';
import { AppError, compareStopsByDate } from './domain.js';

export type TripView = typeof trips.$inferSelect & {
  stops: Array<typeof tripStops.$inferSelect>;
  transportLegs: Array<typeof transportLegs.$inferSelect>;
  stays: Array<typeof stays.$inferSelect>;
  activities: Array<typeof activities.$inferSelect>;
};

function groupByTrip<T extends { tripId: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const group = grouped.get(row.tripId);
    if (group) group.push(row);
    else grouped.set(row.tripId, [row]);
  }
  return grouped;
}

// Four child queries for the whole collection, rather than four per trip.
// The caller owns snapshot/transaction scope. No global cache holds canonical data.
async function hydrateTrips(db: DatabaseReader, rows: Array<typeof trips.$inferSelect>): Promise<TripView[]> {
  if (!rows.length) return [];
  const ids = rows.map(row => row.id);

  const [storedStops, transportList, staysList, activityList] =
    [
      await db
        .select()
        .from(tripStops)
        .where(inArray(tripStops.tripId, ids))
        .orderBy(asc(tripStops.position)),
      await db
        .select()
        .from(transportLegs)
        .where(inArray(transportLegs.tripId, ids))
        .orderBy(asc(transportLegs.position)),
      await db
        .select()
        .from(stays)
        .where(inArray(stays.tripId, ids))
        .orderBy(asc(stays.position)),
      await db
        .select()
        .from(activities)
        .where(inArray(activities.tripId, ids))
        .orderBy(asc(activities.position)),
    ];

  const stopsByTrip = groupByTrip(storedStops);
  const transportByTrip = groupByTrip(transportList);
  const staysByTrip = groupByTrip(staysList);
  const activitiesByTrip = groupByTrip(activityList);
  return rows.map(trip => ({
    ...trip,
    stops: (stopsByTrip.get(trip.id) ?? []).sort(compareStopsByDate).map((stop, position) => ({ ...stop, position })),
    transportLegs: transportByTrip.get(trip.id) ?? [],
    stays: staysByTrip.get(trip.id) ?? [],
    activities: activitiesByTrip.get(trip.id) ?? [],
  }));
}

export async function loadTrip(db: DatabaseReader, id: string): Promise<TripView | null> {
  const rows = await db.select().from(trips).where(eq(trips.id, id)).limit(1);
  return (await hydrateTrips(db, rows))[0] ?? null;
}

export async function requireTrip(db: DatabaseReader, id: string): Promise<TripView> {
  const trip = await loadTrip(db, id);
  if (!trip) throw new AppError('Trip not found.', 'NOT_FOUND');
  return trip;
}

export async function loadTrips(db: DatabaseReader): Promise<TripView[]> {
  const rows = await db.select().from(trips).orderBy(asc(trips.startDate));
  return hydrateTrips(db, rows);
}
