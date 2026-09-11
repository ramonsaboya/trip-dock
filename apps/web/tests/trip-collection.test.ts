import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { loadTripCollection, removeAcceptedTrip, replaceAcceptedTrip } from '../features/trips/trip-collection.ts';
import type { LoadState } from '../features/trips/trip-state.ts';
import type { Trip } from '../lib/trips/types.ts';

const trip = { id: 'trip-a', name: 'Accepted', revision: 1 } as Trip;

test('aborted collection request cannot publish even when fetch resolves after cleanup', async (t) => {
  const response = Promise.withResolvers<Response>();
  let signal: AbortSignal | null | undefined;
  t.mock.method(globalThis, 'fetch', (_url: unknown, init: RequestInit) => { signal = init.signal; return response.promise; });
  const states: LoadState[] = [];
  const cancel = loadTripCollection(state => states.push(state));
  cancel();
  assert.equal(signal?.aborted, true);
  response.resolve(Response.json({ data: { trips: [trip] } }));
  await setImmediate();
  assert.deepEqual(states, []);
});

test('collection failure is visible and a fresh attempt can load an honestly empty list', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  const states: LoadState[] = [];
  loadTripCollection(state => states.push(state));
  await setImmediate();
  assert.equal(states[0]?.kind, 'error');
  fetch.mock.mockImplementation(async () => Response.json({ data: { trips: [] } }));
  loadTripCollection(state => states.push(state));
  await setImmediate();
  assert.deepEqual(states[1], { kind: 'ready', trips: [] });
});

test('an aborted failure does not replace a later successful attempt', async (t) => {
  const old = Promise.withResolvers<Response>();
  const fetch = t.mock.method(globalThis, 'fetch', () => old.promise);
  const states: LoadState[] = [];
  const cancel = loadTripCollection(state => states.push(state));
  cancel();
  fetch.mock.mockImplementation(async () => Response.json({ data: { trips: [trip] } }));
  loadTripCollection(state => states.push(state));
  await setImmediate();
  old.reject(new Error('old failure'));
  await setImmediate();
  assert.deepEqual(states, [{ kind: 'ready', trips: [trip] }]);
});

test('accepted revisions replace whole records and deletion preserves unrelated trips', () => {
  const other = { ...trip, id: 'trip-b' };
  const state: LoadState = { kind: 'ready', trips: [trip, other] };
  const updated = { ...trip, name: 'Saved by API', revision: 2 };
  assert.deepEqual(replaceAcceptedTrip(state, updated), { kind: 'ready', trips: [updated, other] });
  assert.deepEqual(removeAcceptedTrip(state, trip.id), { kind: 'ready', trips: [other] });
  assert.deepEqual(state.trips, [trip, other]);
  assert.deepEqual(replaceAcceptedTrip({ kind: 'ready', trips: [] }, trip), { kind: 'ready', trips: [trip] });
});
