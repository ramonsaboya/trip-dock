import assert from 'node:assert/strict';
import test from 'node:test';

import { FixtureAiGateway, UnconfiguredAiGateway } from '../src/ai.js';

const missingDate = {
  sourceText: null,
  kind: 'MISSING' as const,
  day: null,
  month: null,
  year: null,
};

const extraction = {
  name: { value: null, evidence: null, origin: 'MISSING' as const },
  travelerCount: { value: null, evidence: null, origin: 'MISSING' as const },
  startDate: missingDate,
  endDate: missingDate,
  duration: { value: null, unit: 'MISSING' as const, evidence: null },
  destinations: [],
  assumptions: [],
  warnings: [],
};

const request = {
  prompt: 'A deterministic fixture prompt',
  locale: 'en-GB',
  timeZone: 'Europe/London',
  referenceDate: '2026-09-03',
};

test('FixtureAiGateway is explicit, deterministic, and records calls', async () => {
  const gateway = new FixtureAiGateway(extraction);
  const first = await gateway.interpretTripCreation(request);
  const second = await gateway.interpretTripCreation(request);

  assert.deepEqual(first.value, extraction);
  assert.deepEqual(second.value, extraction);
  assert.notStrictEqual(first.value, second.value);
  assert.equal(first.model, 'fixture-tripdock-v1');
  assert.deepEqual(gateway.calls, [
    { kind: 'draft', request },
    { kind: 'draft', request },
  ]);
});

test('UnconfiguredAiGateway fails clearly and never returns fixture data', async () => {
  const gateway = new UnconfiguredAiGateway();
  await assert.rejects(
    () => gateway.interpretTripCreation({
      ...request,
      prompt: 'A sufficiently detailed trip request',
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('OPENAI_API_KEY') &&
      (error as { code?: string }).code === 'AI_NOT_CONFIGURED',
  );
});
