import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarColumns, calendarHourDestination, calendarTransition, calendarStartHour, calendarStayBands, stayCoversDay, transportPlacement, transportMoveInput, tripRoutes } from '../lib/trip-calendar.ts';
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
  assert.equal(columns[2]!.destination, undefined);
  assert.deepEqual(columns[2]!.colors, [0, 1]);
  assert.deepEqual(columns[2]!.destinations.map((stop) => stop.id), ['rome', 'florence']);
  assert.notEqual(columns[1]!.color, columns[2]!.color);
  assert.equal(calendarColumns({ ...trip, stops: [] })[0]!.destination, undefined);
});

test('transport uses real local timestamps or an explicitly suggested day with an unsaved 10 a.m. placeholder', () => {
  assert.deepEqual(transportPlacement(leg, stops), { day: '2027-06-03', hour: '10:00', suggested: true });
  assert.deepEqual(transportPlacement({ ...leg, departureTime: '2027-06-02T22:30:00Z' }, stops), { day: '2027-06-03', hour: '00:00', suggested: false });
  assert.deepEqual(transportPlacement({ ...leg, fromStopId: null, fromLocation: 'Home', toStopId: 'rome' }, stops), { day: '2027-06-01', hour: '10:00', suggested: true });
  assert.deepEqual(transportPlacement({ ...leg, fromStopId: 'florence', toStopId: null, toLocation: 'Home' }, stops), { day: '2027-06-05', hour: '10:00', suggested: true });
  assert.deepEqual(transportPlacement(leg, []), { day: null, hour: '10:00', suggested: true });
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


test('calendar opens at 9 a.m. or the earliest visible scheduled item in its local timezone', () => {
  assert.equal(calendarStartHour(trip, ['2027-06-01']), '09:00');
  const earlyTrip: Trip = { ...trip, activities: [{ id: 'walk', tripId: 'trip', stopId: 'rome', position: 0, title: 'Walk', status: 'IDEA', scheduledAt: '2027-06-01T05:30:00Z', timezone: 'Europe/Rome' }] };
  assert.equal(calendarStartHour(earlyTrip, ['2027-06-01']), '07:00');
  assert.equal(calendarStartHour(earlyTrip, ['2027-06-02']), '09:00');
  assert.equal(calendarStartHour({ ...trip, transportLegs: [{ ...leg, departureTime: '2027-06-02T22:30:00Z' }] }, ['2027-06-03']), '00:00');
  assert.equal(calendarStartHour({ ...trip, transportLegs: [leg] }, ['2027-06-03']), '09:00');
});

test('stay cells merge across unchanged nights and split when the accommodation changes', () => {
  const hotelTrip = { ...trip, stays: [stay, { ...stay, id: 'second', stopId: 'florence' }] };
  const bands = calendarStayBands(hotelTrip, calendarColumns(hotelTrip));
  assert.deepEqual(bands.map((band) => band.span), [5, 3, 2]);
  assert.deepEqual(bands.map((band) => band.stays.map((item) => item.id)), [['hotel'], ['second'], []]);
  const withExtra = { ...hotelTrip, stays: [...hotelTrip.stays, { ...stay, id: 'alternative', checkIn: '2027-06-02T13:00:00Z', checkOut: '2027-06-03T09:00:00Z' }] };
  assert.deepEqual(calendarStayBands(withExtra, calendarColumns(withExtra)).map((band) => band.span), [2, 3, 3, 2]);
});


test('transfer-day paper changes city after the two-hour placeholder', () => {
  assert.equal(calendarHourDestination(trip, '2027-06-03', '09:00')?.id, 'rome');
  assert.equal(calendarHourDestination(trip, '2027-06-03', '10:00')?.id, 'rome');
  assert.equal(calendarHourDestination(trip, '2027-06-03', '12:00')?.id, 'florence');
  assert.equal(calendarHourDestination(trip, '2027-06-01', '09:00')?.id, 'rome');
  assert.equal(calendarHourDestination(trip, '2027-06-01', '11:00')?.id, 'rome');
  assert.equal(calendarHourDestination(trip, '2027-06-05', '09:00')?.id, 'florence');
  assert.equal(calendarHourDestination(trip, '2027-06-05', '23:00')?.id, 'florence');
  assert.equal(calendarHourDestination(trip, '2027-06-02', '10:00')?.id, 'rome');
});

test('recorded transport times replace the placeholder transition in local time', () => {
  const booked = { ...trip, transportLegs: [{ ...leg, departureTime: '2027-06-03T12:00:00Z', arrivalTime: '2027-06-03T14:00:00Z' }] };
  assert.equal(calendarHourDestination(booked, '2027-06-03', '10:00')?.id, 'rome');
  assert.equal(calendarTransition(booked, '2027-06-03', '14:00')?.from, 'rome');
  assert.equal(calendarTransition(booked, '2027-06-03', '15:00')?.to, 'florence');
  assert.equal(calendarHourDestination(booked, '2027-06-03', '16:00')?.id, 'florence');
});

test('empty stay sections align to destination boundaries without a shared header', () => {
  const bands = calendarStayBands(trip, calendarColumns(trip));
  assert.deepEqual(bands.map((band) => band.span), [5, 5]);
  assert.deepEqual(bands.map((band) => band.destinations.map((stop) => stop.id)), [['rome'], ['florence']]);
});

test('placeholder transition spans two hours and excludes external trip boundaries', () => {
  assert.deepEqual(calendarTransition(trip, '2027-06-03', '10:00'), { start: 10, end: 12, from: 'rome', to: 'florence' });
  assert.ok(calendarTransition(trip, '2027-06-03', '11:00'));
  assert.equal(calendarTransition(trip, '2027-06-03', '12:00'), undefined);
  assert.equal(calendarTransition(trip, '2027-06-01', '10:00'), undefined);
  assert.equal(calendarTransition(trip, '2027-06-05', '10:00'), undefined);
});

test('dragging transport preserves route, details and elapsed travel duration', () => {
  const booked = { ...leg, departureTime: '2027-06-03T08:00:00Z', arrivalTime: '2027-06-03T10:00:00Z', details: 'Seat 12A' };
  const moved = transportMoveInput(booked, '2027-06-04', '14:00', 'Europe/Rome');
  assert.equal(moved.departureTime, '2027-06-04T12:00:00.000Z');
  assert.equal(moved.arrivalTime, '2027-06-04T14:00:00.000Z');
  assert.equal(moved.fromStopId, 'rome');
  assert.equal(moved.toStopId, 'florence');
  assert.equal(moved.details, 'Seat 12A');
  assert.equal(transportMoveInput(leg, '2027-06-04', '14:00', 'Europe/Rome').arrivalTime, null);
  const arrivalOnly = transportMoveInput({ ...leg, arrivalTime: booked.arrivalTime }, '2027-06-04', '14:00', 'Europe/Rome');
  assert.equal(arrivalOnly.departureTime, null);
  assert.equal(arrivalOnly.arrivalTime, '2027-06-04T12:00:00.000Z');
});
