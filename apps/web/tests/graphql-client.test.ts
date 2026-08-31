import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  dateTimeLocalToIso,
  draftToTripInput,
  formatDateRange,
  graphqlRequest,
  isoToDateTimeLocal,
  TripDockGraphQLError,
  toggleSelectedOperation,
  type TripDraft,
} from '../lib/graphql-client.ts';

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

test('production web code contains no fixture, timer, or browser-storage fallback', async () => {
  const files = [
    new URL('../lib/graphql-client.ts', import.meta.url),
    new URL('../components/trip-dock-app.tsx', import.meta.url),
  ];
  const source = (await Promise.all(files.map((file) => readFile(fileURLToPath(file), 'utf8')))).join('\n');
  assert.doesNotMatch(source, /localStorage|sessionStorage|seedTrips|proposalChangesFromPrompt|setTimeout\s*\(/);
});
