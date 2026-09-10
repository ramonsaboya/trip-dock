import assert from 'node:assert/strict';
import { createApi } from '../src/graphql.js';

// Run exactly the same persistence contract against pg-mem and real PostgreSQL.
export async function exerciseItinerary(api: ReturnType<typeof createApi>) {
  type Trip = { id: string; revision: number; stops: { id: string }[]; transportLegs: { id: string; fromStopId: string | null; toStopId: string | null; fromLocation: string | null; toLocation: string | null }[]; activities: { id: string; status: string; scheduledAt: string | null; durationMinutes: number; timezone: string | null; stopId: string }[] };
  const fields = 'id revision stops { id } transportLegs { id fromStopId toStopId fromLocation toLocation } activities { id status scheduledAt durationMinutes timezone stopId }';
  async function request(query: string, variables: Record<string, unknown>) {
    const response = await api.fetch('http://localhost:4000/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
    return await response.json() as { data?: Record<string, Trip>; errors?: { message: string; extensions: { code: string } }[] };
  }
  const created = await request(`mutation($input: CreateTripInput!) { createTrip(input: $input) { ${fields} } }`, { input: { name: 'Single city', destinationArea: 'Tokyo', startDate: '2027-06-01', endDate: '2027-06-06', stops: [{ name: 'Tokyo', locationText: null, arrivalDate: '2027-06-01', departureDate: '2027-06-06' }] } });
  assert.equal(created.errors, undefined);
  let trip = created.data!.createTrip!;
  const stopId = trip.stops[0]!.id;
  const addTransport = `mutation($tripId: ID!, $revision: Int!, $input: TransportLegInput!) { addTransportLeg(tripId: $tripId, expectedRevision: $revision, input: $input) { ${fields} } }`;
  const transport = { fromStopId: null, toStopId: stopId, fromLocation: 'London', toLocation: null, mode: 'FLIGHT', title: 'Arrival', details: null, departureTime: null, arrivalTime: null, timezone: null };
  for (const input of [transport, { ...transport, fromStopId: stopId, toStopId: null, fromLocation: null, toLocation: 'London', title: 'Return' }, transport]) {
    const result = await request(addTransport, { tripId: trip.id, revision: trip.revision, input });
    assert.equal(result.errors, undefined); trip = result.data!.addTransportLeg!;
  }
  assert.equal(trip.transportLegs.length, 3, 'Additional records remain supported');
  assert.equal(trip.stops.length, 1, 'Home is never an itinerary stop');
  assert.equal(trip.transportLegs[0]!.fromLocation, 'London');
  assert.equal(trip.transportLegs[1]!.toLocation, 'London');
  for (const input of [{ ...transport, fromLocation: null }, { ...transport, fromStopId: stopId }, { ...transport, toStopId: null, toLocation: 'Paris' }]) {
    const result = await request(addTransport, { tripId: trip.id, revision: trip.revision, input });
    assert.equal(result.errors?.[0]?.extensions.code, 'BAD_USER_INPUT');
  }
  const other = await request(`mutation($input: CreateTripInput!) { createTrip(input: $input) { ${fields} } }`, { input: { name: 'Other', destinationArea: 'Paris', startDate: '2027-06-01', endDate: '2027-06-06', stops: [{ name: 'Paris', locationText: null, arrivalDate: null, departureDate: null }] } });
  const foreign = await request(addTransport, { tripId: trip.id, revision: trip.revision, input: { ...transport, toStopId: other.data!.createTrip!.stops[0]!.id } });
  assert.ok(foreign.errors, 'External endpoints do not bypass stop ownership');
  const activityInput = { stopId, title: 'Museum', status: 'BOOKED', scheduledAt: null, timezone: 'Asia/Tokyo' };
  let result = await request(`mutation($tripId: ID!, $revision: Int!, $input: ActivityInput!) { addActivity(tripId: $tripId, expectedRevision: $revision, input: $input) { ${fields} } }`, { tripId: trip.id, revision: trip.revision, input: activityInput });
  assert.equal(result.errors, undefined); trip = result.data!.addActivity!;
  assert.equal(trip.activities[0]!.durationMinutes, 60);
  const id = trip.activities[0]!.id;
  const move = `mutation($id: ID!, $revision: Int!, $input: ActivityInput!) { updateActivity(id: $id, expectedRevision: $revision, input: $input) { ${fields} } }`;
  const staleRevision = trip.revision;
  for (const scheduledAt of ['2027-06-02T05:00:00.000Z', '2027-06-03T10:00:00.000Z', null]) {
    result = await request(move, { id, revision: trip.revision, input: { ...activityInput, scheduledAt } });
    assert.equal(result.errors, undefined); trip = result.data!.updateActivity!;
    assert.equal(trip.activities[0]!.status, 'BOOKED');
    assert.equal(trip.activities[0]!.scheduledAt ? new Date(trip.activities[0]!.scheduledAt!).toISOString() : null, scheduledAt);
    assert.equal(trip.activities[0]!.timezone, 'Asia/Tokyo');
  }
  result = await request(move, { id, revision: staleRevision, input: activityInput });
  assert.ok(result.errors, 'A stale drag cannot overwrite a newer trip');
  result = await request(move, { id, revision: trip.revision, input: { ...activityInput, status: 'DONE' } });
  assert.equal(result.errors, undefined); trip = result.data!.updateActivity!;
  result = await request(move, { id, revision: trip.revision, input: { ...activityInput, status: 'DONE', scheduledAt: '2027-06-04T00:00:00.000Z' } });
  assert.equal(result.errors, undefined);
  assert.equal(result.data!.updateActivity!.activities[0]!.status, 'DONE');
  const reloaded = await request(`query($id: ID!) { trip(id: $id) { ${fields} } }`, { id: trip.id });
  assert.equal(new Date(reloaded.data!.trip!.activities[0]!.scheduledAt!).toISOString(), '2027-06-04T00:00:00.000Z');
  assert.equal(reloaded.data!.trip!.transportLegs.length, 3);
  trip = reloaded.data!.trip!;
  const resized = await request(move, { id, revision: trip.revision, input: { ...activityInput, scheduledAt: new Date(trip.activities[0]!.scheduledAt!).toISOString(), durationMinutes: 150 } });
  assert.equal(resized.errors, undefined);
  trip = resized.data!.updateActivity!;
  assert.equal(trip.activities[0]!.durationMinutes, 150);
  const persisted = await request(`query($id: ID!) { trip(id: $id) { ${fields} } }`, { id: trip.id });
  assert.equal(persisted.data!.trip!.activities[0]!.durationMinutes, 150);
  for (const durationMinutes of [0, -30, 1441]) {
    const invalid = await request(move, { id, revision: trip.revision, input: { ...activityInput, durationMinutes } });
    assert.ok(invalid.errors);
  }

}
