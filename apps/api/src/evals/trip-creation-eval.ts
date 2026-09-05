import type {
  DateIntent,
  TripCreationDraft,
  TripCreationRequest,
  TripIntentExtraction,
} from '../trip-creation.js';

export type TripCreationEvalSuite = 'REGRESSION' | 'CAPABILITY';

export type TripCreationEvalVariant = {
  id: string;
  prompt: string;
  tags: string[];
};

type ExpectedDateIntent = Pick<DateIntent, 'kind' | 'day' | 'month' | 'year'>;

type ExpectedDestinationIntent = {
  name: string;
  localityKind: 'CITY';
  duration?: {
    value: number;
    unit: 'DAYS' | 'FULL_DAYS' | 'NIGHTS' | 'WEEKS';
  };
};

type ExpectedExtraction = {
  destinationArea?: string | null;
  startDate?: ExpectedDateIntent;
  endDate?: ExpectedDateIntent;
  orderedCities?: ExpectedDestinationIntent[];
  forbiddenCityNames?: string[];
};

type ExpectedStopInterval = {
  name: string;
  arrivalDate: string | null;
  departureDate: string | null;
};

type ExpectedDraft = {
  destinationArea?: string;
  startDate?: string | null;
  endDate?: string | null;
  orderedStops?: string[];
  forbiddenStops?: string[];
  stopIntervals?: ExpectedStopInterval[];
  minimumViable: boolean;
  blockingQuestionIds?: string[];
  requiredQuestionIds?: string[];
  forbiddenQuestionIds?: string[];
  fieldStatuses?: Record<string, TripCreationDraft['fieldStates'][number]['status']>;
};

export type TripCreationEvalScenario = {
  id: string;
  title: string;
  suite: TripCreationEvalSuite;
  rationale: string;
  context: Omit<TripCreationRequest, 'prompt'>;
  variants: TripCreationEvalVariant[];
  expected: {
    extraction: ExpectedExtraction;
    draft: ExpectedDraft;
  };
};

export type TripCreationEvalFailure = {
  layer: 'extraction' | 'draft';
  path: string;
  expected: unknown;
  actual: unknown;
  message: string;
};

export type TripCreationEvalResult = {
  passed: boolean;
  releaseBlocking: boolean;
  checks: number;
  failures: TripCreationEvalFailure[];
};

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('en-GB');
}

function namesEqual(actual: string, expected: string): boolean {
  return normalized(actual) === normalized(expected);
}

