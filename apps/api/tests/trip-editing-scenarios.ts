import assert from 'node:assert/strict';
import type { AppDatabase } from '../src/db/client.js';
import { activities, stays, transportLegs } from '../src/db/schema.js';
import { loadTrip } from '../src/data.js';
import { AppError } from '../src/domain.js';
import { createTripService } from '../src/trips/trip-service.js';

// Shared by the deterministic adapter and isolated real PostgreSQL suite.
export async function exerciseTripEditing(db: AppDatabase) {
  const service = createTripService(db);
  let trip = await service.createTrip({ input: {
    name: 'Date edit regression', destinationArea: 'Japan', travelerCount: 2,
    stops: [
      { name: 'Tokyo', arrivalDate: '2027-06-01', departureDate: '2027-06-04', locationText: null },
      { name: 'Kyoto', arrivalDate: '2027-06-04', departureDate: '2027-06-08', locationText: null },
      { name: 'Osaka', arrivalDate: '2027-06-08', departureDate: '2027-06-10', locationText: null },
    ],
  } });
  const tokyo = trip.stops[0]!.id;
  const kyoto = trip.stops[1]!.id;
  const osaka = trip.stops[2]!.id;
  const samples = [
    { stopId: tokyo, title: 'Before start', scheduledAt: '2027-06-01T12:00:00Z', timezone: 'UTC' },
    { stopId: tokyo, title: 'Tokyo local start', scheduledAt: '2027-06-01T16:00:00Z', timezone: 'Asia/Tokyo' },
    { stopId: kyoto, title: 'Still fits', scheduledAt: '2027-06-05T12:00:00Z', timezone: 'UTC' },
    { stopId: kyoto, title: 'Crosses midnight', scheduledAt: '2027-06-07T23:30:00Z', timezone: 'UTC' },
    { stopId: kyoto, title: 'Ends at midnight', scheduledAt: '2027-06-07T23:00:00Z', timezone: 'UTC' },
    { stopId: kyoto, title: 'Tokyo beyond end', scheduledAt: '2027-06-07T16:00:00Z', timezone: 'Asia/Tokyo' },
    { stopId: osaka, title: 'Excluded destination', scheduledAt: '2027-06-09T12:00:00Z', timezone: 'UTC' },
    { stopId: tokyo, title: 'Outside destination', scheduledAt: '2027-06-05T12:00:00Z', timezone: 'UTC' },
    { stopId: kyoto, title: 'Already in pool', scheduledAt: null, timezone: 'UTC' },
  ];
  const positions = new Map<string, number>();
  for (const sample of samples) {
    const position = positions.get(sample.stopId) ?? 0;
    await db.insert(activities).values({ ...sample, tripId: trip.id, position, durationMinutes: 60, status: 'BOOKED' });
    positions.set(sample.stopId, position + 1);
  }
  await db.insert(stays).values({ tripId: trip.id, stopId: tokyo, position: 0, name: 'Existing hotel booking', checkIn: '2027-06-01T15:00:00Z', checkOut: '2027-06-04T11:00:00Z', timezone: 'UTC' });
  await db.insert(transportLegs).values({ tripId: trip.id, fromStopId: tokyo, toStopId: kyoto, position: 0, mode: 'TRAIN', title: 'Existing train booking', departureTime: '2027-06-04T10:00:00Z', arrivalTime: '2027-06-04T12:00:00Z', timezone: 'UTC' });
  const renamed = await service.updateTrip({ id: trip.id, expectedRevision: trip.revision, input: { name: 'Renamed only', destinationArea: trip.destinationArea, travelerCount: trip.travelerCount, startDate: trip.startDate, endDate: trip.endDate } });
  assert.equal(renamed.activities.filter(value => value.scheduledAt).length, 8, 'name-only edits leave all scheduling intact');
  trip = renamed;
  const input = { name: 'Edited Japan', destinationArea: trip.destinationArea, travelerCount: trip.travelerCount, startDate: '2027-06-02', endDate: '2027-06-07' };
  const before = await loadTrip(db, trip.id);
  await assert.rejects(service.updateTrip({ id: trip.id, expectedRevision: trip.revision, input: { ...input, endDate: '2027-06-01' } }), error => error instanceof AppError && error.code === 'BAD_USER_INPUT');
  assert.deepEqual(await loadTrip(db, trip.id), before, 'invalid ranges leave all data unchanged');
  trip = await service.updateTrip({ id: trip.id, expectedRevision: trip.revision, input });
  assert.equal(trip.revision, 2);
  assert.deepEqual(trip.stays, before!.stays, 'hotel booking dates and details stay intact');
  assert.deepEqual(trip.transportLegs, before!.transportLegs, 'transport booking dates and details stay intact');
  assert.equal(trip.name, input.name);
  assert.deepEqual(trip.stops.map(stop => [stop.id, stop.arrivalDate, stop.departureDate]), [
    [tokyo, '2027-06-02', '2027-06-04'], [kyoto, '2027-06-04', '2027-06-07'], [osaka, '2027-06-07', '2027-06-07'],
  ], 'all destinations remain, even when reduced to one day');
  for (const sample of samples) {
    const activity = trip.activities.find(value => value.title === sample.title)!;
    const retained = ['Tokyo local start', 'Still fits', 'Ends at midnight'].includes(sample.title);
    assert.equal(activity.scheduledAt ? new Date(activity.scheduledAt).toISOString() : null, retained ? new Date(sample.scheduledAt!).toISOString() : null, sample.title);
    assert.equal(activity.stopId, sample.stopId);
    assert.equal(activity.status, 'BOOKED');
    assert.equal(activity.timezone, sample.timezone);
    assert.equal(activity.durationMinutes, 60);
  }
  assert.deepEqual(await loadTrip(db, trip.id), trip, 'the pool changes persist');
  await assert.rejects(service.updateTrip({ id: trip.id, expectedRevision: 0, input }), error => error instanceof AppError && error.code === 'REVISION_CONFLICT');
  assert.deepEqual(await loadTrip(db, trip.id), trip, 'stale edits change nothing');
  trip = await service.updateTrip({ id: trip.id, expectedRevision: trip.revision, input: { ...input, startDate: '2027-06-01', endDate: '2027-06-10' } });
  assert.equal(trip.activities.filter(value => value.scheduledAt).length, 3, 'expanding never silently reschedules pool activities');
  trip = await service.updateTrip({ id: trip.id, expectedRevision: trip.revision, input: { ...input, startDate: '2027-07-01', endDate: '2027-07-05' } });
  assert.equal(trip.activities.filter(value => value.scheduledAt).length, 0, 'moving the trip entirely returns scheduled activities');
  assert.equal(trip.stops.length, 3);
  assert.deepEqual(await loadTrip(db, trip.id), trip);
}
