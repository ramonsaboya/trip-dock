import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateTripCreationResult } from '../src/evals/trip-creation-eval.js';
import {
  TRIP_CREATION_EVAL_CORPUS_VERSION,
  tripCreationEvalScenarios,
} from '../src/evals/trip-creation-scenarios.js';
import {
  buildTripCreationDraft,
  type DateIntent,
  type DestinationIntent,
  type TripCreationDraft,
  type TripIntentExtraction,
} from '../src/trip-creation.js';

const missingDate = (): DateIntent => ({
  sourceText: null,
  kind: 'MISSING',
  day: null,
  month: null,
  year: null,
});

function calendar(sourceText: string, day: number, month: number, year: number | null): DateIntent {
  return { sourceText, kind: 'CALENDAR_DATE', day, month, year };
}

function destination(
  city: string,
  durationValue: number,
  durationUnit: 'DAYS' | 'NIGHTS',
  evidence: string,
): DestinationIntent {
  return {
    sourceText: city,
    city,
    context: null,
    localityKind: 'CITY',
    origin: 'USER_EXPLICIT',
    candidates: [],
    arrivalDate: missingDate(),
    departureDate: missingDate(),
    stayDuration: { value: durationValue, unit: durationUnit, evidence },
  };
}

function extraction(options: Partial<TripIntentExtraction> = {}): TripIntentExtraction {
  return {
    name: { value: null, evidence: null, origin: 'MISSING' },
    destinationArea: { value: null, evidence: null, origin: 'MISSING' },
    travelerCount: { value: null, evidence: null, origin: 'MISSING' },
    startDate: missingDate(),
    endDate: missingDate(),
    duration: { value: null, unit: 'MISSING', evidence: null },
    destinations: [],
    assumptions: [],
    warnings: [],
    ...options,
  };
}

function scenario(id: string) {
  const match = tripCreationEvalScenarios.find((candidate) => candidate.id === id);
  assert.ok(match, `Missing eval scenario ${id}`);
  return match;
}

function evaluateCanonical(id: string, value: TripIntentExtraction) {
  const selected = scenario(id);
  const request = { ...selected.context, prompt: selected.variants[0]!.prompt };
  const draft = buildTripCreationDraft(value, request);
  return {
    scenario: selected,
    extraction: value,
    draft,
    evaluation: evaluateTripCreationResult(selected, value, draft),
  };
}

function fixedNightDestinations(): DestinationIntent[] {
  return [
    destination('Rome', 4, 'NIGHTS', '4 nights in Rome'),
    destination('Maiori', 2, 'NIGHTS', '2 nights in Maiori'),
    destination('Naples', 2, 'NIGHTS', '2 nights in Naples'),
  ];
}

test('the MVP corpus has four stable scenario families and four prompt cases', () => {
  assert.equal(TRIP_CREATION_EVAL_CORPUS_VERSION, '1.0.0');
  assert.equal(tripCreationEvalScenarios.length, 4);
  assert.equal(new Set(tripCreationEvalScenarios.map(({ id }) => id)).size, 4);
  assert.equal(
    tripCreationEvalScenarios.reduce((total, item) => total + item.variants.length, 0),
    4,
  );
  assert.deepEqual(
    tripCreationEvalScenarios.map(({ suite }) => suite),
    ['REGRESSION', 'REGRESSION', 'REGRESSION', 'REGRESSION'],
  );
  for (const item of tripCreationEvalScenarios) {
    assert.equal(item.variants.length, 1);
    assert.equal(new Set(item.variants.map(({ id }) => id)).size, 1);
    assert.deepEqual(item.context, {
      locale: 'en-GB',
      timeZone: 'Europe/London',
      referenceDate: '2026-09-05',
    });
  }
});

test('the year-elision regression passes when the resolver anchors the paired endpoint', () => {
  const result = evaluateCanonical(
    'dates.partial-endpoint-year',
    extraction({
      startDate: calendar('28th of August 2027', 28, 8, 2027),
      endDate: calendar('5th of September', 5, 9, null),
    }),
  );
  assert.equal(result.evaluation.passed, true, JSON.stringify(result.evaluation.failures));
  assert.equal(result.evaluation.releaseBlocking, false);
});

