import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTripCreationDraft,
  resolveDateIntent,
  resolveNextWeekend,
  type DateIntent,
  type DestinationIntent,
  type TripCreationRequest,
  type TripIntentExtraction,
} from '../src/trip-creation.js';

const missingDate = (): DateIntent => ({
  sourceText: null,
  kind: 'MISSING',
  day: null,
  month: null,
  year: null,
});

function calendar(
  sourceText: string,
  day: number,
  month: number,
  year: number | null = null,
  kind: DateIntent['kind'] = 'CALENDAR_DATE',
): DateIntent {
  return { sourceText, kind, day, month, year };
}

function request(
  prompt: string,
  referenceDate = '2026-09-03',
  locale = 'en-GB',
): TripCreationRequest {
  return { prompt, referenceDate, locale, timeZone: 'Europe/London' };
}

function destination(
  sourceText: string | null,
  city: string | null,
  localityKind: DestinationIntent['localityKind'],
  options: Partial<DestinationIntent> = {},
): DestinationIntent {
  return {
    sourceText,
    city,
    context: null,
    localityKind,
    origin: city ? 'USER_EXPLICIT' : 'MISSING',
    candidates: [],
    arrivalDate: missingDate(),
    departureDate: missingDate(),
    stayDuration: { value: null, unit: 'MISSING', evidence: null },
    ...options,
  };
}

function extraction(
  options: Partial<TripIntentExtraction> = {},
): TripIntentExtraction {
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

test('yearless calendar dates use the next occurrence on or after the reference date', () => {
  assert.equal(
    resolveDateIntent(calendar('10 May', 10, 5), request('10 May')).value,
    '2027-05-10',
  );
  assert.equal(
    resolveDateIntent(calendar('10 October', 10, 10), request('10 October')).value,
    '2026-10-10',
  );
});

test('yearless ranges are anchored together after the start rolls into the following year', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('28th of Aug', 28, 8),
      endDate: calendar('5th September', 5, 9),
      destinations: [destination('Rome', 'Rome', 'CITY')],
    }),
    request('Rome from 28th of Aug to 5th September'),
  );
  assert.equal(draft.startDate, '2027-08-28');
  assert.equal(draft.endDate, '2027-09-05');
  assert.equal(draft.minimumViable, true);
});

test('same-month yearless ranges stay together when both dates have passed this year', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('28th of August', 28, 8),
      endDate: calendar('30th of August', 30, 8),
      destinations: [destination('Rome', 'Rome', 'CITY')],
    }),
    request('Rome from 28th of August to 30th of August'),
  );
  assert.equal(draft.startDate, '2027-08-28');
  assert.equal(draft.endDate, '2027-08-30');
  assert.equal(draft.minimumViable, true);
});

test('numeric dates follow the user locale while unambiguous dates do not', () => {
  const intent = calendar('05/06', 5, 6, null, 'NUMERIC_DATE');
  assert.equal(resolveDateIntent(intent, request('05/06', '2026-01-01', 'en-GB')).value, '2026-06-05');
  assert.equal(resolveDateIntent(intent, request('05/06', '2026-01-01', 'en-US')).value, '2026-05-06');
  const unambiguous = calendar('13/06', 13, 6, null, 'NUMERIC_DATE');
  assert.equal(resolveDateIntent(unambiguous, request('13/06', '2026-01-01', 'en-US')).value, '2026-06-13');
});

test('ISO and named range evidence is not reinterpreted as a locale-dependent numeric date', () => {
  assert.equal(
    resolveDateIntent(calendar('2025-06-10', 10, 6, 2025), request('2025-06-10')).value,
    '2025-06-10',
  );
  assert.equal(
    resolveDateIntent(calendar('10–12 May', 10, 5), request('10–12 May')).value,
    '2027-05-10',
  );
});

