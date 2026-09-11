import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../src/db/client.js';
import { tripStops } from '../src/db/schema.js';
import { loadTrip } from '../src/data.js';
import { AppError } from '../src/domain.js';
import { createTripService } from '../src/trips/trip-service.js';
import { createStopService } from '../src/trips/stop-service.js';

const input = {
  name: 'Transaction review', destinationArea: 'Test area', startDate: '2027-06-01', endDate: '2027-06-09',
  stops: [
    { name: 'First', locationText: null, arrivalDate: '2027-06-01', departureDate: '2027-06-03' },
    { name: 'Middle', locationText: null, arrivalDate: '2027-06-03', departureDate: '2027-06-06' },
    { name: 'Last', locationText: null, arrivalDate: '2027-06-06', departureDate: '2027-06-09' },
  ],
};

export async function exerciseBackendTransactions(db: AppDatabase, concurrent = false) {
  const trips = createTripService(db);
  const stops = createStopService(db);
  let trip = await trips.createTrip({ input });
  trip = await stops.removeTripStop({ id: trip.stops[1]!.id, expectedRevision: trip.revision });
  assert.deepEqual(trip.stops.map(stop => [stop.name, stop.position]), [['First', 0], ['Last', 1]]);
  assert.equal(trip.revision, 1);
  // Read stored positions too: hydration alone could hide a failed resequence.
  const stored = await db.select().from(tripStops).where(eq(tripStops.tripId, trip.id));
  assert.deepEqual(stored.map(stop => stop.position).sort(), [0, 1]);
  const before = await loadTrip(db, trip.id);
  await assert.rejects(stops.addTripStop({ tripId: trip.id, expectedRevision: trip.revision, input: {
    name: 'Invalid interval', locationText: null, arrivalDate: '2027-06-05', departureDate: '2027-06-15',
  } }), error => error instanceof AppError && error.code === 'BAD_USER_INPUT');
  assert.deepEqual(await loadTrip(db, trip.id), before, 'insert and any date/revision changes must roll back');

  if (concurrent) {
    const update = { name: 'Winner A', destinationArea: input.destinationArea, startDate: input.startDate, endDate: input.endDate };
    const results = await Promise.allSettled([
      trips.updateTrip({ id: trip.id, expectedRevision: trip.revision, input: update }),
      trips.updateTrip({ id: trip.id, expectedRevision: trip.revision, input: { ...update, name: 'Winner B' } }),
    ]);
    const winners = results.filter(result => result.status === 'fulfilled');
    const losers = results.filter(result => result.status === 'rejected');
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.ok(losers[0]!.reason instanceof AppError);
    assert.equal(losers[0]!.reason.code, 'REVISION_CONFLICT');
    assert.equal(losers[0]!.reason.details?.currentRevision, trip.revision + 1);
    assert.deepEqual(winners[0]!.value, await loadTrip(db, trip.id));
  }
}
