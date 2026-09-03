import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  activityDateTimeForStop,
  alignIncomingTripDraftStops,
  applyClarificationUpdates,
  appendTripStop,
  buildTripFollowUpPrompt,
  clarificationPathsConfirmedByEdit,
  confirmedTripDraftFieldState,
  dateTimeLocalToIso,
  dateTimeLocalToIsoPreserving,
  destinationAreaFromStops,
  draftToTripInput,
  explicitTripDraftPathsFromFollowUp,
  formatDateRange,
  graphqlRequest,
  isTripMinimumViable,
  isoToDateTimeLocal,
  mergeTripDraft,
  mergeUnansweredClarificationQuestions,
  operations,
  protectedPathsAfterFollowUp,
  remapCurrentTripDraftPathToIncoming,
  remapDirtyTripDraftPaths,
  remapTripDraftPathAfterStopRemoval,
  removeTripStop,
  sortStopsByDate,
  stayDateTimesForStop,
  transportDateTimesForStops,
  tripDraftFieldStateMap,
  tripStopsForCreation,
  TripDockGraphQLError,
  updateTripBoundaryDate,
  updateTripStopDate,
  type TripClarificationQuestion,
  type TripDraft,
  type TripInput,
  type TripStop,
} from '../lib/graphql-client.ts';

const draftMetadata = {
  fieldStates: [],
  questions: [],
  minimumViable: false,
  referenceDate: '2026-09-03',
  locale: 'en-GB',
  timeZone: 'Europe/London',
} satisfies Pick<TripDraft, 'fieldStates' | 'questions' | 'minimumViable' | 'referenceDate' | 'locale' | 'timeZone'>;

function tripInput(overrides: Partial<TripInput> = {}): TripInput {
  return {
    name: 'Coastal week',
    destinationArea: 'Atlantic coast',
    startDate: '',
    endDate: '',
    travelerCount: 2,
    stops: [{
      name: 'Harbor town',
      locationText: null,
      arrivalDate: null,
      departureDate: null,
    }],
    ...overrides,
  };
}

function tripDraft(overrides: Partial<TripDraft> = {}): TripDraft {
  return {
    name: 'Trip to Porto',
    destinationArea: 'Porto',
    startDate: '2028-04-02',
    endDate: '2028-04-11',
    travelerCount: null,
    stops: [{
      draftId: 'destination-1',
      name: 'Porto',
      locationText: 'Portugal',
      arrivalDate: '2028-04-02',
      departureDate: '2028-04-11',
      localityKind: 'CITY',
      cityResolution: 'RESOLVED',
    }],
    assumptions: [],
    warnings: [],
    ...draftMetadata,
    minimumViable: true,
    ...overrides,
  };
}

test('add-stop operation declares and forwards optional trip-end movement intent', () => {
  assert.match(operations.addStop, /\$moveTripEnd: Boolean/);
  assert.match(operations.addStop, /moveTripEnd: \$moveTripEnd/);
});