test('shared named ranges verify the correct boundary and retain a shared year', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('May 10–12, 2027', 10, 5, 2027),
      endDate: calendar('May 10–12, 2027', 12, 5, 2027),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo May 10–12, 2027', '2028-01-03', 'en-US'),
  );
  assert.equal(draft.startDate, '2027-05-10');
  assert.equal(draft.endDate, '2027-05-12');
  assert.equal(draft.minimumViable, true);

  const duplicatedEndpoint = buildTripCreationDraft(
    extraction({
      startDate: calendar('10–12 May 2027', 12, 5, 2027),
      endDate: calendar('10–12 May 2027', 12, 5, 2027),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo 10–12 May 2027', '2026-01-03'),
  );
  assert.equal(duplicatedEndpoint.startDate, null);
  assert.equal(duplicatedEndpoint.minimumViable, false);
  assert.ok(duplicatedEndpoint.questions.some(({ id }) => id === 'start-date-required'));

  const duplicatedStart = buildTripCreationDraft(
    extraction({
      startDate: calendar('May 10–12, 2027', 10, 5, 2027),
      endDate: calendar('May 10–12, 2027', 10, 5, 2027),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo May 10–12, 2027', '2026-01-03', 'en-US'),
  );
  assert.equal(duplicatedStart.endDate, null);
  assert.equal(duplicatedStart.minimumViable, false);
  assert.ok(duplicatedStart.questions.some(({ id }) => id === 'end-date-required'));

  for (const [source, duplicatedDay, missingBoundary] of [
    ['10 through 12 May', 12, 'startDate'],
    ['May 10 through 12', 10, 'endDate'],
    ['10 until 12 May', 12, 'startDate'],
  ] as const) {
    const duplicate = calendar(source, duplicatedDay, 5);
    const rangeDraft = buildTripCreationDraft(
      extraction({
        startDate: duplicate,
        endDate: duplicate,
        destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
      }),
      request(`Tokyo ${source}`, '2026-01-03', source.startsWith('May') ? 'en-US' : 'en-GB'),
    );
    assert.equal(rangeDraft[missingBoundary], null, source);
    assert.equal(rangeDraft.minimumViable, false, source);
  }
});

test('cross-month ranges bind each extracted value to its semantic boundary', () => {
  const correct = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 May to 12 June 2027', 10, 5, 2027),
      endDate: calendar('10 May to 12 June 2027', 12, 6, 2027),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 May to 12 June 2027', '2026-01-03'),
  );
  assert.equal(correct.startDate, '2027-05-10');
  assert.equal(correct.endDate, '2027-06-12');

  for (const [label, startDate, endDate, missingBoundary] of [
    [
      'full duplicated end',
      calendar('10 May to 12 June', 12, 6),
      calendar('10 May to 12 June', 12, 6),
      'startDate',
    ],
    [
      'full duplicated start',
      calendar('10 May to 12 June', 10, 5),
      calendar('10 May to 12 June', 10, 5),
      'endDate',
    ],
    [
      'cropped duplicated end',
      calendar('12 June', 12, 6),
      calendar('12 June', 12, 6),
      'startDate',
    ],
    [
      'cropped duplicated start',
      calendar('10 May', 10, 5),
      calendar('10 May', 10, 5),
      'endDate',
    ],
  ] as const) {
    const draft = buildTripCreationDraft(
      extraction({ startDate, endDate, destinations: [destination('Tokyo', 'Tokyo', 'CITY')] }),
      request('Tokyo from 10 May to 12 June', '2026-01-03'),
    );
    assert.equal(draft[missingBoundary], null, label);
    assert.equal(draft.minimumViable, false, label);
  }
});

test('full-span December-January ranges anchor the implicit endpoint across years', () => {
  const yearAtEnd = buildTripCreationDraft(
    extraction({
      startDate: calendar('28 December to 3 January 2029', 28, 12),
      endDate: calendar('28 December to 3 January 2029', 3, 1, 2029),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 28 December to 3 January 2029', '2026-01-03'),
  );
  assert.equal(yearAtEnd.startDate, '2028-12-28');
  assert.equal(yearAtEnd.endDate, '2029-01-03');

  const yearAtStart = buildTripCreationDraft(
    extraction({
      startDate: calendar('December 28, 2028 to January 3', 28, 12, 2028),
      endDate: calendar('December 28, 2028 to January 3', 3, 1),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from December 28, 2028 to January 3', '2026-01-03', 'en-US'),
  );
  assert.equal(yearAtStart.startDate, '2028-12-28');
  assert.equal(yearAtStart.endDate, '2029-01-03');
});

test('punctuated month abbreviations retain explicit years', () => {
  const individual = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 Sept. 2025', 10, 9, 2025),
      endDate: calendar('12 Sept. 2025', 12, 9, 2025),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 Sept. 2025 to 12 Sept. 2025'),
  );
  assert.equal(individual.startDate, '2025-09-10');
  assert.equal(individual.endDate, '2025-09-12');
  assert.equal(individual.minimumViable, true);

  const compressedRange = buildTripCreationDraft(
    extraction({
      startDate: calendar('10–12 Sept. 2025', 10, 9, 2025),
      endDate: calendar('10–12 Sept. 2025', 12, 9, 2025),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo 10–12 Sept. 2025'),
  );
  assert.equal(compressedRange.startDate, '2025-09-10');
  assert.equal(compressedRange.endDate, '2025-09-12');
});

test('invalid calendar dates remain missing and require attention', () => {
  const result = resolveDateIntent(calendar('31 April', 31, 4), request('31 April'));
  assert.equal(result.value, null);
  assert.equal(result.status, 'INVALID');
  assert.equal(
    resolveDateIntent(calendar('29 February 2027', 29, 2, 2027), request('29 February 2027')).value,
    null,
  );
  assert.equal(
    resolveDateIntent(calendar('29 February', 29, 2), request('29 February', '2026-03-01')).value,
    '2028-02-29',
  );
});

test('month-only input remains unresolved instead of inventing a day', () => {
  const monthOnly: DateIntent = {
    sourceText: 'May',
    kind: 'MONTH_ONLY',
    day: null,
    month: 5,
    year: null,
  };
  const draft = buildTripCreationDraft(
    extraction({
      startDate: monthOnly,
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo in May'),
  );
  assert.equal(draft.startDate, null);
  assert.ok(draft.questions.some(({ id }) => id === 'start-date-required'));
});

test('this Friday means today when the reference date is Friday', () => {
  const result = resolveDateIntent(
    { sourceText: 'this Friday', kind: 'THIS_FRIDAY', day: null, month: null, year: null },
    request('this Friday', '2026-09-04'),
  );
  assert.equal(result.value, '2026-09-04');
});

test('next weekend is Saturday-Sunday, with Friday asking between two weekends', () => {
  assert.deepEqual(resolveNextWeekend('2026-09-03'), {
    kind: 'resolved',
    startDate: '2026-09-05',
    endDate: '2026-09-06',
    message: 'Weekend means Saturday and Sunday; Friday is not included.',
  });
  const friday = resolveNextWeekend('2026-09-04');
  assert.equal(friday.kind, 'ambiguous');
  if (friday.kind === 'ambiguous') {
    assert.deepEqual(friday.choices, [
      { startDate: '2026-09-05', endDate: '2026-09-06' },
      { startDate: '2026-09-12', endDate: '2026-09-13' },
    ]);
  }
  assert.deepEqual(resolveNextWeekend('2026-09-05'), {
    kind: 'resolved',
    startDate: '2026-09-12',
    endDate: '2026-09-13',
    message: 'Weekend means Saturday and Sunday; Friday is not included.',
  });
  assert.deepEqual(resolveNextWeekend('2026-09-06'), {
    kind: 'resolved',
    startDate: '2026-09-12',
    endDate: '2026-09-13',
    message: 'Weekend means Saturday and Sunday; Friday is not included.',
  });
});

test('next weekend only becomes a complete range when both boundaries carry that intent', () => {
  const weekend: DateIntent = {
    sourceText: 'next weekend',
    kind: 'NEXT_WEEKEND',
    day: null,
    month: null,
    year: null,
  };
  const partial = buildTripCreationDraft(
    extraction({
      startDate: weekend,
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo starting next weekend'),
  );
  assert.equal(partial.endDate, null);
  assert.equal(partial.minimumViable, false);
  assert.ok(partial.questions.some(({ id }) => id === 'next-weekend-mixed-boundary'));

  const whole = buildTripCreationDraft(
    extraction({
      startDate: weekend,
      endDate: weekend,
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo next weekend'),
  );
  assert.equal(whole.startDate, '2026-09-05');
  assert.equal(whole.endDate, '2026-09-06');
  assert.equal(whole.minimumViable, true);
});

test('next weekend remains blocked when it contradicts a stated duration', () => {
  const weekend: DateIntent = {
    sourceText: 'next weekend',
    kind: 'NEXT_WEEKEND',
    day: null,
    month: null,
    year: null,
  };
  const draft = buildTripCreationDraft(
    extraction({
      startDate: weekend,
      endDate: weekend,
      duration: { value: 3, unit: 'NIGHTS', evidence: '3 nights' },
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo next weekend for 3 nights', '2026-09-04'),
  );
  assert.equal(draft.minimumViable, false);
  assert.ok(draft.questions.some(({ id }) => id === 'next-weekend-friday'));
  assert.ok(draft.questions.some(({ id }) => id === 'date-duration-conflict'));
});

test('implicit end dates roll forward relative to a far-future December start', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('28 December 2028', 28, 12, 2028),
      endDate: calendar('3 January', 3, 1),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 28 December 2028 to 3 January'),
  );
  assert.equal(draft.startDate, '2028-12-28');
  assert.equal(draft.endDate, '2029-01-03');
  assert.equal(draft.minimumViable, true);
});

test('a yearless range endpoint is anchored to its explicitly dated counterpart', () => {
  const future = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 October 2028', 10, 10, 2028),
      endDate: calendar('12 October', 12, 10),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 October 2028 to 12 October'),
  );
  assert.equal(future.startDate, '2028-10-10');
  assert.equal(future.endDate, '2028-10-12');
  assert.equal(future.minimumViable, true);

  const explicitEnd = buildTripCreationDraft(
    extraction({
      startDate: calendar('28 December', 28, 12),
      endDate: calendar('3 January 2029', 3, 1, 2029),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 28 December to 3 January 2029'),
  );
  assert.equal(explicitEnd.startDate, '2028-12-28');
  assert.equal(explicitEnd.endDate, '2029-01-03');
});

test('anchoring a yearless endpoint can produce a clearly marked historical range', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 May 2025', 10, 5, 2025),
      endDate: calendar('12 May', 12, 5),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 May 2025 to 12 May'),
  );
  assert.equal(draft.startDate, '2025-05-10');
  assert.equal(draft.endDate, '2025-05-12');
  assert.equal(draft.minimumViable, true);
  assert.equal(draft.fieldStates.find(({ path }) => path === 'trip.endDate')?.status, 'PAST');
});

test('an unexpected implicit cross-year range requires clarification', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 October', 10, 10),
      endDate: calendar('9 September', 9, 9),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 October to 9 September'),
  );
  assert.equal(draft.minimumViable, false);
  assert.ok(draft.questions.some(({ id }) => id === 'date-range-conflict'));
});

test('explicit reversed years remain a blocking contradiction', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('28 December 2028', 28, 12, 2028),
      endDate: calendar('3 January 2028', 3, 1, 2028),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 28 December 2028 to 3 January 2028'),
  );
  assert.equal(draft.minimumViable, false);
  assert.ok(draft.questions.some(({ id }) => id === 'date-range-conflict'));
});

test('a model-supplied year absent from evidence cannot turn a yearless date into an accepted past date', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 May', 10, 5, 2025),
      endDate: calendar('12 May', 12, 5, 2025),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 May to 12 May'),
  );
  assert.equal(draft.startDate, '2027-05-10');
  assert.equal(draft.endDate, '2027-05-12');
  assert.ok(!draft.warnings.some((warning) => warning.includes('past')));
});

test('an explicit year in date evidence is retained even if the model omits it', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 May 2025', 10, 5),
      endDate: calendar('12 May 2025', 12, 5),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 May 2025 to 12 May 2025'),
  );
  assert.equal(draft.startDate, '2025-05-10');
  assert.equal(draft.endDate, '2025-05-12');
  assert.equal(draft.minimumViable, true);
});

test('calendar components that do not match their quoted evidence are not accepted', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 May 2025', 20, 6, 2025),
      endDate: calendar('12 May 2025', 12, 5, 2025),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 May 2025 to 12 May 2025'),
  );
  assert.equal(draft.startDate, null);
  assert.equal(draft.minimumViable, false);
  assert.equal(
    draft.fieldStates.find(({ path }) => path === 'trip.startDate')?.status,
    'NEEDS_ATTENTION',
  );

  const crossedRangeComponents = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 May to 12 June', 12, 5),
      endDate: calendar('10 May to 12 June', 12, 6),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 May to 12 June'),
  );
  assert.equal(crossedRangeComponents.startDate, null);
  assert.equal(crossedRangeComponents.minimumViable, false);
});

