import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTripNavigation, tripLocation } from '../lib/packing-navigation.ts';

const first = 'aaaaaaaa-1111-4111-8111-111111111111';
const second = 'bbbbbbbb-2222-4222-8222-222222222222';

test('opening a trip starts in Schedule and both tabs preserve that trip across reloads', () => {
  assert.deepEqual(parseTripNavigation(tripLocation(first)), { tripId: first, view: 'schedule' });
  for (const view of ['schedule', 'packing'] as const) {
    assert.deepEqual(parseTripNavigation(tripLocation(first, view)), { tripId: first, view });
    assert.deepEqual(parseTripNavigation(tripLocation(second, view)), { tripId: second, view });
  }
});

test('Home and incomplete packing links never select an unrelated trip', () => {
  for (const hash of ['', '#home', '#trips', '#packing', '#packing/no-trip', '#trip/' + first, '#trip/' + first + '/unknown']) {
    assert.deepEqual(parseTripNavigation(hash), { tripId: null, view: 'schedule' });
  }
  assert.deepEqual(parseTripNavigation('#packing/' + first), { tripId: first, view: 'packing' });
});