test('GraphQL client preserves a genuine empty trips result', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ data: { trips: [] } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
  try {
    const data = await graphqlRequest<{ trips: unknown[] }, Record<string, never>>(
      'query { trips { id } }',
      {},
    );
    assert.deepEqual(data.trips, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GraphQL client surfaces the server error code and details', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    errors: [{
      message: 'The trip changed while this form was open.',
      extensions: { code: 'REVISION_CONFLICT', currentRevision: 4 },
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(
      graphqlRequest('mutation { updateTrip }', {}),
      (error: unknown) => {
        assert.ok(error instanceof TripDockGraphQLError);
        assert.equal(error.code, 'REVISION_CONFLICT');
        assert.equal(error.details.currentRevision, 4);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI drafts map to editable, still-unpersisted trip inputs', () => {
  const draft: TripDraft = {
    name: 'Coastal week',
    destinationArea: 'Atlantic coast',
    startDate: null,
    endDate: null,
    travelerCount: null,
    stops: [{
      name: 'Harbor town',
      locationText: null,
      arrivalDate: null,
      departureDate: null,
    }],
    assumptions: ['Dates are still open.'],
    warnings: [],
    ...draftMetadata,
  };
  const input = draftToTripInput(draft);
  assert.deepEqual(input, {
    name: 'Coastal week',
    destinationArea: 'Atlantic coast',
    startDate: '',
    endDate: '',
    travelerCount: null,
    stops: draft.stops,
  });
  assert.notEqual(input.stops, draft.stops);
});

test('AI draft trip boundaries and first/last destination dates fall back to each other', () => {
  const fromTripDates = draftToTripInput({
    name: 'Two cities',
    destinationArea: 'Portugal',
    startDate: '2028-04-02',
    endDate: '2028-04-11',
    travelerCount: 2,
    stops: [
      { name: 'Porto', locationText: null, arrivalDate: null, departureDate: '2028-04-06' },
      { name: 'Lisbon', locationText: null, arrivalDate: '2028-04-06', departureDate: null },
    ],
    assumptions: [],
    warnings: [],
    ...draftMetadata,
  });
  assert.equal(fromTripDates.stops[0]?.arrivalDate, '2028-04-02');
  assert.equal(fromTripDates.stops[1]?.departureDate, '2028-04-11');

  const fromStopDates = draftToTripInput({
    name: 'Two cities',
    destinationArea: 'Portugal',
    startDate: null,
    endDate: null,
    travelerCount: 2,
    stops: [
      { name: 'Porto', locationText: null, arrivalDate: '2028-04-02', departureDate: '2028-04-06' },
      { name: 'Lisbon', locationText: null, arrivalDate: '2028-04-06', departureDate: '2028-04-11' },
    ],
    assumptions: [],
    warnings: [],
    ...draftMetadata,
  });
  assert.equal(fromStopDates.startDate, '2028-04-02');
  assert.equal(fromStopDates.endDate, '2028-04-11');

  const invalidStopDates = draftToTripInput(tripDraft({
    stops: [{
      name: 'Porto',
      locationText: null,
      arrivalDate: null,
      departureDate: null,
      localityKind: 'CITY',
      cityResolution: 'RESOLVED',
    }],
    fieldStates: [
      { path: 'stops.0.arrivalDate', status: 'INVALID', evidence: '31 April', message: 'Not a real date.', blocking: false },
      { path: 'stops.0.departureDate', status: 'NEEDS_ATTENTION', evidence: 'sometime', message: 'Needs a date.', blocking: false },
    ],
  }));
  assert.equal(invalidStopDates.stops[0]?.arrivalDate, null);
  assert.equal(invalidStopDates.stops[0]?.departureDate, null);
});

test('minimum viability requires a resolved city and valid trip dates, not travelers', () => {
  const ready = draftToTripInput(tripDraft());
  assert.equal(isTripMinimumViable(ready), true);
  assert.equal(isTripMinimumViable({ ...ready, travelerCount: null }), true);
  assert.equal(isTripMinimumViable({ ...ready, endDate: '' }), false);
  assert.equal(isTripMinimumViable({
    ...ready,
    stops: [{ ...ready.stops[0]!, cityResolution: 'SUGGESTED' }],
  }), false);
  assert.equal(isTripMinimumViable({
    ...ready,
    stops: [{ ...ready.stops[0]!, localityKind: 'COUNTRY', cityResolution: 'RESOLVED' }],
  }), false);
  assert.equal(isTripMinimumViable({
    ...ready,
    stops: [{ ...ready.stops[0]!, localityKind: 'REGION', cityResolution: 'RESOLVED' }],
  }), false);
  assert.equal(isTripMinimumViable({
    ...ready,
    stops: [{ ...ready.stops[0]!, arrivalDate: '2028-03-31' }],
  }), false);
  assert.equal(isTripMinimumViable(ready, new Map(), [{
    id: 'conflict',
    fieldPaths: ['trip.startDate', 'trip.endDate'],
    prompt: 'Which dates?',
    options: [],
    allowFreeText: true,
    blocking: true,
  }]), false);
});

test('batched clarification updates can confirm city and weekend fields atomically', () => {
  const pending = tripInput({
    startDate: '',
    endDate: '',
    travelerCount: null,
    stops: [{
      name: 'Porto',
      locationText: 'Portugal',
      arrivalDate: null,
      departureDate: null,
      localityKind: 'COUNTRY',
      cityResolution: 'SUGGESTED',
    }],
  });
  const updated = applyClarificationUpdates(pending, [
    { path: 'stops.0.name', value: 'Lisbon' },
    { path: 'stops.0.locationText', value: 'Portugal' },
    { path: 'stops.0.localityKind', value: 'CITY' },
    { path: 'stops.0.cityResolution', value: 'RESOLVED' },
    { path: 'trip.startDate', value: '2028-04-05' },
    { path: 'trip.endDate', value: '2028-04-06' },
  ]);
  const states = tripDraftFieldStateMap([
    { path: 'stops.0.name', status: 'CONFIRMED', evidence: null, message: null, blocking: false },
    { path: 'trip.startDate', status: 'CONFIRMED', evidence: null, message: null, blocking: false },
    { path: 'trip.endDate', status: 'CONFIRMED', evidence: null, message: null, blocking: false },
  ]);
  assert.equal(updated.stops[0]?.name, 'Lisbon');
  assert.equal(updated.stops[0]?.cityResolution, 'RESOLVED');
  assert.equal(updated.stops[0]?.arrivalDate, '2028-04-05');
  assert.equal(updated.stops[0]?.departureDate, '2028-04-06');
  assert.equal(isTripMinimumViable(updated, states), true);
});

test('confirmed historical dates retain a visible, nonblocking past-date state', () => {
  const previous = {
    path: 'trip.startDate',
    status: 'CONFLICTING' as const,
    evidence: '2 April 2020',
    message: 'Conflicting date',
    blocking: true,
  };
  assert.deepEqual(
    confirmedTripDraftFieldState('trip.startDate', '2020-04-02', previous, '2026-09-03'),
    {
      path: 'trip.startDate',
      status: 'PAST',
      evidence: '2 April 2020',
      message: 'This confirmed date is in the past.',
      blocking: false,
    },
  );
  assert.equal(
    confirmedTripDraftFieldState('stops.0.departureDate', '2028-04-02', undefined, '2026-09-03').status,
    'CONFIRMED',
  );
});

test('editing either boundary confirms a valid displayed pair for a blocking date conflict', () => {
  const conflict = [{
    id: 'date-conflict',
    fieldPaths: ['trip.startDate', 'trip.endDate'],
    prompt: 'Which date range is right?',
    options: [],
    allowFreeText: true,
    blocking: true,
  }];
  assert.deepEqual(
    clarificationPathsConfirmedByEdit(
      'trip.endDate',
      { startDate: '2028-04-02', endDate: '2028-04-11' },
      conflict,
    ),
    ['trip.startDate', 'trip.endDate'],
  );
  assert.deepEqual(
    clarificationPathsConfirmedByEdit(
      'trip.endDate',
      { startDate: '2028-04-12', endDate: '2028-04-11' },
      conflict,
    ),
    ['trip.endDate'],
  );
});

test('AI creation persists only resolved cities and links surviving boundary stops', () => {
  const stops = tripStopsForCreation(tripInput({
    startDate: '2028-04-02',
    endDate: '2028-04-11',
    stops: [
      {
        name: 'Japan',
        locationText: null,
        arrivalDate: null,
        departureDate: null,
        localityKind: 'COUNTRY',
        cityResolution: 'RESOLVED',
      },
      {
        name: 'Osaka',
        locationText: 'Japan',
        arrivalDate: null,
        departureDate: null,
        localityKind: 'CITY',
        cityResolution: 'SUGGESTED',
      },
      {
        name: ' Tokyo ',
        locationText: 'Japan',
        arrivalDate: null,
        departureDate: '2028-04-06',
        localityKind: 'CITY',
        cityResolution: 'RESOLVED',
      },
      {
        name: 'Kyoto',
        locationText: 'Japan',
        arrivalDate: '2028-04-06',
        departureDate: null,
        localityKind: 'CITY',
        cityResolution: 'RESOLVED',
      },
    ],
  }));
  assert.deepEqual(stops.map((stop) => stop.name), ['Tokyo', 'Kyoto']);
  assert.equal(stops[0]?.arrivalDate, '2028-04-02');
  assert.equal(stops[0]?.departureDate, '2028-04-06');
  assert.equal(stops[1]?.arrivalDate, '2028-04-06');
  assert.equal(stops[1]?.departureDate, '2028-04-11');

  const invalidBoundaryState = tripDraftFieldStateMap([{
    path: 'stops.0.arrivalDate',
    status: 'INVALID',
    evidence: '31 April',
    message: 'Not a real date.',
    blocking: false,
  }]);
  const preservedBlank = tripStopsForCreation(tripInput({
    startDate: '2028-04-02',
    endDate: '2028-04-11',
    stops: [{
      name: 'Tokyo',
      locationText: 'Japan',
      arrivalDate: null,
      departureDate: '2028-04-11',
      localityKind: 'CITY',
      cityResolution: 'RESOLVED',
    }],
  }), invalidBoundaryState);
  assert.equal(preservedBlank[0]?.arrivalDate, null);
});

test('follow-up draft merging preserves manually confirmed fields', () => {
  const current = tripInput({
    name: 'My own title',
    startDate: '2028-04-02',
    endDate: '2028-04-11',
    travelerCount: null,
    stops: [{
      name: 'Bristol',
      locationText: 'United Kingdom',
      arrivalDate: '2028-04-02',
      departureDate: '2028-04-11',
      localityKind: 'CITY',
      cityResolution: 'RESOLVED',
    }],
  });
  const incoming = tripDraft({
    name: 'Trip to Porto',
    startDate: '2028-05-01',
    endDate: '2028-05-05',
  });
  const merged = mergeTripDraft(current, incoming, new Set([
    'trip.name',
    'stops.0.name',
    'stops.0.locationText',
    'stops.0.localityKind',
    'stops.0.cityResolution',
  ]));
  assert.equal(merged.name, 'My own title');
  assert.equal(merged.stops[0]?.name, 'Bristol');
  assert.equal(merged.startDate, '2028-05-01');
});

test('follow-up destinations are aligned by unique city name before protected merging', () => {
  const current = tripInput({
    startDate: '2028-04-02',
    endDate: '2028-04-11',
    stops: [
      {
        draftId: 'destination-1',
        name: 'Tokyo',
        locationText: 'Japan',
        arrivalDate: '2028-04-02',
        departureDate: null,
        localityKind: 'CITY',
        cityResolution: 'RESOLVED',
      },
      {
        draftId: 'destination-2',
        name: 'Kyoto',
        locationText: 'Japan',
        arrivalDate: null,
        departureDate: '2028-04-11',
        localityKind: 'CITY',
        cityResolution: 'RESOLVED',
      },
    ],
  });
  const incoming = tripDraft({
    stops: [
      {
        draftId: 'destination-1',
        name: 'Kyoto',
        locationText: 'Japan',
        arrivalDate: '2028-04-07',
        departureDate: '2028-04-11',
        localityKind: 'CITY',
        cityResolution: 'RESOLVED',
      },
      {
        draftId: 'destination-2',
        name: 'Tokyo',
        locationText: 'Japan',
        arrivalDate: '2028-04-02',
        departureDate: '2028-04-07',
        localityKind: 'CITY',
        cityResolution: 'RESOLVED',
      },
    ],
    fieldStates: [
      {
        path: 'trip.name',
        status: 'SUGGESTED',
        evidence: null,
        message: null,
        blocking: false,
      },
      {
        path: 'stops.0.arrivalDate',
        status: 'EXPLICIT',
        evidence: '7 April',
        message: null,
        blocking: false,
      },
    ],
    questions: [{
      id: 'kyoto-end',
      fieldPaths: ['stops.0.departureDate'],
      prompt: 'When do you leave Kyoto?',
      options: [{
        id: 'eleventh',
        label: '11 April',
        updates: [{ path: 'stops.0.departureDate', value: '2028-04-11' }],
      }],
      allowFreeText: true,
      blocking: false,
    }],
  });

  const aligned = alignIncomingTripDraftStops(current, incoming);
  assert.deepEqual(aligned.stops.map((stop) => stop.name), ['Tokyo', 'Kyoto']);
  assert.deepEqual(aligned.stops.map((stop) => stop.draftId), ['destination-1', 'destination-2']);
  assert.equal(aligned.name, 'Trip to Tokyo');
  assert.equal(aligned.fieldStates[1]?.path, 'stops.1.arrivalDate');
  assert.deepEqual(aligned.questions[0]?.fieldPaths, ['stops.1.departureDate']);
  assert.equal(aligned.questions[0]?.options[0]?.updates[0]?.path, 'stops.1.departureDate');

  const merged = mergeTripDraft(current, aligned, new Set([
    'stops.0.name',
    'stops.1.name',
  ]));
  assert.equal(merged.stops[0]?.name, 'Tokyo');
  assert.equal(merged.stops[0]?.departureDate, '2028-04-07');
  assert.equal(merged.stops[1]?.name, 'Kyoto');
  assert.equal(merged.stops[1]?.arrivalDate, '2028-04-07');
});

test('an explicit destination reorder honors the order named in the latest reply', () => {
  const current = tripInput({
    stops: [
      { draftId: 'tokyo', name: 'Tokyo', locationText: 'Japan', arrivalDate: '2028-04-02', departureDate: '2028-04-05', localityKind: 'CITY', cityResolution: 'RESOLVED' },
      { draftId: 'osaka', name: 'Osaka', locationText: 'Japan', arrivalDate: '2028-04-05', departureDate: '2028-04-08', localityKind: 'CITY', cityResolution: 'RESOLVED' },
      { draftId: 'kyoto', name: 'Kyoto', locationText: 'Japan', arrivalDate: '2028-04-08', departureDate: '2028-04-11', localityKind: 'CITY', cityResolution: 'RESOLVED' },
    ],
  });
  const incoming = tripDraft({
    stops: [
      { draftId: 'destination-1', name: 'Kyoto', locationText: 'Japan', arrivalDate: '2028-04-02', departureDate: '2028-04-05', localityKind: 'CITY', cityResolution: 'RESOLVED' },
      { draftId: 'destination-2', name: 'Osaka', locationText: 'Japan', arrivalDate: '2028-04-05', departureDate: '2028-04-08', localityKind: 'CITY', cityResolution: 'RESOLVED' },
      { draftId: 'destination-3', name: 'Tokyo', locationText: 'Japan', arrivalDate: '2028-04-08', departureDate: '2028-04-11', localityKind: 'CITY', cityResolution: 'RESOLVED' },
    ],
  });

  const aligned = alignIncomingTripDraftStops(
    current,
    incoming,
    'Actually visit Kyoto, then Osaka, then Tokyo',
  );

  assert.deepEqual(aligned.stops.map((stop) => stop.name), ['Kyoto', 'Osaka', 'Tokyo']);
  assert.deepEqual(aligned.stops.map((stop) => stop.draftId), ['kyoto', 'osaka', 'tokyo']);
  assert.equal(
    remapCurrentTripDraftPathToIncoming(current, aligned, 'stops.0.name'),
    'stops.2.name',
  );
});

test('before and after phrasing can explicitly reorder destinations', () => {
  const current = tripInput({
    stops: [
      { draftId: 'tokyo', name: 'Tokyo', locationText: 'Japan', arrivalDate: '2028-04-02', departureDate: '2028-04-06', localityKind: 'CITY', cityResolution: 'RESOLVED' },
      { draftId: 'kyoto', name: 'Kyoto', locationText: 'Japan', arrivalDate: '2028-04-06', departureDate: '2028-04-11', localityKind: 'CITY', cityResolution: 'RESOLVED' },
    ],
  });
  const incoming = tripDraft({
    stops: [
      { draftId: 'destination-1', name: 'Kyoto', locationText: 'Japan', arrivalDate: '2028-04-02', departureDate: '2028-04-06', localityKind: 'CITY', cityResolution: 'RESOLVED' },
      { draftId: 'destination-2', name: 'Tokyo', locationText: 'Japan', arrivalDate: '2028-04-06', departureDate: '2028-04-11', localityKind: 'CITY', cityResolution: 'RESOLVED' },
    ],
  });

  for (const answer of ['Put Tokyo after Kyoto', 'Put Kyoto before Tokyo']) {
    const aligned = alignIncomingTripDraftStops(current, incoming, answer);
    assert.deepEqual(aligned.stops.map((stop) => stop.name), ['Kyoto', 'Tokyo'], answer);
  }
});

test('an inserted destination keeps every city paired with its own dates and paths', () => {
  const current = tripInput({
    stops: [
      {
        draftId: 'destination-1',
        name: 'Tokyo',
        locationText: 'Japan',
        arrivalDate: '2028-04-02',
        departureDate: '2028-04-06',
        localityKind: 'CITY',
        cityResolution: 'RESOLVED',
      },
      {
        draftId: 'destination-2',
        name: 'Kyoto',
        locationText: 'Japan',
        arrivalDate: '2028-04-08',
        departureDate: '2028-04-11',
        localityKind: 'CITY',
        cityResolution: 'RESOLVED',
      },
    ],
  });
  const incoming = tripDraft({
    stops: [
      {
        draftId: 'destination-1',
        name: 'Tokyo',
        locationText: 'Japan',
        arrivalDate: '2028-04-02',
        departureDate: '2028-04-06',
        localityKind: 'CITY',
        cityResolution: 'RESOLVED',
      },
      {
        draftId: 'destination-2',
        name: 'Osaka',
        locationText: 'Japan',
        arrivalDate: '2028-04-06',
        departureDate: '2028-04-08',
        localityKind: 'CITY',
        cityResolution: 'RESOLVED',
      },
      {
        draftId: 'destination-3',
        name: 'Kyoto',
        locationText: 'Japan',
        arrivalDate: '2028-04-08',
        departureDate: '2028-04-11',
        localityKind: 'CITY',
        cityResolution: 'RESOLVED',
      },
    ],
    fieldStates: [{
      path: 'stops.2.arrivalDate',
      status: 'EXPLICIT',
      evidence: '8 April',
      message: null,
      blocking: false,
    }],
  });

  const aligned = alignIncomingTripDraftStops(current, incoming, 'Add Osaka between them');
  assert.deepEqual(aligned.stops.map((stop) => stop.name), ['Tokyo', 'Osaka', 'Kyoto']);
  assert.equal(aligned.fieldStates[0]?.path, 'stops.2.arrivalDate');
  assert.equal(
    remapCurrentTripDraftPathToIncoming(current, aligned, 'stops.1.name'),
    'stops.2.name',
  );
  const merged = mergeTripDraft(current, aligned, new Set([
    'stops.0.name',
    'stops.2.name',
  ]));
  assert.deepEqual(
    merged.stops.map((stop) => [stop.name, stop.arrivalDate, stop.departureDate]),
    [
      ['Tokyo', '2028-04-02', '2028-04-06'],
      ['Osaka', '2028-04-06', '2028-04-08'],
      ['Kyoto', '2028-04-08', '2028-04-11'],
    ],
  );
});

test('an explicit middle-destination removal remaps survivors without restoring the removed city', () => {
  const current = tripInput({
    stops: [
      { name: 'Tokyo', locationText: 'Japan', arrivalDate: '2028-04-02', departureDate: '2028-04-05', localityKind: 'CITY', cityResolution: 'RESOLVED' },
      { name: 'Osaka', locationText: 'Japan', arrivalDate: '2028-04-05', departureDate: '2028-04-08', localityKind: 'CITY', cityResolution: 'RESOLVED' },
      { name: 'Kyoto', locationText: 'Japan', arrivalDate: '2028-04-08', departureDate: '2028-04-11', localityKind: 'CITY', cityResolution: 'RESOLVED' },
    ],
  });
  const incoming = tripDraft({
    stops: [
      { name: 'Tokyo', locationText: 'Japan', arrivalDate: '2028-04-02', departureDate: '2028-04-08', localityKind: 'CITY', cityResolution: 'RESOLVED' },
      { name: 'Kyoto', locationText: 'Japan', arrivalDate: '2028-04-08', departureDate: '2028-04-11', localityKind: 'CITY', cityResolution: 'RESOLVED' },
    ],
  });

  const aligned = alignIncomingTripDraftStops(current, incoming, 'Remove Osaka');
  assert.deepEqual(aligned.stops.map((stop) => stop.name), ['Tokyo', 'Kyoto']);
  assert.equal(
    remapCurrentTripDraftPathToIncoming(current, aligned, 'stops.1.name', 'Remove Osaka'),
    null,
  );
  assert.equal(
    remapCurrentTripDraftPathToIncoming(current, aligned, 'stops.2.name', 'Remove Osaka'),
    'stops.1.name',
  );
  const merged = mergeTripDraft(current, aligned, new Set(['stops.0.name', 'stops.1.name']));
  assert.deepEqual(merged.stops.map((stop) => stop.name), ['Tokyo', 'Kyoto']);
  assert.equal(merged.stops[1]?.arrivalDate, '2028-04-08');
});

test('negated or unrelated wording cannot delete an omitted protected destination', () => {
  const current = tripInput({
    stops: [
      { name: 'Tokyo', locationText: 'Japan', arrivalDate: null, departureDate: null, localityKind: 'CITY', cityResolution: 'RESOLVED' },
      { name: 'Osaka', locationText: 'Japan', arrivalDate: null, departureDate: null, localityKind: 'CITY', cityResolution: 'RESOLVED' },
    ],
  });
  const incoming = tripDraft({
    stops: [{ name: 'Tokyo', locationText: 'Japan', arrivalDate: null, departureDate: null, localityKind: 'CITY', cityResolution: 'RESOLVED' }],
  });
  for (const answer of [
    'Change dates for Osaka to next week',
    'Do not remove Osaka',
    "Don't remove Osaka",
    'Without changing Osaka, move the dates',
  ]) {
    const aligned = alignIncomingTripDraftStops(current, incoming, answer);
    assert.deepEqual(aligned.stops.map((stop) => stop.name), ['Tokyo', 'Osaka'], answer);
  }
});

test('follow-up prompts include confirmed values but exclude unconfirmed suggestions', () => {
  const current = tripInput({
    stops: [{
      name: 'Suggested Tokyo',
      locationText: null,
      arrivalDate: null,
      departureDate: null,
      localityKind: 'CITY',
      cityResolution: 'SUGGESTED',
    }],
  });
  const withoutConfirmation = buildTripFollowUpPrompt(
    'Somewhere warm',
    current,
    [],
    'Make it next weekend',
  );
  assert.doesNotMatch(withoutConfirmation, /Suggested Tokyo/);
  const withConfirmation = buildTripFollowUpPrompt(
    'Somewhere warm',
    current,
    [],
    'Make it next weekend',
    new Set(['stops.0.name']),
  );
  assert.match(withConfirmation, /Suggested Tokyo/);
});

test('an explicit latest follow-up can replace a previously protected field', () => {
  const incoming = tripDraft({
    stops: [{
      draftId: 'destination-1',
      name: 'Paris',
      locationText: 'France',
      arrivalDate: '2028-04-02',
      departureDate: '2028-04-11',
      localityKind: 'CITY',
      cityResolution: 'RESOLVED',
    }],
    fieldStates: [{
      path: 'stops.0.name',
      status: 'EXPLICIT',
      evidence: 'Paris',
      message: null,
      blocking: false,
    }],
  });
  const remaining = protectedPathsAfterFollowUp(
    new Set(['stops.0.name', 'stops.0.localityKind', 'stops.0.cityResolution']),
    incoming,
    'Actually, make it Paris',
  );
  assert.equal(remaining.has('stops.0.name'), false);
  assert.equal(remaining.has('stops.0.cityResolution'), false);
});

test('an explicit numeric correction releases only the date with matching evidence', () => {
  const incoming = tripDraft({
    fieldStates: [
      {
        path: 'trip.startDate',
        status: 'EXPLICIT',
        evidence: '15/05',
        message: null,
        blocking: false,
      },
      {
        path: 'trip.endDate',
        status: 'EXPLICIT',
        evidence: '20/05',
        message: null,
        blocking: false,
      },
    ],
  });
  const remaining = protectedPathsAfterFollowUp(
    new Set(['trip.startDate', 'trip.endDate']),
    incoming,
    'Change it to 15/05',
  );
  assert.equal(remaining.has('trip.startDate'), false);
  assert.equal(remaining.has('trip.endDate'), true);
});

test('a directional end-date correction cannot release a stable start with duplicated evidence', () => {
  const incoming = tripDraft({
    fieldStates: [
      {
        path: 'trip.startDate',
        status: 'EXPLICIT',
        evidence: '12 June',
        message: null,
        blocking: false,
      },
      {
        path: 'trip.endDate',
        status: 'EXPLICIT',
        evidence: '12 June',
        message: null,
        blocking: false,
      },
    ],
  });
  const remaining = protectedPathsAfterFollowUp(
    new Set(['trip.startDate', 'trip.endDate']),
    incoming,
    'Actually, end on 12 June',
  );
  assert.equal(remaining.has('trip.startDate'), true);
  assert.equal(remaining.has('trip.endDate'), false);
});

test('common city-correction phrases release a protected destination with matching evidence', () => {
  const incoming = tripDraft({
    stops: [{
      draftId: 'destination-1',
      name: 'Osaka',
      locationText: 'Japan',
      arrivalDate: '2028-04-02',
      departureDate: '2028-04-11',
      localityKind: 'CITY',
      cityResolution: 'RESOLVED',
    }],
    fieldStates: [{
      path: 'stops.0.name',
      status: 'EXPLICIT',
      evidence: 'Osaka',
      message: null,
      blocking: false,
    }],
  });
  for (const answer of [
    'Change Kyoto to Osaka',
    'Replace Kyoto with Osaka',
    'Swap Kyoto for Osaka',
    'We are going to Osaka',
  ]) {
    const remaining = protectedPathsAfterFollowUp(
      new Set([
        'stops.0.name',
        'stops.0.locationText',
        'stops.0.localityKind',
        'stops.0.cityResolution',
      ]),
      incoming,
      answer,
    );
    assert.equal(remaining.has('stops.0.name'), false, answer);
    assert.equal(remaining.has('stops.0.locationText'), false, answer);
    assert.equal(remaining.has('stops.0.cityResolution'), false, answer);
  }
});

test('terse and direct open-question city answers replace rather than append', () => {
  const current = tripInput({
    stops: [{
      draftId: 'destination-1',
      name: 'Tokyo',
      locationText: 'Japan',
      arrivalDate: '2028-04-02',
      departureDate: '2028-04-11',
      localityKind: 'CITY',
      cityResolution: 'RESOLVED',
    }],
  });
  const incoming = tripDraft({
    stops: [{
      draftId: 'destination-1',
      name: 'Osaka',
      locationText: 'Japan',
      arrivalDate: '2028-04-02',
      departureDate: '2028-04-11',
      localityKind: 'CITY',
      cityResolution: 'RESOLVED',
    }],
    fieldStates: [{
      path: 'stops.0.name',
      status: 'EXPLICIT',
      evidence: 'Osaka',
      message: null,
      blocking: false,
    }],
  });
  const openCityQuestion = [{
    id: 'city',
    fieldPaths: ['stops.0.name'],
    prompt: 'Which city?',
    options: [],
    allowFreeText: true,
    blocking: true,
  }];

  for (const [answer, questions] of [
    ['Actually Osaka', []],
    ['Osaka instead', []],
    ['Osaka', openCityQuestion],
  ] as const) {
    const aligned = alignIncomingTripDraftStops(current, incoming, answer, questions);
    assert.deepEqual(aligned.stops.map((stop) => stop.name), ['Osaka'], answer);
  }
});

test('unrelated date wording cannot release a protected city', () => {
  const malformedIncoming = tripDraft({
    stops: [{
      draftId: 'destination-1',
      name: 'May',
      locationText: null,
      arrivalDate: '2028-05-10',
      departureDate: '2028-05-15',
      localityKind: 'CITY',
      cityResolution: 'RESOLVED',
    }],
    fieldStates: [{
      path: 'stops.0.name',
      status: 'EXPLICIT',
      evidence: 'May',
      message: null,
      blocking: false,
    }],
  });
  const protectedCity = new Set([
    'stops.0.name',
    'stops.0.localityKind',
    'stops.0.cityResolution',
  ]);
  const remaining = protectedPathsAfterFollowUp(
    protectedCity,
    malformedIncoming,
    'Dates: 10 to 15 May',
  );
  assert.deepEqual(remaining, protectedCity);
});

test('date corrections containing a month name cannot replace a protected city', () => {
  const malformedIncoming = tripDraft({
    stops: [{
      draftId: 'destination-1',
      name: 'May',
      locationText: null,
      arrivalDate: '2028-05-10',
      departureDate: '2028-05-15',
      localityKind: 'CITY',
      cityResolution: 'RESOLVED',
    }],
    fieldStates: [{
      path: 'stops.0.name',
      status: 'EXPLICIT',
      evidence: 'May',
      message: null,
      blocking: false,
    }],
  });
  const protectedCity = new Set([
    'stops.0.name',
    'stops.0.locationText',
    'stops.0.localityKind',
    'stops.0.cityResolution',
  ]);
  const remaining = protectedPathsAfterFollowUp(
    protectedCity,
    malformedIncoming,
    'Actually make the dates 10 to 15 May',
  );
  assert.deepEqual(remaining, protectedCity);
});

test('a valid answer to an open question becomes protected for later turns', () => {
  const incoming = tripDraft({
    fieldStates: [{
      path: 'stops.0.name',
      status: 'EXPLICIT',
      evidence: 'Porto',
      message: null,
      blocking: false,
    }],
  });
  const paths = explicitTripDraftPathsFromFollowUp(incoming, 'Porto', [{
    id: 'city',
    fieldPaths: ['stops.0.name'],
    prompt: 'Which city?',
    options: [],
    allowFreeText: true,
    blocking: true,
  }]);
  assert.equal(paths.has('stops.0.name'), true);
  assert.equal(paths.has('stops.0.localityKind'), true);
  assert.equal(paths.has('stops.0.cityResolution'), true);
});

test('prior free-text answers remain in later follow-up prompts', () => {
  const prompt = buildTripFollowUpPrompt(
    'Somewhere in Japan',
    tripInput(),
    [],
    '10 to 15 May',
    new Set(),
    ['Tokyo'],
  );
  assert.match(prompt, /Earlier user follow-ups: Tokyo/);
  assert.match(prompt, /User follow-up: 10 to 15 May/);
});

test('an unrelated follow-up cannot silently resolve an earlier relative-date question', () => {
  const fridayQuestion = {
    id: 'next-weekend-friday',
    fieldPaths: ['trip.startDate', 'trip.endDate'],
    prompt: 'Which weekend?',
    options: [{
      id: 'immediate',
      label: '5–6 Sep',
      updates: [
        { path: 'trip.startDate', value: '2026-09-05' },
        { path: 'trip.endDate', value: '2026-09-06' },
      ],
    }],
    allowFreeText: true,
    blocking: true,
  } satisfies TripClarificationQuestion;

  const afterCityOnlyReply = mergeUnansweredClarificationQuestions(
    [fridayQuestion],
    [],
    new Set(['stops.0.name']),
  );
  assert.deepEqual(afterCityOnlyReply, [fridayQuestion]);

  const afterDateReply = mergeUnansweredClarificationQuestions(
    [fridayQuestion],
    [],
    new Set(['trip.startDate', 'trip.endDate']),
  );
  assert.deepEqual(afterDateReply, []);

  const durationDraft = tripDraft({
    fieldStates: [{
      path: 'trip.endDate',
      status: 'INTERPRETED',
      evidence: 'five nights',
      message: 'Calculated from the stated duration.',
      blocking: false,
    }],
    questions: [],
  });
  const durationPaths = explicitTripDraftPathsFromFollowUp(
    durationDraft,
    'five nights',
    [fridayQuestion],
  );
  assert.equal(durationPaths.has('trip.endDate'), true);
  assert.deepEqual(
    mergeUnansweredClarificationQuestions([fridayQuestion], [], durationPaths),
    [],
  );
});

test('a semantic answer to a date-duration conflict clears the resolved question', () => {
  const conflictQuestion = {
    id: 'date-duration-conflict',
    fieldPaths: ['trip.startDate', 'trip.endDate'],
    prompt: 'The dates and trip duration disagree. Which dates should the draft use?',
    options: [],
    allowFreeText: true,
    blocking: true,
  } satisfies TripClarificationQuestion;
  const incoming = tripDraft({
    fieldStates: [
      { path: 'trip.startDate', status: 'EXPLICIT', evidence: '10 May', message: null, blocking: false },
      { path: 'trip.endDate', status: 'EXPLICIT', evidence: '15 May', message: null, blocking: false },
    ],
    questions: [],
  });

  for (const answer of ['Use the dates', 'The duration instead']) {
    const paths = explicitTripDraftPathsFromFollowUp(incoming, answer, [conflictQuestion]);
    assert.deepEqual(paths, new Set(['trip.startDate', 'trip.endDate']), answer);
    assert.deepEqual(
      mergeUnansweredClarificationQuestions([conflictQuestion], [], paths),
      [],
      answer,
    );
  }
});

test('follow-up prompts carry message dates and stay within the API limit', () => {
  const prompt = buildTripFollowUpPrompt(
    'A'.repeat(5_000),
    tripInput(),
    [],
    'B'.repeat(1_500),
    new Set(),
    ['2026-09-03: Tokyo'],
    '2026-09-04',
    '2026-09-03',
  );
  assert.match(prompt, /Original request \(local date 2026-09-03\)/);
  assert.match(prompt, /User follow-up \(local date 2026-09-04\)/);
  assert.ok(prompt.length <= 8_000);
});

test('stop-indexed state paths remap after a destination is removed', () => {
  assert.equal(remapTripDraftPathAfterStopRemoval('trip.startDate', 1), 'trip.startDate');
  assert.equal(remapTripDraftPathAfterStopRemoval('stops.1.name', 1), null);
  assert.equal(remapTripDraftPathAfterStopRemoval('stops.2.arrivalDate', 1), 'stops.1.arrivalDate');
});

test('dirty stop-date paths follow city identity through AI insertion and reordering', () => {
  const previous = [
    { draftId: 'tokyo', name: 'Tokyo', locationText: null, arrivalDate: null, departureDate: null },
    { draftId: 'kyoto', name: 'Kyoto', locationText: null, arrivalDate: null, departureDate: null },
  ];
  const next = [
    previous[0]!,
    { draftId: 'osaka', name: 'Osaka', locationText: null, arrivalDate: null, departureDate: null },
    previous[1]!,
  ];
  const remapped = remapDirtyTripDraftPaths(
    new Set(['trip.endDate', 'stops.1.arrivalDate']),
    previous,
    next,
  );
  assert.deepEqual(remapped, new Set(['trip.endDate', 'stops.2.arrivalDate']));
});

test('trip and boundary-destination dates stay in sync without overwriting an explicit stop date', () => {
  const initial = tripInput({
    startDate: '2028-04-02',
    endDate: '2028-04-11',
    stops: [
      { name: 'Porto', locationText: null, arrivalDate: '2028-04-02', departureDate: '2028-04-06' },
      { name: 'Lisbon', locationText: null, arrivalDate: '2028-04-06', departureDate: '2028-04-11' },
    ],
  });

  const changedTripStart = updateTripBoundaryDate(initial, 'start', '2028-04-03');
  assert.equal(changedTripStart.startDate, '2028-04-03');
  assert.equal(changedTripStart.stops[0]?.arrivalDate, '2028-04-03');

  const changedTripEnd = updateTripBoundaryDate(changedTripStart, 'end', '2028-04-12');
  assert.equal(changedTripEnd.endDate, '2028-04-12');
  assert.equal(changedTripEnd.stops[1]?.departureDate, '2028-04-12');

  const changedFirstStop = updateTripStopDate(changedTripEnd, 0, 'arrivalDate', '2028-04-04');
  assert.equal(changedFirstStop.startDate, '2028-04-04');
  const changedLastStop = updateTripStopDate(changedFirstStop, 1, 'departureDate', '2028-04-13');
  assert.equal(changedLastStop.endDate, '2028-04-13');

  const independentlyEdited = tripInput({
    startDate: '2028-04-02',
    stops: [{
      name: 'Porto',
      locationText: null,
      arrivalDate: '2028-04-05',
      departureDate: null,
    }],
  });
  const preserved = updateTripBoundaryDate(independentlyEdited, 'start', '2028-04-03');
  assert.equal(preserved.startDate, '2028-04-03');
  assert.equal(preserved.stops[0]?.arrivalDate, '2028-04-05');
});

test('a newly appended destination inherits an explicit previous departure date', () => {
  const input = tripInput({
    endDate: '2028-04-11',
    stops: [{
      name: 'Porto',
      locationText: null,
      arrivalDate: '2028-04-02',
      departureDate: '2028-04-06',
    }],
  });
  const appended = appendTripStop(input);
  assert.equal(appended.stops.length, 2);
  assert.equal(appended.stops[1]?.arrivalDate, '2028-04-06');
  assert.equal(appended.stops[1]?.departureDate, '2028-04-11');
});

test('adding a destination moves an untouched trip end to the new last destination', () => {
  const input = tripInput({
    endDate: '2028-04-11',
    stops: [{
      name: 'Porto',
      locationText: null,
      arrivalDate: '2028-04-02',
      departureDate: '2028-04-11',
    }],
  });

  const appended = appendTripStop(input);
  assert.equal(appended.stops[0]?.departureDate, null);
  assert.equal(appended.stops[1]?.arrivalDate, null);
  assert.equal(appended.stops[1]?.departureDate, '2028-04-11');

  const preserved = appendTripStop(input, { lastDepartureDirty: true });
  assert.equal(preserved.stops[0]?.departureDate, '2028-04-11');
  assert.equal(preserved.stops[1]?.arrivalDate, '2028-04-11');
  assert.equal(preserved.stops[1]?.departureDate, '2028-04-11');
});

test('a destination end keeps the next untouched destination start linked', () => {
  const input = tripInput({
    stops: [
      { name: 'Porto', locationText: null, arrivalDate: '2028-04-02', departureDate: null },
      { name: 'Lisbon', locationText: null, arrivalDate: null, departureDate: '2028-04-11' },
    ],
  });

  const linked = updateTripStopDate(input, 0, 'departureDate', '2028-04-06');
  assert.equal(linked.stops[1]?.arrivalDate, '2028-04-06');

  const moved = updateTripStopDate(linked, 0, 'departureDate', '2028-04-07');
  assert.equal(moved.stops[1]?.arrivalDate, '2028-04-07');

  const preserved = updateTripStopDate(
    linked,
    0,
    'departureDate',
    '2028-04-08',
    { nextArrivalDirty: true },
  );
  assert.equal(preserved.stops[1]?.arrivalDate, '2028-04-06');
});

test('a dirty main trip boundary is not overwritten by a destination edit', () => {
  const input = tripInput({
    endDate: '2028-04-11',
    stops: [{
      name: 'Porto',
      locationText: null,
      arrivalDate: '2028-04-02',
      departureDate: '2028-04-11',
    }],
  });
  const next = updateTripStopDate(
    input,
    0,
    'departureDate',
    '2028-04-10',
    { tripBoundaryDirty: true },
  );
  assert.equal(next.endDate, '2028-04-11');
  assert.equal(next.stops[0]?.departureDate, '2028-04-10');
});

test('a cleared destination date remains untouched by later boundary changes once dirty', () => {
  const input = tripInput({
    endDate: '2028-04-11',
    stops: [{
      name: 'Porto',
      locationText: null,
      arrivalDate: '2028-04-02',
      departureDate: null,
    }],
  });
  const changed = updateTripBoundaryDate(
    input,
    'end',
    '2028-04-12',
    { stopDateDirty: true },
  );
  assert.equal(changed.stops[0]?.departureDate, null);
});

test('removing an auto-linked last destination restores the trip end to its predecessor', () => {
  const initial = tripInput({
    endDate: '2028-04-11',
    stops: [{
      name: 'Porto',
      locationText: null,
      arrivalDate: '2028-04-02',
      departureDate: '2028-04-11',
    }],
  });
  const appended = appendTripStop(initial);
  const restored = removeTripStop(appended, 1, { preserveTripEnd: true });
  assert.equal(restored.endDate, '2028-04-11');
  assert.equal(restored.stops[0]?.departureDate, '2028-04-11');
});

test('removing an auto-linked last destination preserves explicit predecessor state', () => {
  const appended = appendTripStop(tripInput({
    endDate: '2028-04-11',
    stops: [{
      name: 'Porto',
      locationText: null,
      arrivalDate: '2028-04-02',
      departureDate: '2028-04-06',
    }],
  }));
  const restored = removeTripStop(appended, 1, { preserveTripEnd: true });
  assert.equal(restored.endDate, '2028-04-11');
  assert.equal(restored.stops[0]?.departureDate, '2028-04-06');

  const cleared = removeTripStop({
    ...appended,
    stops: [{ ...appended.stops[0]!, departureDate: null }, appended.stops[1]!],
  }, 1, { preserveTripEnd: true, survivingDepartureDirty: true });
  assert.equal(cleared.endDate, '2028-04-11');
  assert.equal(cleared.stops[0]?.departureDate, null);
});

test('removing a boundary destination derives trip boundaries from the remaining route', () => {
  const input = tripInput({
    startDate: '2028-04-02',
    endDate: '2028-04-14',
    stops: [
      { name: 'Porto', locationText: null, arrivalDate: '2028-04-02', departureDate: '2028-04-06' },
      { name: 'Lisbon', locationText: null, arrivalDate: '2028-04-06', departureDate: '2028-04-11' },
      { name: 'Faro', locationText: null, arrivalDate: '2028-04-11', departureDate: '2028-04-14' },
    ],
  });
  const withoutFirst = removeTripStop(input, 0);
  assert.equal(withoutFirst.startDate, '2028-04-06');
  assert.equal(withoutFirst.endDate, '2028-04-14');
  const withoutLast = removeTripStop(withoutFirst, 1);
  assert.equal(withoutLast.startDate, '2028-04-06');
  assert.equal(withoutLast.endDate, '2028-04-11');

  const buffered = removeTripStop(tripInput({
    startDate: '2028-04-01',
    stops: [
      { name: 'Porto', locationText: null, arrivalDate: '2028-04-02', departureDate: '2028-04-06' },
      { name: 'Lisbon', locationText: null, arrivalDate: '2028-04-06', departureDate: '2028-04-11' },
    ],
  }), 0);
  assert.equal(buffered.startDate, '2028-04-01');
});

test('the hidden destination area is synthesized from stop names with a trip-name fallback', () => {
  assert.equal(destinationAreaFromStops(tripInput({
    stops: [
      { name: ' Porto ', locationText: null, arrivalDate: null, departureDate: null },
      { name: 'Lisbon', locationText: null, arrivalDate: null, departureDate: null },
    ],
  })), 'Porto · Lisbon');
  assert.equal(destinationAreaFromStops(tripInput({ name: 'Spring break', stops: [] })), 'Spring break');
  assert.equal(destinationAreaFromStops(tripInput({ name: '  ', stops: [] })), 'Trip');
});

test('the hidden destination area never exceeds the API compatibility limit', () => {
  const destinationArea = destinationAreaFromStops(tripInput({
    stops: Array.from({ length: 20 }, (_, index) => ({
      name: `Destination ${index + 1} ${'x'.repeat(110)}`,
      locationText: null,
      arrivalDate: null,
      departureDate: null,
    })),
  }));
  assert.equal(destinationArea.length, 200);
});

test('destinations sort chronologically without mutating the server-provided collection', () => {
  const stops = [
    { id: 'undated', position: 0, arrivalDate: null, departureDate: null },
    { id: 'later', position: 1, arrivalDate: '2028-04-11', departureDate: '2028-04-14' },
    { id: 'earlier', position: 2, arrivalDate: '2028-04-02', departureDate: '2028-04-06' },
    { id: 'earlier-shorter', position: 3, arrivalDate: '2028-04-02', departureDate: '2028-04-05' },
  ] satisfies Array<Pick<TripStop, 'id' | 'position' | 'arrivalDate' | 'departureDate'>>;
  const sorted = sortStopsByDate(stops);
  assert.deepEqual(sorted.map((stop) => stop.id), ['earlier-shorter', 'earlier', 'later', 'undated']);
  assert.deepEqual(stops.map((stop) => stop.id), ['undated', 'later', 'earlier', 'earlier-shorter']);
});

test('presentation helpers derive labels from arbitrary persisted dates', () => {
  assert.equal(formatDateRange('2028-01-30', '2028-02-03'), '30 Jan–3 Feb 2028');
});

test('IANA timezone helpers preserve wall time across UTC conversion', () => {
  const stored = dateTimeLocalToIso('2028-07-12T10:30', 'Europe/London');
  assert.equal(stored, '2028-07-12T09:30:00.000Z');
  assert.equal(isoToDateTimeLocal(stored, 'Europe/London'), '2028-07-12T10:30');
  assert.throws(
    () => dateTimeLocalToIso('2028-07-12T10:30', 'Europe/Londn'),
    /valid IANA timezone/,
  );
});

test('unchanged ambiguous local times preserve their original instant', () => {
  const earlyOccurrence = '2025-10-26T00:30:00.000Z';
  const lateOccurrence = '2025-10-26T01:30:00.000Z';
  assert.equal(isoToDateTimeLocal(earlyOccurrence, 'Europe/London'), '2025-10-26T01:30');
  assert.equal(isoToDateTimeLocal(lateOccurrence, 'Europe/London'), '2025-10-26T01:30');
  assert.equal(
    dateTimeLocalToIsoPreserving('2025-10-26T01:30', 'Europe/London', earlyOccurrence),
    earlyOccurrence,
  );
  assert.equal(
    dateTimeLocalToIsoPreserving('2025-10-26T01:30', 'Europe/London', lateOccurrence),
    lateOccurrence,
  );
});

test('new stay date-times use the destination dates with practical suggested times', () => {
  assert.deepEqual(stayDateTimesForStop({
    arrivalDate: '2028-07-12',
    departureDate: '2028-07-16',
  }), {
    checkIn: '2028-07-12T15:00',
    checkOut: '2028-07-16T11:00',
  });
  assert.deepEqual(stayDateTimesForStop(undefined), { checkIn: null, checkOut: null });
  assert.deepEqual(stayDateTimesForStop({
    arrivalDate: '2028-07-12',
    departureDate: '2028-07-12',
  }), {
    checkIn: '2028-07-12T15:00',
    checkOut: '2028-07-12T17:00',
  });
});

test('transport and activity suggestions stay anchored to their destinations', () => {
  const from = { arrivalDate: '2028-07-12', departureDate: '2028-07-14' };
  const to = { arrivalDate: '2028-07-14', departureDate: '2028-07-16' };
  assert.deepEqual(transportDateTimesForStops(from, to), {
    departureTime: '2028-07-14T09:00',
    arrivalTime: '2028-07-14T17:00',
  });
  assert.equal(activityDateTimeForStop(to), '2028-07-14T09:00');
  assert.equal(activityDateTimeForStop(undefined), null);
});

test('transport suggestions never invert the timing for overlapping or reverse routes', () => {
  assert.deepEqual(
    transportDateTimesForStops(
      { arrivalDate: '2028-07-01', departureDate: '2028-07-10' },
      { arrivalDate: '2028-07-05', departureDate: '2028-07-07' },
    ),
    {
      departureTime: '2028-07-10T09:00',
      arrivalTime: '2028-07-10T17:00',
    },
  );
});

test('production web code contains no fixture or browser-storage fallback', async () => {
  const files = [
    new URL('../lib/graphql-client.ts', import.meta.url),
    new URL('../components/trip-dock-app.tsx', import.meta.url),
  ];
  const source = (await Promise.all(files.map((file) => readFile(fileURLToPath(file), 'utf8')))).join('\n');
  assert.doesNotMatch(
    source,
    /localStorage|sessionStorage|seedTrips|proposalChangesFromPrompt|proposalTimer|recognizedChanges|local fixture|mock controls/i,
  );
  assert.doesNotMatch(
    source,
    /PostgreSQL|Local workspace|Destination area|Location detail|Start manually|Draft with TripDock AI/i,
  );
  assert.doesNotMatch(source, /<Field label="[^"]*timezone/i);
  assert.doesNotMatch(
    source,
    /prepareTripProposal|applyTripProposal|discardTripProposal|proposal-prompt|Open TripDock AI/i,
  );
});

test('creation UI locks mutable draft controls during a follow-up and honors locale/name state', async () => {
  const source = await readFile(
    fileURLToPath(new URL('../components/trip-dock-app.tsx', import.meta.url)),
    'utf8',
  );
  assert.match(source, /disabled=\{followUpBusy \|\| busy\} \/>/u);
  assert.match(source, /className="clarification-question"[^>]+disabled=\{followUpBusy\}/u);
  assert.match(source, /navigator\.language \|\| 'en-GB'/u);
  assert.match(source, /fieldStates\.get\('trip\.name'\)\?\.status === 'SUGGESTED'/u);
});