test('relative and numeric date kinds must match their evidence', () => {
  const mislabeledRelative = buildTripCreationDraft(
    extraction({
      startDate: { sourceText: '10 October', kind: 'TODAY', day: null, month: null, year: null },
      endDate: calendar('12 October', 12, 10),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 October to 12 October'),
  );
  assert.equal(mislabeledRelative.startDate, null);
  assert.equal(mislabeledRelative.minimumViable, false);

  const shortYear = resolveDateIntent(
    calendar('05/06/26', 5, 6, 2026, 'NUMERIC_DATE'),
    request('05/06/26', '2026-01-01'),
  );
  assert.equal(shortYear.value, null);
  assert.equal(shortYear.status, 'INVALID');
});

test('next week cannot be mislabeled as next weekend', () => {
  const mislabeled: DateIntent = {
    sourceText: 'next week',
    kind: 'NEXT_WEEKEND',
    day: null,
    month: null,
    year: null,
  };
  const draft = buildTripCreationDraft(
    extraction({
      startDate: mislabeled,
      endDate: mislabeled,
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo next week'),
  );
  assert.equal(draft.startDate, null);
  assert.equal(draft.endDate, null);
  assert.equal(draft.minimumViable, false);
});

test('traveler count and duration must match their quoted evidence', () => {
  const travelerMismatch = buildTripCreationDraft(
    extraction({
      travelerCount: { value: 20, evidence: 'two people', origin: 'USER_EXPLICIT' },
      startDate: calendar('10 October', 10, 10),
      endDate: calendar('12 October', 12, 10),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 October to 12 October for two people'),
  );
  assert.equal(travelerMismatch.travelerCount, null);

  const durationMismatch = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 October', 10, 10),
      duration: { value: 30, unit: 'DAYS', evidence: '2 nights' },
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 October for 2 nights'),
  );
  assert.equal(durationMismatch.endDate, null);
  assert.equal(durationMismatch.minimumViable, false);

  const broadEvidence = buildTripCreationDraft(
    extraction({
      travelerCount: { value: 5, evidence: '2 people for 3 nights', origin: 'USER_EXPLICIT' },
      startDate: calendar('10 October', 10, 10),
      endDate: calendar('13 October', 13, 10),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 October to 13 October, 2 people for 3 nights'),
  );
  assert.equal(broadEvidence.travelerCount, null);

  const missingOrigin = buildTripCreationDraft(
    extraction({
      travelerCount: { value: 2, evidence: '2 people', origin: 'MISSING' },
      startDate: calendar('10 October', 10, 10),
      endDate: calendar('12 October', 12, 10),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 October to 12 October for 2 people'),
  );
  assert.equal(missingOrigin.travelerCount, null);
});

test('uncertain scalar alternatives are never certified as exact values', () => {
  const durationAlternative = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 October', 10, 10),
      duration: { value: 3, unit: 'NIGHTS', evidence: '2 or 3 nights' },
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 October for 2 or 3 nights'),
  );
  assert.equal(durationAlternative.endDate, null);
  assert.equal(durationAlternative.minimumViable, false);
  assert.ok(durationAlternative.questions.some(({ id }) => id === 'end-date-required'));

  const travelerAlternative = buildTripCreationDraft(
    extraction({
      travelerCount: { value: 3, evidence: 'either 2 or 3 people', origin: 'USER_EXPLICIT' },
      startDate: calendar('10 October', 10, 10),
      endDate: calendar('12 October', 12, 10),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 October to 12 October for either 2 or 3 people'),
  );
  assert.equal(travelerAlternative.travelerCount, null);
  assert.ok(travelerAlternative.questions.some(({ id }) => id === 'traveler-count-ambiguous'));

  for (const evidence of [
    'not 3 nights',
    'at least 3 nights',
    'up to 3 nights',
    'between 2 and 3 nights',
  ]) {
    const boundedDuration = buildTripCreationDraft(
      extraction({
        startDate: calendar('10 October', 10, 10),
        duration: { value: 3, unit: 'NIGHTS', evidence },
        destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
      }),
      request(`Tokyo from 10 October for ${evidence}`),
    );
    assert.equal(boundedDuration.endDate, null, evidence);
    assert.equal(boundedDuration.minimumViable, false, evidence);

    const croppedEvidence = buildTripCreationDraft(
      extraction({
        startDate: calendar('10 October', 10, 10),
        duration: { value: 3, unit: 'NIGHTS', evidence: '3 nights' },
        destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
      }),
      request(`Tokyo from 10 October for ${evidence}`),
    );
    assert.equal(croppedEvidence.endDate, null, `cropped: ${evidence}`);
    assert.equal(croppedEvidence.minimumViable, false, `cropped: ${evidence}`);
  }

  const chosenDuration = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 October', 10, 10),
      duration: { value: 3, unit: 'NIGHTS', evidence: '3 nights' },
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 October for 3 nights instead of 4'),
  );
  assert.equal(chosenDuration.endDate, '2026-10-13');
});

test('traveler compositions are counted additively from ordinary wording', () => {
  const cases = [
    ['me and my partner and 2 kids', 4],
    ['a couple with two kids', 4],
    ['2 adults and 3 children and me', 6],
    ['my partner and 2 kids', 3],
    ['I am booking for 2 people', 2],
    ['I need a trip for 2 adults and 2 kids', 4],
    ['I am one of 2 people', 2],
    ['2 people including me', 2],
    ['a family of 2 adults and 2 kids', 4],
    ['a family of two adults and one child', 3],
    ['a family of 4 with 2 kids', 4],
    ['2 people including my partner', 2],
    ['my partner is one of 2 people', 2],
    ['I am travelling with my partner', 2],
  ] as const;
  for (const [evidence, count] of cases) {
    const draft = buildTripCreationDraft(
      extraction({
        travelerCount: { value: count, evidence, origin: 'USER_EXPLICIT' },
        startDate: calendar('10 October', 10, 10),
        endDate: calendar('12 October', 12, 10),
        destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
      }),
      request(`Tokyo from 10 October to 12 October with ${evidence}`),
    );
    assert.equal(draft.travelerCount, count, evidence);
  }
});

test('traveler provenance is derived from evidence rather than model origin labels', () => {
  const literal = buildTripCreationDraft(
    extraction({
      travelerCount: { value: 2, evidence: '2 people', origin: 'DETERMINISTIC' },
      startDate: calendar('10 October', 10, 10),
      endDate: calendar('12 October', 12, 10),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 October to 12 October for 2 people'),
  );
  assert.equal(
    literal.fieldStates.find(({ path }) => path === 'trip.travelerCount')?.status,
    'EXPLICIT',
  );

  const inferred = buildTripCreationDraft(
    extraction({
      travelerCount: {
        value: 2,
        evidence: 'me and my partner',
        origin: 'USER_EXPLICIT',
      },
      startDate: calendar('10 October', 10, 10),
      endDate: calendar('12 October', 12, 10),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 October to 12 October for me and my partner'),
  );
  assert.equal(
    inferred.fieldStates.find(({ path }) => path === 'trip.travelerCount')?.status,
    'INTERPRETED',
  );
});

test('invalid boundaries are never replaced by a duration calculation', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('31 April', 31, 4),
      endDate: calendar('5 May', 5, 5),
      duration: { value: 5, unit: 'DAYS', evidence: '5 days' },
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 31 April to 5 May for 5 days'),
  );
  assert.equal(draft.startDate, null);
  assert.equal(draft.minimumViable, false);
  assert.ok(draft.questions.some(({ id }) => id === 'start-date-required'));
});

test('week durations are converted deterministically without treating months as days', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 October', 10, 10),
      duration: { value: 2, unit: 'WEEKS', evidence: 'two weeks' },
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 October for two weeks'),
  );
  assert.equal(draft.startDate, '2026-10-10');
  assert.equal(draft.endDate, '2026-10-23');
  assert.equal(draft.minimumViable, true);
  assert.equal(
    draft.fieldStates.find(({ path }) => path === 'trip.endDate')?.evidence,
    'two weeks',
  );
});

test('AI suggestions and city substrings cannot satisfy the city requirement', () => {
  const suggested = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 October', 10, 10),
      endDate: calendar('12 October', 12, 10),
      destinations: [destination('maybe Tokyo', 'Tokyo', 'CITY', { origin: 'AI_SUGGESTED' })],
    }),
    request('Maybe Tokyo from 10 October to 12 October'),
  );
  assert.equal(suggested.minimumViable, false);

  const substring = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 October', 10, 10),
      endDate: calendar('12 October', 12, 10),
      destinations: [destination('Birmingham', 'Ham', 'CITY')],
    }),
    request('Birmingham from 10 October to 12 October'),
  );
  assert.equal(substring.minimumViable, false);

  const tentative = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 October', 10, 10),
      endDate: calendar('12 October', 12, 10),
      destinations: [destination('maybe Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Maybe Tokyo from 10 October to 12 October'),
  );
  assert.equal(tentative.minimumViable, false);

  const countryMisclassifiedAsCity = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 October', 10, 10),
      endDate: calendar('12 October', 12, 10),
      destinations: [destination('Japan', 'Japan', 'CITY')],
    }),
    request('Japan from 10 October to 12 October'),
  );
  assert.equal(countryMisclassifiedAsCity.minimumViable, false);
});

