import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFollowUp } from '../features/trips/creation/merge-follow-up.ts';
import { draftToTripInput, tripDraftFieldStateMap } from '../lib/trips/drafts.ts';
import { exampleDraft } from './fixtures/trip-draft.ts';

test('follow-up keeps a manual trip name and stable city when the answer only changes dates', () => {
  const draft = exampleDraft();
  const form = { ...draftToTripInput(draft), name: 'My birthday' };
  const fieldStates = tripDraftFieldStateMap([{ path: 'trip.name', status: 'CONFIRMED', evidence: null, message: null, blocking: false }]);
  const protectedPaths = new Set(['trip.name']);
  const next = mergeFollowUp({ form, fieldStates, protectedPaths, questions: [], draft: exampleDraft({ name: 'Invented replacement' }), answer: 'Keep the dates.', messageReferenceDate: '2028-04-01' });
  assert.equal(next.form.name, 'My birthday');
  assert.equal(next.form.stops[0]?.name, 'Porto');
  assert.equal(next.fieldStates.get('trip.name')?.status, 'CONFIRMED');
  assert.equal(next.protectedPaths.has('trip.name'), true);
  assert.deepEqual(protectedPaths, new Set(['trip.name']));
  assert.equal(form.name, 'My birthday');
});

test('unanswered essential questions remain blocking when an unrelated follow-up returns no questions', () => {
  const question = { id: 'end-date', prompt: 'When do you return?', fieldPaths: ['trip.endDate'], options: [], allowFreeText: true, blocking: true };
  const draft = exampleDraft({ endDate: null, stops: exampleDraft().stops.map(stop => ({ ...stop, departureDate: null })), questions: [question] });
  const next = mergeFollowUp({ form: draftToTripInput(draft), fieldStates: new Map(), protectedPaths: new Set(), questions: [question], draft: exampleDraft(), answer: 'A relaxed trip, please.', messageReferenceDate: '2028-04-01' });
  assert.equal(next.questions.some(item => item.id === question.id && item.blocking), true);
  assert.equal(next.form.endDate, '');
});
