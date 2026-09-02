import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  appendTripStop,
  dateTimeLocalToIso,
  destinationAreaFromStops,
  draftToTripInput,
  formatDateRange,
  graphqlRequest,
  isoToDateTimeLocal,
  removeTripStop,
  sortStopsByDate,
  TripDockGraphQLError,
  toggleSelectedOperation,
  updateTripBoundaryDate,
  updateTripStopDate,
  type TripDraft,
  type TripInput,
  type TripStop,
} from '../lib/graphql-client.ts';

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
  };
  const input = draftToTripInput(draft);
  assert.deepEqual(input, {
    name: 'Coastal week',
    destinationArea: 'Atlantic coast',
    startDate: '',
    endDate: '',
    travelerCount: 2,
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
  });
  assert.equal(fromStopDates.startDate, '2028-04-02');
  assert.equal(fromStopDates.endDate, '2028-04-11');
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

test('a newly appended destination inherits the previous destination departure date', () => {
  const input = tripInput({
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
  assert.equal(appended.stops[1]?.departureDate, null);
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

test('proposal operation selection is independent and reversible', () => {
  let selected = new Set(['operation-a', 'operation-b']);
  selected = toggleSelectedOperation(selected, 'operation-a');
  assert.deepEqual([...selected], ['operation-b']);
  selected = toggleSelectedOperation(selected, 'operation-c');
  assert.deepEqual([...selected], ['operation-b', 'operation-c']);
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
});