test('cropped evidence cannot hide alternatives or a larger place name', () => {
  const alternativeDate = buildTripCreationDraft(
    extraction({
      startDate: calendar('12 May', 12, 5),
      endDate: calendar('15 May', 15, 5),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 or 12 May to 15 May', '2026-01-01'),
  );
  assert.equal(alternativeDate.startDate, null);
  assert.equal(alternativeDate.minimumViable, false);

  const fullAlternativeDate = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 or 12 May', 12, 5),
      endDate: calendar('15 May', 15, 5),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 or 12 May to 15 May', '2026-01-01'),
  );
  assert.equal(fullAlternativeDate.startDate, null);
  assert.equal(fullAlternativeDate.minimumViable, false);

  const relativeAlternative = buildTripCreationDraft(
    extraction({
      startDate: calendar('today or tomorrow', 1, 1, null, 'TODAY'),
      endDate: calendar('today or tomorrow', 1, 1, null, 'TODAY'),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo today or tomorrow'),
  );
  assert.equal(relativeAlternative.startDate, null);
  assert.equal(relativeAlternative.minimumViable, false);

  const alternativeCity = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 May', 10, 5),
      endDate: calendar('15 May', 15, 5),
      destinations: [destination('Paris', 'Paris', 'CITY')],
    }),
    request('Paris or Lyon from 10 May to 15 May', '2026-01-01'),
  );
  assert.equal(alternativeCity.minimumViable, false);

  const placeSubstring = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 May', 10, 5),
      endDate: calendar('15 May', 15, 5),
      destinations: [destination('New York', 'York', 'CITY')],
    }),
    request('New York from 10 May to 15 May', '2026-01-01'),
  );
  assert.equal(placeSubstring.minimumViable, false);

  const croppedPlaceSubstring = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 May', 10, 5),
      endDate: calendar('15 May', 15, 5),
      destinations: [destination('York', 'York', 'CITY')],
    }),
    request('New York from 10 May to 15 May', '2026-01-01'),
  );
  assert.equal(croppedPlaceSubstring.minimumViable, false);

  for (const qualifier of ['after', 'before', 'approximately', 'roughly', 'by']) {
    const qualifiedDate = buildTripCreationDraft(
      extraction({
        startDate: calendar('10 May', 10, 5),
        endDate: calendar('15 May', 15, 5),
        destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
      }),
      request(`Tokyo ${qualifier} 10 May to 15 May`, '2026-01-01'),
    );
    assert.equal(qualifiedDate.startDate, null, qualifier);
    assert.equal(qualifiedDate.minimumViable, false, qualifier);
  }

  const chosenCity = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 May', 10, 5),
      endDate: calendar('15 May', 15, 5),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo instead of Kyoto, 10 May to 15 May', '2026-01-01'),
  );
  assert.equal(chosenCity.minimumViable, true);

  const monthAsCity = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 May', 10, 5),
      endDate: calendar('15 May', 15, 5),
      destinations: [destination('May', 'May', 'CITY')],
    }),
    request('Bristol first. Actually make the dates 10 to 15 May', '2026-01-01'),
  );
  assert.equal(monthAsCity.minimumViable, false);
  assert.notEqual(monthAsCity.stops[0]?.cityResolution, 'RESOLVED');
});

