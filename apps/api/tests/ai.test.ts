import assert from 'node:assert/strict';
import test from 'node:test';

import { FixtureAiGateway, UnconfiguredAiGateway } from '../src/ai.js';

const draft = {
  name: 'Fixture journey',
  destinationArea: 'Fixture region',
  startDate: '2027-06-01',
  endDate: '2027-06-04',
  travelerCount: 2,
  stops: [
    {
      name: 'Fixture stop',
      locationText: null,
      arrivalDate: '2027-06-01',
      departureDate: '2027-06-04',
    },
  ],
  assumptions: [],
  warnings: [],
};

test('FixtureAiGateway is explicit, deterministic, and records calls', async () => {
  const gateway = new FixtureAiGateway(draft);
  const first = await gateway.generateTripDraft('A deterministic fixture prompt');
  const second = await gateway.generateTripDraft('A deterministic fixture prompt');

  assert.deepEqual(first.value, draft);
  assert.deepEqual(second.value, draft);
  assert.notStrictEqual(first.value, second.value);
  assert.equal(first.model, 'fixture-tripdock-v1');
  assert.deepEqual(gateway.calls, [
    { kind: 'draft', prompt: 'A deterministic fixture prompt' },
    { kind: 'draft', prompt: 'A deterministic fixture prompt' },
  ]);
});

test('UnconfiguredAiGateway fails clearly and never returns fixture data', async () => {
  const gateway = new UnconfiguredAiGateway();
  await assert.rejects(
    () => gateway.generateTripDraft('A sufficiently detailed trip request'),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('OPENAI_API_KEY') &&
      (error as { code?: string }).code === 'AI_NOT_CONFIGURED',
  );
});