function arraysEqual<T>(actual: T[], expected: T[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

export function evaluateTripCreationResult(
  scenario: TripCreationEvalScenario,
  extraction: TripIntentExtraction,
  draft: TripCreationDraft,
): TripCreationEvalResult {
  const failures: TripCreationEvalFailure[] = [];
  let checks = 0;

  const check = (
    layer: TripCreationEvalFailure['layer'],
    path: string,
    expected: unknown,
    actual: unknown,
    passed: boolean,
    message: string,
  ): void => {
    checks += 1;
    if (!passed) failures.push({ layer, path, expected, actual, message });
  };

  const expectedExtraction = scenario.expected.extraction;
  if (expectedExtraction.destinationArea !== undefined) {
    const actual = extraction.destinationArea.value;
    const expected = expectedExtraction.destinationArea;
    check(
      'extraction',
      'destinationArea.value',
      expected,
      actual,
      actual === null ? expected === null : expected !== null && namesEqual(actual, expected),
      'Trip-wide country or region context was not extracted as expected.',
    );
  }

  const checkDateIntent = (
    path: 'startDate' | 'endDate',
    expected: ExpectedDateIntent | undefined,
  ): void => {
    if (!expected) return;
    const actual = extraction[path];
    for (const key of ['kind', 'day', 'month', 'year'] as const) {
      check(
        'extraction',
        `${path}.${key}`,
        expected[key],
        actual[key],
        actual[key] === expected[key],
        `The ${path} ${key} was extracted incorrectly.`,
      );
    }
  };

  checkDateIntent('startDate', expectedExtraction.startDate);
  checkDateIntent('endDate', expectedExtraction.endDate);

  if (expectedExtraction.orderedCities) {
    const actualCities = extraction.destinations.filter(
      (destination) => destination.localityKind === 'CITY' && destination.city,
    );
    const actualNames = actualCities.map((destination) => destination.city as string);
    const expectedNames = expectedExtraction.orderedCities.map(({ name }) => name);
    check(
      'extraction',
      'destinations[city].order',
      expectedNames,
      actualNames,
      arraysEqual(actualNames.map(normalized), expectedNames.map(normalized)),
      'The ordered city itinerary differs from the semantic contract.',
    );

    for (const expectedDestination of expectedExtraction.orderedCities) {
      if (!expectedDestination.duration) continue;
      const actualDestination = actualCities.find(
        ({ city }) => city !== null && namesEqual(city, expectedDestination.name),
      );
      check(
        'extraction',
        `destinations.${expectedDestination.name}.stayDuration`,
        expectedDestination.duration,
        actualDestination
          ? {
              value: actualDestination.stayDuration.value,
              unit: actualDestination.stayDuration.unit,
            }
          : null,
        actualDestination?.stayDuration.value === expectedDestination.duration.value &&
          actualDestination.stayDuration.unit === expectedDestination.duration.unit,
        `The stay duration for ${expectedDestination.name} was not extracted correctly.`,
      );
    }
  }

  for (const forbiddenName of expectedExtraction.forbiddenCityNames ?? []) {
    const actual = extraction.destinations
      .filter(({ city, localityKind }) => localityKind === 'CITY' && city !== null)
      .map(({ city }) => city as string);
    check(
      'extraction',
      `destinations[city!=${forbiddenName}]`,
      `No city named ${forbiddenName}`,
      actual,
      !actual.some((name) => namesEqual(name, forbiddenName)),
      `${forbiddenName} is trip context, not a city stop.`,
    );
  }

  const expectedDraft = scenario.expected.draft;
  if (expectedDraft.destinationArea !== undefined) {
    check(
      'draft',
      'destinationArea',
      expectedDraft.destinationArea,
      draft.destinationArea,
      namesEqual(draft.destinationArea, expectedDraft.destinationArea),
      'The resolved destination area differs from the semantic contract.',
    );
  }

  for (const path of ['startDate', 'endDate'] as const) {
    if (expectedDraft[path] === undefined) continue;
    check(
      'draft',
      path,
      expectedDraft[path],
      draft[path],
      draft[path] === expectedDraft[path],
      `The resolved trip ${path} differs from the semantic contract.`,
    );
  }

  const namedStops = draft.stops.filter(({ name }) => name.trim()).map(({ name }) => name);
  if (expectedDraft.orderedStops) {
    check(
      'draft',
      'stops.order',
      expectedDraft.orderedStops,
      namedStops,
      arraysEqual(namedStops.map(normalized), expectedDraft.orderedStops.map(normalized)),
      'The resolved stop order differs from the semantic contract.',
    );
  }

  for (const forbiddenName of expectedDraft.forbiddenStops ?? []) {
    check(
      'draft',
      `stops[name!=${forbiddenName}]`,
      `No stop named ${forbiddenName}`,
      namedStops,
      !namedStops.some((name) => namesEqual(name, forbiddenName)),
      `${forbiddenName} must remain trip context rather than becoming a stop.`,
    );
  }

  if (expectedDraft.stopIntervals) {
    const actualIntervals = draft.stops
      .filter(({ name }) => name.trim())
      .map(({ name, arrivalDate, departureDate }) => ({ name, arrivalDate, departureDate }));
    const normalizedActual = actualIntervals.map((interval) => ({
      ...interval,
      name: normalized(interval.name),
    }));
    const normalizedExpected = expectedDraft.stopIntervals.map((interval) => ({
      ...interval,
      name: normalized(interval.name),
    }));
    check(
      'draft',
      'stops.intervals',
      expectedDraft.stopIntervals,
      actualIntervals,
      JSON.stringify(normalizedActual) === JSON.stringify(normalizedExpected),
      'One or more stop date intervals differ from the semantic contract.',
    );
  }

  check(
    'draft',
    'minimumViable',
    expectedDraft.minimumViable,
    draft.minimumViable,
    draft.minimumViable === expectedDraft.minimumViable,
    'Draft readiness differs from the expected outcome.',
  );

  const allQuestionIds = draft.questions.map(({ id }) => id);
  const blockingQuestionIds = draft.questions.filter(({ blocking }) => blocking).map(({ id }) => id);
  if (expectedDraft.blockingQuestionIds) {
    check(
      'draft',
      'questions[blocking].ids',
      expectedDraft.blockingQuestionIds,
      blockingQuestionIds,
      arraysEqual(blockingQuestionIds.slice().sort(), expectedDraft.blockingQuestionIds.slice().sort()),
      'The set of blocking clarification questions differs from the semantic contract.',
    );
  }

  for (const requiredId of expectedDraft.requiredQuestionIds ?? []) {
    check(
      'draft',
      `questions[id=${requiredId}]`,
      requiredId,
      allQuestionIds,
      allQuestionIds.includes(requiredId),
      `Required clarification question ${requiredId} was not produced.`,
    );
  }

  for (const forbiddenId of expectedDraft.forbiddenQuestionIds ?? []) {
    check(
      'draft',
      `questions[id!=${forbiddenId}]`,
      `No question ${forbiddenId}`,
      allQuestionIds,
      !allQuestionIds.includes(forbiddenId),
      `Unexpected clarification question ${forbiddenId} was produced.`,
    );
  }

  for (const [path, expectedStatus] of Object.entries(expectedDraft.fieldStatuses ?? {})) {
    const actualStatus = draft.fieldStates.find((state) => state.path === path)?.status ?? null;
    check(
      'draft',
      `fieldStates.${path}.status`,
      expectedStatus,
      actualStatus,
      actualStatus === expectedStatus,
      `The provenance status for ${path} differs from the semantic contract.`,
    );
  }

  return {
    passed: failures.length === 0,
    releaseBlocking: scenario.suite === 'REGRESSION' && failures.length > 0,
    checks,
    failures,
  };
}