test('city-states still satisfy the city-level destination requirement', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 May', 10, 5),
      endDate: calendar('15 May', 15, 5),
      destinations: [destination('Singapore', 'Singapore', 'CITY')],
    }),
    request('Singapore from 10 May to 15 May', '2026-01-01'),
  );
  assert.equal(draft.minimumViable, true);
  assert.equal(draft.stops[0]?.cityResolution, 'RESOLVED');
});

test('explicit historical dates are permitted and visibly marked', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 May 2025', 10, 5, 2025),
      endDate: calendar('12 May 2025', 12, 5, 2025),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 May 2025 to 12 May 2025'),
  );
  assert.equal(draft.minimumViable, true);
  assert.equal(draft.fieldStates.find(({ path }) => path === 'trip.startDate')?.status, 'PAST');
  assert.ok(draft.warnings.some((warning) => warning.includes('past')));
});

test('hallucinated city evidence cannot satisfy the city-level MVT', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 October', 10, 10),
      endDate: calendar('12 October', 12, 10),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Somewhere warm from 10 October to 12 October'),
  );
  assert.equal(draft.minimumViable, false);
  assert.equal(draft.stops[0]?.cityResolution, 'SUGGESTED');
  assert.ok(draft.questions.some(({ id }) => id === 'city-required'));
});