test('the country hierarchy regression passes with Italy as area and exactly three city stops', () => {
  const result = evaluateCanonical(
    'destinations.country-vs-cities',
    extraction({
      destinationArea: { value: 'Italy', evidence: 'Italy', origin: 'USER_EXPLICIT' },
      destinations: [
        destination('Rome', 3, 'DAYS', '3 days in Rome'),
        destination('Maiori', 4, 'DAYS', '4 days in Maiori'),
        destination('Naples', 2, 'DAYS', '2 days in Naples'),
      ],
    }),
  );
  assert.equal(result.evaluation.passed, true, JSON.stringify(result.evaluation.failures));
});

test('the fixed-boundaries regression passes with contiguous exact-night intervals', () => {
  const result = evaluateCanonical(
    'itinerary.fixed-bounds-exact-nights',
    extraction({
      startDate: calendar('28th of August 2027', 28, 8, 2027),
      endDate: calendar('5th of September 2027', 5, 9, 2027),
      destinations: fixedNightDestinations(),
    }),
  );
  assert.equal(result.evaluation.passed, true, JSON.stringify(result.evaluation.failures));
});

test('the oracle detects a wrong inherited year', () => {
  const result = evaluateCanonical(
    'dates.partial-endpoint-year',
    extraction({
      startDate: calendar('28th of August 2027', 28, 8, 2027),
      endDate: calendar('5th of September', 5, 9, null),
    }),
  );
  const wrongDraft = structuredClone(result.draft);
  wrongDraft.endDate = '2026-09-05';
  const evaluation = evaluateTripCreationResult(result.scenario, result.extraction, wrongDraft);
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.releaseBlocking, true);
  assert.ok(evaluation.failures.some(({ layer, path }) => layer === 'draft' && path === 'endDate'));
});

test('the oracle detects a country incorrectly added as a fourth city stop', () => {
  const selected = scenario('destinations.country-vs-cities');
  const request = { ...selected.context, prompt: selected.variants[0]!.prompt };
  const value = extraction({
    destinationArea: { value: 'Italy', evidence: 'Italy', origin: 'USER_EXPLICIT' },
    destinations: [
      destination('Italy', 3, 'DAYS', 'Italy, 3 days'),
      destination('Rome', 3, 'DAYS', '3 days in Rome'),
      destination('Maiori', 4, 'DAYS', '4 days in Maiori'),
      destination('Naples', 2, 'DAYS', '2 days in Naples'),
    ],
  });
  const draft = buildTripCreationDraft(value, request);
  const evaluation = evaluateTripCreationResult(selected, value, draft);
  assert.equal(evaluation.passed, false);
  assert.ok(evaluation.failures.some(({ path }) => path === 'destinations[city!=Italy]'));
});

test('the oracle detects missing per-stop dates even when overall dates are correct', () => {
  const result = evaluateCanonical(
    'itinerary.fixed-bounds-exact-nights',
    extraction({
      startDate: calendar('28th of August 2027', 28, 8, 2027),
      endDate: calendar('5th of September 2027', 5, 9, 2027),
      destinations: fixedNightDestinations(),
    }),
  );
  const incompleteDraft: TripCreationDraft = structuredClone(result.draft);
  incompleteDraft.stops[1]!.arrivalDate = null;
  incompleteDraft.stops[1]!.departureDate = null;
  const evaluation = evaluateTripCreationResult(result.scenario, result.extraction, incompleteDraft);
  assert.equal(evaluation.passed, false);
  assert.ok(evaluation.failures.some(({ path }) => path === 'stops.intervals'));
});

test('the start-plus-nights regression derives the trip end and contiguous intervals', () => {
  const result = evaluateCanonical(
    'itinerary.derive-end-from-stop-nights',
    extraction({
      startDate: calendar('28th of August 2027', 28, 8, 2027),
      destinations: fixedNightDestinations(),
    }),
  );
  assert.equal(result.draft.endDate, '2027-09-05');
  assert.deepEqual(
    result.draft.stops.map(({ name, arrivalDate, departureDate }) => ({
      name,
      arrivalDate,
      departureDate,
    })),
    [
      { name: 'Rome', arrivalDate: '2027-08-28', departureDate: '2027-09-01' },
      { name: 'Maiori', arrivalDate: '2027-09-01', departureDate: '2027-09-03' },
      { name: 'Naples', arrivalDate: '2027-09-03', departureDate: '2027-09-05' },
    ],
  );
  assert.equal(result.draft.minimumViable, true);
  assert.equal(result.evaluation.passed, true, JSON.stringify(result.evaluation.failures));
  assert.equal(result.evaluation.releaseBlocking, false);
});
