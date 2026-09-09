import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarColumns, stayCoversDay, transportPlacement, tripRoutes } from '../lib/trip-calendar.ts';
import { type Stay, type TransportLeg, type Trip, type TripStop } from '../lib/graphql-client.ts';

const stops: TripStop[] = [
  { id: 'rome', tripId: 'trip', name: 'Rome', position: 0, locationText: null, arrivalDate: '2027-06-01', departureDate: '2027-06-03' },
  { id: 'florence', tripId: 'trip', name: 'Florence', position: 1, locationText: null, arrivalDate: '2027-06-03', departureDate: '2027-06-05' },
];
const trip: Trip = { id: 'trip', name: 'Italy', destinationArea: 'Italy', startDate: '2027-06-01', endDate: '2027-06-05', stops, transportLegs: [], stays: [], activities: [], travelerCount: null, revision: 0, createdAt: '', updatedAt: '' };
const leg: TransportLeg = { id: 'train', tripId: 'trip', fromStopId: 'rome', toStopId: 'florence', fromLocation: null, toLocation: null, title: 'Train', mode: 'TRAIN', position: 0, details: null, departureTime: null, arrivalTime: null, timezone: 'Europe/Rome' };
const stay: Stay = { id: 'hotel', tripId: 'trip', stopId: 'rome', position: 0, name: 'Hotel', checkIn: null, checkOut: null, timezone: 'Europe/Rome' };

test('trip calendar has one chronological column per day and marks shared transfer dates', () => {
  const columns = calendarColumns(trip);
  assert.deepEqual(columns.map((column) => column.day), ['2027-06-01', '2027-06-02', '2027-06-03', '2027-06-04', '2027-06-05']);
  assert.equal(columns[1]!.destination?.id, 'rome');
  assert.equal(columns[2]!.destination?.id, 'florence');
  assert.deepEqual(columns[2]!.destinations.map((stop) => stop.id), ['rome', 'florence']);
  assert.notEqual(columns[1]!.color, columns[2]!.color);
  assert.equal(calendarColumns({ ...trip, stops: [] })[0]!.destination, undefined);
});

test('transport uses real local timestamps or an explicitly suggested day without inventing an hour', () => {
  assert.deepEqual(transportPlacement(leg, stops), { day: '2027-06-03', hour: null, suggested: true });
  assert.deepEqual(transportPlacement({ ...leg, departureTime: '2027-06-02T22:30:00Z' }, stops), { day: '2027-06-03', hour: '00:00', suggested: false });
  assert.deepEqual(transportPlacement({ ...leg, fromStopId: null, fromLocation: 'Home', toStopId: 'rome' }, stops), { day: '2027-06-01', hour: null, suggested: true });
  assert.deepEqual(transportPlacement({ ...leg, fromStopId: 'florence', toStopId: null, toLocation: 'Home' }, stops), { day: '2027-06-05', hour: null, suggested: true });
  assert.deepEqual(transportPlacement(leg, []), { day: null, hour: null, suggested: true });
});

test('accommodation row uses local stay dates and does not count checkout as another night', () => {
  assert.equal(stayCoversDay(stay, '2027-06-02', stops), true);
  assert.equal(stayCoversDay(stay, '2027-06-03', stops), false);
  const booked = { ...stay, checkIn: '2027-06-01T22:30:00Z', checkOut: '2027-06-04T09:00:00Z' };
  assert.equal(stayCoversDay(booked, '2027-06-01', stops), false);
  assert.equal(stayCoversDay(booked, '2027-06-03', stops), true);
  assert.equal(stayCoversDay({ ...booked, checkOut: '2027-06-02T18:00:00Z' }, '2027-06-02', stops), true);
});

test('route planning keeps arrival and return for a single destination', () => {
  const routes = tripRoutes({ ...trip, stops: [stops[0]!] });
  assert.equal(routes.length, 2);
  assert.equal(routes[0]!.fromStopId, null);
  assert.equal(routes[0]!.toStopId, 'rome');
  assert.equal(routes[1]!.fromStopId, 'rome');
  assert.equal(routes[1]!.toStopId, null);
});