test('country-level destination and missing dates produce batched questions', () => {
  const draft = buildTripCreationDraft(
    extraction({
      destinations: [destination('Japan', null, 'COUNTRY', {
        candidates: [
          { city: 'Tokyo', context: 'Japan' },
          { city: 'Kyoto', context: 'Japan' },
        ],
      })],
    }),
    request('I want to visit Japan'),
  );
  assert.equal(draft.minimumViable, false);
  assert.deepEqual(
    draft.questions.map(({ id }) => id),
    ['city-required', 'start-date-required', 'end-date-required'],
  );
  assert.equal(draft.questions[0]?.options.length, 2);
});

test('a trip-wide country is kept as the area while specific cities become stops', () => {
  const draft = buildTripCreationDraft(
    extraction({
      destinationArea: {
        value: 'Italy',
        evidence: 'trip to Italy',
        origin: 'USER_EXPLICIT',
      },
      startDate: calendar('28th of Aug 2027', 28, 8, 2027),
      endDate: calendar('5th September 2027', 5, 9, 2027),
      destinations: [
        destination('Italy', 'Italy', 'COUNTRY'),
        destination('Rome', 'Rome', 'CITY'),
        destination('Maiori', 'Maiori', 'CITY'),
        destination('Naples', 'Naples', 'CITY'),
      ],
    }),
    request('Create a trip to Italy from 28th of Aug 2027 to 5th September 2027: Rome, Maiori, and Naples.'),
  );
  assert.equal(draft.destinationArea, 'Italy');
  assert.equal(draft.name, 'Trip to Italy');
  assert.deepEqual(draft.stops.map((stop) => stop.name), ['Rome', 'Maiori', 'Naples']);
  assert.equal(
    draft.fieldStates.find(({ path }) => path === 'trip.destinationArea')?.status,
    'EXPLICIT',
  );
});

