import assert from 'node:assert/strict';
import test from 'node:test';
import { activityAssignment, activityMoveInput, destinationDays } from '../lib/activity-planning.ts';
import { isTripMinimumViable, tripStopsForCreation, type Activity, type TripInput } from '../lib/graphql-client.ts';

const activity: Activity = { id: 'activity', tripId: 'trip', stopId: 'tokyo', position: 0, title: 'Museum', status: 'BOOKED', scheduledAt: '2027-06-02T00:00:00Z', timezone: 'Asia/Tokyo' };

test('destination days include arrival and departure across month and DST boundaries', () => {
  assert.deepEqual(destinationDays({ arrivalDate: '2027-03-27', departureDate: '2027-03-29' }), ['2027-03-27', '2027-03-28', '2027-03-29']);
  assert.deepEqual(destinationDays({ arrivalDate: '2027-06-01', departureDate: '2027-06-01' }), ['2027-06-01']);
  assert.deepEqual(destinationDays({ arrivalDate: null, departureDate: null }), []);
});

test('assignments group by the record timezone, and moving preserves booking status', () => {
  assert.deepEqual(activityAssignment(activity), { day: '2027-06-02', time: '09:00', hour: '09:00' });
  const move = activityMoveInput(activity, 'kyoto', '2027-06-03', '19:00', 'Asia/Tokyo');
  assert.equal(move.scheduledAt, '2027-06-03T10:00:00.000Z');
  assert.equal(move.stopId, 'kyoto');
  assert.equal(move.status, 'BOOKED');
  assert.equal(activityMoveInput({ ...activity, status: 'DONE' }, 'tokyo', '', '09:00', 'Asia/Tokyo').status, 'DONE');
  assert.equal(activityMoveInput(activity, 'tokyo', '', '09:00', 'Asia/Tokyo').scheduledAt, null);
  assert.equal(activityMoveInput(activity, 'tokyo', '2027-03-28', '09:00', 'Europe/London').scheduledAt, '2027-03-28T08:00:00.000Z');
});

test('blank trailing creation rows do not block saving or become destinations', () => {
  const input: TripInput = { name: '', destinationArea: '', startDate: '2027-06-01', endDate: '2027-06-06', travelerCount: null, stops: [
    { name: 'Tokyo', locationText: null, arrivalDate: null, departureDate: null, localityKind: 'CITY', cityResolution: 'RESOLVED' },
    { name: '  ', locationText: null, arrivalDate: null, departureDate: null, localityKind: 'UNKNOWN', cityResolution: 'UNRESOLVED' },
  ] };
  assert.equal(isTripMinimumViable(input), true);
  assert.deepEqual(tripStopsForCreation(input), [{ name: 'Tokyo', locationText: null, arrivalDate: '2027-06-01', departureDate: '2027-06-06' }]);
});


test('hourly moves support precise times, midnight and late evening without changing booking facts', () => {
  assert.equal(activityMoveInput(activity, 'tokyo', '2027-06-03', '00:00', 'Asia/Tokyo').scheduledAt, '2027-06-02T15:00:00.000Z');
  assert.equal(activityMoveInput(activity, 'tokyo', '2027-06-03', '23:45', 'Asia/Tokyo').scheduledAt, '2027-06-03T14:45:00.000Z');
  assert.deepEqual(activityAssignment({ scheduledAt: '2027-06-03T14:45:00.000Z', timezone: 'Asia/Tokyo' }), { day: '2027-06-03', time: '23:45', hour: '23:00' });
  assert.throws(() => activityMoveInput(activity, 'tokyo', '2027-06-03', '24:00', 'Asia/Tokyo'), /valid time/);
  assert.throws(() => activityMoveInput(activity, 'tokyo', '2027-03-28', '01:30', 'Europe/London'), /does not exist/);
});
