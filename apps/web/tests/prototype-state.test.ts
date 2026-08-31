import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyProposalChanges,
  createInitialPrototypeState,
  createTripFromDraft,
  proposalChangesFromPrompt,
  restorePrototypeState,
} from '../lib/prototype-state.ts';

const draft = {
  name: 'Northern lights',
  area: 'Norway',
  start: '2027-02-02',
  end: '2027-02-08',
  travelers: '2',
  stops: ['Oslo', 'Tromsø'],
};

test('creates a portable trip record from form values', () => {
  const trip = createTripFromDraft(draft, 42);

  assert.equal(trip.id, 'northern-lights-16');
  assert.equal(trip.dates, 'Feb 2–8, 2027');
  assert.equal(trip.duration, '6 nights');
  assert.deepEqual(trip.route, ['Oslo', 'Tromsø']);
  assert.deepEqual(trip.preview, [
    'Oslo · details to plan',
    'Transport · Oslo to Tromsø',
    'Tromsø · details to plan',
  ]);
});

test('rejects invalid trip ranges and empty routes', () => {
  assert.throws(
    () => createTripFromDraft({ ...draft, end: '2027-02-01' }),
    /end date must be after/i,
  );
  assert.throws(
    () => createTripFromDraft({ ...draft, stops: [] }),
    /at least one destination/i,
  );
});

test('restores valid local state and clears interrupted loading work', () => {
  const state = createInitialPrototypeState();
  state.assignedRomeActivities = ['campo', 'unknown'];
  state.proposal.status = 'loading';

  const restored = restorePrototypeState(JSON.stringify(state));

  assert.deepEqual(restored.assignedRomeActivities, ['campo']);
  assert.equal(restored.proposal.status, 'idle');
});

test('falls back safely when local data is corrupt', () => {
  const restored = restorePrototypeState('{not-json');

  assert.equal(restored.schemaVersion, 1);
  assert.equal(restored.trips[0]?.id, 'italy-spring-2027');
});

test('applies only the proposal operations selected by the user', () => {
  const state = createInitialPrototypeState();
  state.proposal.changes = ['move-vatican', 'schedule-borghese'];
  const updated = applyProposalChanges(state, ['move-vatican']);

  assert.equal(updated.proposal.status, 'applied');
  assert.deepEqual(updated.acceptedRomeChanges, ['move-vatican']);
  assert.equal(updated.acceptedRomeChanges.includes('schedule-borghese'), false);
});

test('keeps earlier accepted operations when a later operation is approved', () => {
  const state = createInitialPrototypeState();
  state.proposal.changes = ['move-vatican'];
  const firstUpdate = applyProposalChanges(state, ['move-vatican']);
  firstUpdate.proposal.changes = ['schedule-borghese'];
  const updated = applyProposalChanges(firstUpdate, ['schedule-borghese']);

  assert.deepEqual(updated.acceptedRomeChanges, ['move-vatican', 'schedule-borghese']);
});

test('makes a manual Borghese assignment an explicit move when approved', () => {
  const state = createInitialPrototypeState();
  state.assignedRomeActivities = ['borghese'];
  state.proposal.changes = ['schedule-borghese'];
  const updated = applyProposalChanges(state, ['schedule-borghese']);

  assert.deepEqual(updated.assignedRomeActivities, []);
  assert.deepEqual(updated.acceptedRomeChanges, ['schedule-borghese']);
});

test('recognizes only the operations supported by the local proposal fixture', () => {
  assert.deepEqual(
    proposalChangesFromPrompt('Move the Vatican and add Borghese'),
    ['move-vatican', 'schedule-borghese'],
  );
  assert.deepEqual(proposalChangesFromPrompt('Find a quiet hotel in Venice'), []);
});

test('round-trips a locally created trip through prototype storage', () => {
  const state = createInitialPrototypeState();
  const trip = createTripFromDraft(draft, 42);
  state.trips.unshift(trip);
  const restored = restorePrototypeState(JSON.stringify(state));

  assert.equal(restored.trips[0]?.id, trip.id);
  assert.deepEqual(restored.trips[0]?.route, ['Oslo', 'Tromsø']);
});