test('destination day allocations produce a shared-transfer schedule with visible uncertainty', () => {
  const draft = buildTripCreationDraft(
    extraction({
      destinationArea: {
        value: 'Italy',
        evidence: 'trip to Italy',
        origin: 'USER_EXPLICIT',
      },
      startDate: calendar('28th of Aug 2027', 28, 8, 2027),
      endDate: calendar('5th September 2027', 5, 9, 2027),
      destinations: [
        destination('Rome', 'Rome', 'CITY', {
          stayDuration: { value: 4, unit: 'DAYS', evidence: '4 days in Rome' },
        }),
        destination('Maiori', 'Maiori', 'CITY', {
          stayDuration: { value: 3, unit: 'DAYS', evidence: '3 days in Maiori' },
        }),
        destination('Naples', 'Naples', 'CITY', {
          stayDuration: { value: 3, unit: 'DAYS', evidence: '3 days in Naples' },
        }),
      ],
    }),
    request('Create a trip to Italy from 28th of Aug 2027 to 5th September 2027, 4 days in Rome, 3 days in Maiori, 3 days in Naples.'),
  );
  assert.deepEqual(
    draft.stops.map(({ name, arrivalDate, departureDate }) => ({ name, arrivalDate, departureDate })),
    [
      { name: 'Rome', arrivalDate: '2027-08-28', departureDate: '2027-09-01' },
      { name: 'Maiori', arrivalDate: '2027-09-01', departureDate: '2027-09-03' },
      { name: 'Naples', arrivalDate: '2027-09-03', departureDate: '2027-09-05' },
    ],
  );
  assert.equal(draft.minimumViable, true);
  assert.equal(
    draft.questions.find(({ id }) => id === 'destination-duration-interpretation')?.blocking,
    false,
  );
  assert.ok(draft.assumptions.some((item) => item.includes('share transfer dates')));
});

test('destination night allocations produce exact adjacent stays without a clarification', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('28th of Aug 2027', 28, 8, 2027),
      endDate: calendar('5th September 2027', 5, 9, 2027),
      destinations: [
        destination('Rome', 'Rome', 'CITY', {
          stayDuration: { value: 4, unit: 'NIGHTS', evidence: '4 nights in Rome' },
        }),
        destination('Maiori', 'Maiori', 'CITY', {
          stayDuration: { value: 2, unit: 'NIGHTS', evidence: '2 nights in Maiori' },
        }),
        destination('Naples', 'Naples', 'CITY', {
          stayDuration: { value: 2, unit: 'NIGHTS', evidence: '2 nights in Naples' },
        }),
      ],
    }),
    request('28th of Aug 2027 to 5th September 2027, 4 nights in Rome, 2 nights in Maiori, 2 nights in Naples.'),
  );
  assert.deepEqual(
    draft.stops.map(({ name, arrivalDate, departureDate }) => ({ name, arrivalDate, departureDate })),
    [
      { name: 'Rome', arrivalDate: '2027-08-28', departureDate: '2027-09-01' },
      { name: 'Maiori', arrivalDate: '2027-09-01', departureDate: '2027-09-03' },
      { name: 'Naples', arrivalDate: '2027-09-03', departureDate: '2027-09-05' },
    ],
  );
  assert.equal(
    draft.questions.some(({ id }) => id === 'destination-duration-interpretation'),
    false,
  );
  assert.ok(draft.assumptions.some((item) => item.includes('without overlapping a night')));
});

test('trip boundary autofill is reflected in destination field provenance', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 October', 10, 10),
      endDate: calendar('12 October', 12, 10),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('Tokyo from 10 October to 12 October'),
  );
  assert.equal(draft.stops[0]?.arrivalDate, '2026-10-10');
  assert.equal(draft.stops[0]?.departureDate, '2026-10-12');
  assert.equal(draft.fieldStates.find(({ path }) => path === 'stops.0.arrivalDate')?.status, 'INTERPRETED');
  assert.equal(draft.fieldStates.find(({ path }) => path === 'stops.0.departureDate')?.status, 'INTERPRETED');
});

