import { asc, eq } from 'drizzle-orm';

import type { AppDatabase } from './db/client.js';
import {
  activities,
  stays,
  transportLegs,
  trips,
  tripStops,
} from './db/schema.js';
import { compareStopsByDate } from './domain.js';

export type TripView = typeof trips.$inferSelect & {
  stops: Array<typeof tripStops.$inferSelect>;
  transportLegs: Array<typeof transportLegs.$inferSelect>;
  stays: Array<typeof stays.$inferSelect>;
  activities: Array<typeof activities.$inferSelect>;
};

export async function loadTrip(
  db: Pick<AppDatabase, 'select'>,
  id: string,
): Promise<TripView | null> {
  const [trip] = await db.select().from(trips).where(eq(trips.id, id)).limit(1);
  if (!trip) return null;

  const [storedStops, transportList, staysList, activityList] =
    await Promise.all([
      db
        .select()
        .from(tripStops)
        .where(eq(tripStops.tripId, id))
        .orderBy(asc(tripStops.position)),
      db
        .select()
        .from(transportLegs)
        .where(eq(transportLegs.tripId, id))
        .orderBy(asc(transportLegs.position)),
      db
        .select()
        .from(stays)
        .where(eq(stays.tripId, id))
        .orderBy(asc(stays.position)),
      db
        .select()
        .from(activities)
        .where(eq(activities.tripId, id))
        .orderBy(asc(activities.position)),
    ]);

  const stopsList = [...storedStops]
    .sort(compareStopsByDate)
    .map((stop, position) => ({ ...stop, position }));

  return {
    ...trip,
    stops: stopsList,
    transportLegs: transportList,
    stays: staysList,
    activities: activityList,
  };
}

export async function loadTrips(db: AppDatabase): Promise<TripView[]> {
  const rows = await db.select({ id: trips.id }).from(trips).orderBy(asc(trips.startDate));
  const loaded = await Promise.all(rows.map(({ id }) => loadTrip(db, id)));
  return loaded.filter((trip): trip is TripView => trip !== null);
}