test('invalid or inconsistent destination dates are not overwritten by trip boundaries', () => {
  const invalid = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 May', 10, 5),
      endDate: calendar('15 May', 15, 5),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY', {
        arrivalDate: calendar('31 April', 31, 4),
        departureDate: calendar('16 May', 16, 5),
      })],
    }),
    request('Tokyo from 10 May to 15 May, arriving 31 April and leaving 16 May', '2026-01-01'),
  );
  assert.equal(invalid.stops[0]?.arrivalDate, null);
  assert.equal(invalid.stops[0]?.departureDate, null);
  assert.equal(
    invalid.fieldStates.find(({ path }) => path === 'stops.0.arrivalDate')?.status,
    'INVALID',
  );
  assert.ok(invalid.questions.some(({ id }) => id === 'destination-1-arrival-date'));

  const inconsistentMissing: DateIntent = {
    sourceText: '31 April',
    kind: 'MISSING',
    day: null,
    month: null,
    year: null,
  };
  const inconsistent = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 May', 10, 5),
      endDate: calendar('15 May', 15, 5),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY', {
        arrivalDate: inconsistentMissing,
        departureDate: { ...inconsistentMissing, sourceText: '32 May' },
      })],
    }),
    request('Tokyo from 10 May to 15 May, arriving 31 April and leaving 32 May', '2026-01-01'),
  );
  assert.equal(inconsistent.stops[0]?.arrivalDate, null);
  assert.equal(inconsistent.stops[0]?.departureDate, null);
  assert.equal(
    inconsistent.fieldStates.find(({ path }) => path === 'stops.0.arrivalDate')?.status,
    'NEEDS_ATTENTION',
  );
});

test('yearless destination dates are anchored inside a far-future trip range', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 October 2028', 10, 10, 2028),
      endDate: calendar('20 October 2028', 20, 10, 2028),
      destinations: [destination('Kyoto', 'Kyoto', 'CITY', {
        arrivalDate: calendar('12 October', 12, 10),
        departureDate: calendar('14 October', 14, 10),
      })],
    }),
    request('Kyoto from 12 October to 14 October, trip 10 October 2028 to 20 October 2028'),
  );
  assert.equal(draft.stops[0]?.arrivalDate, '2028-10-12');
  assert.equal(draft.stops[0]?.departureDate, '2028-10-14');
});

test('yearless destination dates anchor across December and January', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('28 December 2028', 28, 12, 2028),
      endDate: calendar('3 January 2029', 3, 1, 2029),
      destinations: [destination('Reykjavik', 'Reykjavik', 'CITY', {
        arrivalDate: calendar('29 December', 29, 12),
        departureDate: calendar('2 January', 2, 1),
      })],
    }),
    request('Reykjavik 29 December to 2 January, trip 28 December 2028 to 3 January 2029'),
  );
  assert.equal(draft.stops[0]?.arrivalDate, '2028-12-29');
  assert.equal(draft.stops[0]?.departureDate, '2029-01-02');
});

test('reversed destination dates are cleared before persistence', () => {
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 October', 10, 10),
      endDate: calendar('20 October', 20, 10),
      destinations: [destination('Tokyo', 'Tokyo', 'CITY', {
        arrivalDate: calendar('18 October', 18, 10),
        departureDate: calendar('12 October', 12, 10),
      })],
    }),
    request('Tokyo from 10 October to 20 October, arriving 18 October and leaving 12 October'),
  );
  assert.equal(draft.stops[0]?.arrivalDate, null);
  assert.equal(draft.stops[0]?.departureDate, null);
  assert.equal(draft.minimumViable, true);
  assert.ok(draft.questions.some(({ id }) => id === 'destination-1-date-conflict'));
});

test('large drafts keep blocking clarifications while bounding optional questions', () => {
  const destinations = Array.from({ length: 20 }, (_, index) => destination(
    `City ${index + 1}`,
    `City ${index + 1}`,
    'CITY',
    {
      arrivalDate: calendar('18 October', 18, 10),
      departureDate: calendar('12 October', 12, 10),
    },
  ));
  const prompt = `${destinations.map(({ sourceText }) => sourceText).join(', ')} from 10 October to 20 October, each arriving 18 October and leaving 12 October`;
  const draft = buildTripCreationDraft(
    extraction({
      startDate: calendar('10 October', 10, 10),
      endDate: calendar('20 October', 20, 10),
      destinations,
    }),
    request(prompt),
  );
  assert.equal(draft.questions.length, 12);
  assert.ok(draft.warnings.some((warning) => warning.includes('optional destination-date questions')));
});

test('a duration-derived historical boundary remains blocking', () => {
  const draft = buildTripCreationDraft(
    extraction({
      endDate: calendar('5 September 2026', 5, 9, 2026),
      duration: { value: 10, unit: 'DAYS', evidence: '10 days' },
      destinations: [destination('Tokyo', 'Tokyo', 'CITY')],
    }),
    request('10 days in Tokyo ending 5 September 2026'),
  );
  assert.equal(draft.startDate, null);
  assert.equal(draft.minimumViable, false);
  assert.ok(draft.questions.some(({ id }) => id === 'start-date-required'));
});
