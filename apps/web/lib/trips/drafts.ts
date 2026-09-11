import { localIsoDate } from './dates.ts';
import { updateTripBoundaryDate } from './stops.ts';
import { type TripClarificationQuestion, type TripClarificationUpdate, type TripDraft, type TripDraftFieldState, type TripDraftStop, type TripInput } from './types.ts';

export function draftToTripInput(draft: TripDraft): TripInput {
  const startDate = draft.startDate ?? draft.stops[0]?.arrivalDate ?? '';
  const endDate = draft.endDate ?? draft.stops.at(-1)?.departureDate ?? '';
  const allowsBoundaryFallback = (path: string) => {
    const state = draft.fieldStates.find((candidate) => candidate.path === path);
    return !state || state.status === 'MISSING' || state.status === 'INTERPRETED';
  };
  const stops = draft.stops.map((stop, index) => ({
    ...stop,
    arrivalDate: index === 0 && allowsBoundaryFallback('stops.0.arrivalDate')
      ? (stop.arrivalDate ?? startDate) || null
      : stop.arrivalDate,
    departureDate:
      index === draft.stops.length - 1 &&
      allowsBoundaryFallback(`stops.${draft.stops.length - 1}.departureDate`)
        ? (stop.departureDate ?? endDate) || null
        : stop.departureDate,
  }));
  return {
    name: draft.name,
    destinationArea: draft.destinationArea,
    startDate,
    endDate,
    travelerCount: draft.travelerCount,
    stops,
  };
}

export function tripStopsForCreation(
  input: TripInput,
  fieldStates: ReadonlyMap<string, TripDraftFieldState> = new Map(),
): Array<{
  name: string;
  locationText: string | null;
  arrivalDate: string | null;
  departureDate: string | null;
}> {
  const resolvedStops = input.stops
    .map((stop, originalIndex) => ({ stop, originalIndex }))
    .filter(({ stop }) =>
      Boolean(stop.name.trim()) &&
      stop.localityKind === 'CITY' &&
      stop.cityResolution === 'RESOLVED',
    );
  const stops = resolvedStops.map(({ stop }) => ({
    name: stop.name.trim(),
    locationText: stop.locationText,
    arrivalDate: stop.arrivalDate,
    departureDate: stop.departureDate,
  }));
  if (!stops.length) return stops;
  const boundaryCanFallBack = (path: string) => {
    const state = fieldStates.get(path);
    return !state || state.status === 'MISSING' || state.status === 'INTERPRETED';
  };
  if (
    !stops[0]!.arrivalDate &&
    boundaryCanFallBack(`stops.${resolvedStops[0]!.originalIndex}.arrivalDate`)
  ) {
    stops[0] = { ...stops[0]!, arrivalDate: input.startDate || null };
  }
  const lastIndex = stops.length - 1;
  if (
    !stops[lastIndex]!.departureDate &&
    boundaryCanFallBack(
      `stops.${resolvedStops[resolvedStops.length - 1]!.originalIndex}.departureDate`,
    )
  ) {
    stops[lastIndex] = { ...stops[lastIndex]!, departureDate: input.endDate || null };
  }
  return stops;
}

export function tripDraftFieldStateMap(
  states: readonly TripDraftFieldState[],
): Map<string, TripDraftFieldState> {
  return new Map(states.map((state) => [state.path, { ...state }]));
}

export function confirmedTripDraftFieldState(
  path: string,
  value: unknown,
  previous?: TripDraftFieldState,
  referenceDate = localIsoDate(),
): TripDraftFieldState {
  const isDatePath = path === 'trip.startDate' ||
    path === 'trip.endDate' ||
    path.endsWith('.arrivalDate') ||
    path.endsWith('.departureDate');
  const isPastDate = isDatePath &&
    typeof value === 'string' &&
    isRealIsoDate(value) &&
    value < referenceDate;
  return {
    path,
    status: isPastDate ? 'PAST' : 'CONFIRMED',
    evidence: previous?.evidence ?? null,
    message: isPastDate ? 'This confirmed date is in the past.' : null,
    blocking: false,
  };
}

export function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day;
}

export function isValidTripDateRange(input: Pick<TripInput, 'startDate' | 'endDate'>): boolean {
  return Boolean(
    input.startDate &&
    input.endDate &&
    isRealIsoDate(input.startDate) &&
    isRealIsoDate(input.endDate) &&
    input.endDate >= input.startDate,
  );
}

export function clarificationPathsConfirmedByEdit(
  path: string,
  input: Pick<TripInput, 'startDate' | 'endDate'>,
  questions: readonly TripClarificationQuestion[],
): string[] {
  if (
    (path === 'trip.startDate' || path === 'trip.endDate') &&
    isValidTripDateRange(input) &&
    questions.some((question) =>
      question.blocking &&
      question.fieldPaths.includes('trip.startDate') &&
      question.fieldPaths.includes('trip.endDate'),
    )
  ) {
    return ['trip.startDate', 'trip.endDate'];
  }
  return [path];
}

export function isTripMinimumViable(
  input: TripInput,
  fieldStates: ReadonlyMap<string, TripDraftFieldState> = new Map(),
  questions: readonly TripClarificationQuestion[] = [],
): boolean {
  const datesValid = isValidTripDateRange(input);
  const dateBlocked = ['trip.startDate', 'trip.endDate'].some((path) => {
    const state = fieldStates.get(path);
    return state?.blocking || state?.status === 'INVALID' || state?.status === 'CONFLICTING';
  });
  const hasCity = input.stops.some((stop, index) => {
    if (!stop.name.trim()) return false;
    if (stop.localityKind && stop.localityKind !== 'CITY') return false;
    if (stop.cityResolution && stop.cityResolution !== 'RESOLVED') return false;
    const state = fieldStates.get(`stops.${index}.name`);
    if (state?.status === 'INVALID' || state?.status === 'CONFLICTING') return false;
    return stop.cityResolution === 'RESOLVED' || !state?.blocking;
  });
  const persistedStopsAreValid = input.stops.every((stop) => {
    const willPersist = Boolean(
      stop.name.trim() &&
      (!stop.localityKind || stop.localityKind === 'CITY') &&
      (!stop.cityResolution || stop.cityResolution === 'RESOLVED'),
    );
    if (!willPersist) return true;
    if (stop.arrivalDate && !isRealIsoDate(stop.arrivalDate)) return false;
    if (stop.departureDate && !isRealIsoDate(stop.departureDate)) return false;
    if (stop.arrivalDate && stop.departureDate && stop.departureDate < stop.arrivalDate) return false;
    if (stop.arrivalDate && (stop.arrivalDate < input.startDate || stop.arrivalDate > input.endDate)) return false;
    if (stop.departureDate && (stop.departureDate < input.startDate || stop.departureDate > input.endDate)) return false;
    return true;
  });
  return datesValid &&
    !dateBlocked &&
    hasCity &&
    persistedStopsAreValid &&
    !questions.some((item) => item.blocking);
}

export function applyClarificationUpdates(
  input: TripInput,
  updates: readonly TripClarificationUpdate[],
): TripInput {
  let next: TripInput = structuredClone(input);
  for (const update of updates) {
    const tripMatch = /^trip\.(name|startDate|endDate|travelerCount)$/.exec(update.path);
    if (tripMatch) {
      const field = tripMatch[1]!;
      if (field === 'travelerCount') {
        const parsed = update.value === null || update.value === '' ? null : Number(update.value);
        if (parsed === null || (Number.isInteger(parsed) && parsed >= 1 && parsed <= 20)) {
          next = { ...next, travelerCount: parsed };
        }
      } else if (field === 'startDate' || field === 'endDate') {
        next = updateTripBoundaryDate(
          next,
          field === 'startDate' ? 'start' : 'end',
          update.value ?? '',
        );
      } else {
        next = { ...next, [field]: update.value ?? '' };
      }
      continue;
    }
    const stopMatch = /^stops\.(\d+)\.(name|locationText|arrivalDate|departureDate|localityKind|cityResolution)$/.exec(update.path);
    if (!stopMatch) continue;
    const index = Number(stopMatch[1]);
    const field = stopMatch[2] as keyof TripDraftStop;
    while (next.stops.length <= index) {
      next.stops.push({
        name: '',
        locationText: null,
        arrivalDate: null,
        departureDate: null,
        localityKind: 'UNKNOWN',
        cityResolution: 'UNRESOLVED',
      });
    }
    next.stops = next.stops.map((stop, stopIndex) =>
      stopIndex === index ? { ...stop, [field]: update.value } : stop,
    );
  }
  return next;
}

export function mergeTripDraft(
  current: TripInput,
  incomingDraft: TripDraft,
  protectedPaths: ReadonlySet<string>,
): TripInput {
  const incoming = draftToTripInput(incomingDraft);
  const merged: TripInput = {
    ...incoming,
    name: protectedPaths.has('trip.name') ? current.name : incoming.name,
    destinationArea: protectedPaths.has('trip.destinationArea')
      ? current.destinationArea
      : incoming.destinationArea,
    startDate: protectedPaths.has('trip.startDate') ? current.startDate : incoming.startDate,
    endDate: protectedPaths.has('trip.endDate') ? current.endDate : incoming.endDate,
    travelerCount: protectedPaths.has('trip.travelerCount')
      ? current.travelerCount
      : incoming.travelerCount,
    stops: incoming.stops.map((stop, index) => {
      const normalizedName = normalizedText(stop.name);
      const matchingNames = current.stops.filter((candidate) =>
        normalizedText(candidate.name) === normalizedName,
      );
      const draftIdMatch = stop.draftId
        ? current.stops.find((candidate) =>
            candidate.draftId === stop.draftId &&
            normalizedText(candidate.name) === normalizedName,
          )
        : undefined;
      const existing = matchingNames.length === 1
        ? matchingNames[0]
        : draftIdMatch ?? current.stops[index];
      if (!existing) return stop;
      const preserve = <K extends keyof TripDraftStop>(field: K): TripDraftStop[K] =>
        protectedPaths.has(`stops.${index}.${String(field)}`) ? existing[field] : stop[field];
      return {
        ...stop,
        name: preserve('name'),
        locationText: preserve('locationText'),
        arrivalDate: preserve('arrivalDate'),
        departureDate: preserve('departureDate'),
        localityKind: preserve('localityKind'),
        cityResolution: preserve('cityResolution'),
      };
    }),
  };
  return merged;
}

export function normalizedText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

export function followUpPathCue(path: string, answer: string, evidence = ''): boolean {
  if (path === 'trip.name') return /\b(?:name|call|title)\b/u.test(answer);
  if (path === 'trip.destinationArea') {
    return /\b(?:area|country|region|destination|trip\s+to)\b/u.test(answer);
  }
  if (path === 'trip.travelerCount') {
    return /\b(?:travell?ers?|people|persons?|guests?|of us)\b/u.test(answer);
  }
  const explicitNumericDateCorrection =
    /\b(?:change|move|make|set)\b.{0,80}\b(?:to|as)\b.{0,40}\b\d{1,2}\s*[\/.\-]\s*\d{1,2}(?:\s*[\/.\-]\s*\d{2,4})?\b/u.test(answer);
  const hasStartDirection = /\b(?:start|arriv|from)\w*\b/u.test(answer);
  const hasEndDirection = /\b(?:end|depart|leav|until|through)\w*\b/u.test(answer) ||
    hasStartDirection && /\bto\b/u.test(answer) ||
    /^to\b/u.test(answer);
  if (path === 'trip.startDate' || path.endsWith('.arrivalDate')) {
    if (hasEndDirection && !hasStartDirection) return false;
    if (explicitNumericDateCorrection) return true;
    return /\b(?:start|arriv|from|date|days?|nights?|weeks?|duration|tomorrow|today|friday|weekend)\b/u.test(answer) ||
      /\d/.test(answer) && /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/u.test(answer);
  }
  if (path === 'trip.endDate' || path.endsWith('.departureDate')) {
    if (hasStartDirection && !hasEndDirection) return false;
    if (explicitNumericDateCorrection) return true;
    return /\b(?:end|depart|leav|until|through|to|date|days?|nights?|weeks?|duration|tomorrow|today|friday|weekend)\b/u.test(answer) ||
      /\d/.test(answer) && /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/u.test(answer);
  }
  if (path.endsWith('.name')) {
    const plainAnswer = answer.replace(/[,.!?]/gu, ' ').replace(/\s+/g, ' ').trim();
    const dateLanguage = /\b(?:date|dates|day|days|night|nights|week|weeks|month|months|start|end|from|until|through)\b/u.test(answer);
    const monthOnlyEvidence = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\w*$/u.test(evidence);
    if (monthOnlyEvidence && dateLanguage) return false;
    if (/\b(?:city|destination|stop|place)\b/u.test(answer)) return true;
    if (/\b(?:go|going|head|heading|visit|visiting)\b/u.test(answer)) return true;
    if (evidence && (
      plainAnswer === `actually ${evidence}` ||
      plainAnswer.endsWith(` make it ${evidence}`) ||
      plainAnswer === `make it ${evidence}` ||
      plainAnswer === `${evidence} instead` ||
      /\b(?:change|replace|swap)\b/u.test(answer) && (
        plainAnswer.endsWith(` to ${evidence}`) ||
        plainAnswer.endsWith(` with ${evidence}`) ||
        plainAnswer.endsWith(` for ${evidence}`)
      )
    )) return true;
    return false;
  }
  return false;
}

export function explicitTripDraftPathsFromFollowUp(
  incomingDraft: TripDraft,
  latestAnswer: string,
  openQuestions: readonly TripClarificationQuestion[] = [],
): Set<string> {
  const answer = normalizedText(latestAnswer);
  const openPaths = new Set(openQuestions.flatMap((item) => item.fieldPaths));
  const explicitlyUpdated = new Set<string>();
  for (const question of openQuestions) {
    const prompt = normalizedText(question.prompt);
    const answersDateDurationChoice = (
      question.id === 'date-duration-conflict' ||
      /\bdates?\b/u.test(prompt) && /\bduration\b/u.test(prompt)
    ) && (
      /^(?:the\s+)?(?:dates?|duration|weekend|next weekend)$/u.test(answer) ||
      /\b(?:use|keep|prefer|trust|choose|take|follow|go with|stick with|ignore|drop)\b.{0,32}\b(?:dates?|duration|weekend)\b/u.test(answer) ||
      /\b(?:dates?|duration|weekend)\b.{0,24}\b(?:instead|please)\b/u.test(answer)
    );
    const matchesOption = question.options.some((option) => {
      const label = normalizedText(option.label);
      return answer === label || answer === `${label} please` ||
        /\b(?:use|choose|take|pick|select|go with)\b/u.test(answer) && answer.includes(label);
    });
    if (answersDateDurationChoice || matchesOption) {
      question.fieldPaths.forEach((path) => explicitlyUpdated.add(path));
    }
  }
  incomingDraft.fieldStates
    .filter((state) => {
        if (
          !state.evidence ||
          ['SUGGESTED', 'MISSING', 'NEEDS_ATTENTION', 'INVALID', 'CONFLICTING'].includes(state.status)
        ) {
          return false;
        }
        const evidence = normalizedText(state.evidence);
        if (!answer.includes(evidence)) return false;
        const shortDirectAnswer = openPaths.has(state.path) &&
          (answer === evidence || answer === `${evidence} please`);
        return shortDirectAnswer || followUpPathCue(state.path, answer, evidence);
    })
    .forEach((state) => explicitlyUpdated.add(state.path));
  for (const path of explicitlyUpdated) {
    const cityMatch = /^(stops\.\d+)\.name$/.exec(path);
    if (cityMatch) {
      explicitlyUpdated.add(`${cityMatch[1]}.locationText`);
      explicitlyUpdated.add(`${cityMatch[1]}.localityKind`);
      explicitlyUpdated.add(`${cityMatch[1]}.cityResolution`);
    }
  }
  return explicitlyUpdated;
}

export function protectedPathsAfterFollowUp(
  protectedPaths: ReadonlySet<string>,
  incomingDraft: TripDraft,
  latestAnswer: string,
  openQuestions: readonly TripClarificationQuestion[] = [],
): Set<string> {
  const explicitlyUpdated = explicitTripDraftPathsFromFollowUp(
    incomingDraft,
    latestAnswer,
    openQuestions,
  );
  return new Set([...protectedPaths].filter((path) => !explicitlyUpdated.has(path)));
}

export function mergeUnansweredClarificationQuestions(
  previousQuestions: readonly TripClarificationQuestion[],
  incomingQuestions: readonly TripClarificationQuestion[],
  explicitlyUpdatedPaths: ReadonlySet<string>,
): TripClarificationQuestion[] {
  const retained = previousQuestions.filter((question) =>
    !question.fieldPaths.some((path) => explicitlyUpdatedPaths.has(path)));
  const retainedIds = new Set(retained.map((question) => question.id));
  return [
    ...retained,
    ...incomingQuestions.filter((question) => !retainedIds.has(question.id)),
  ];
}

export function boundedExcerpt(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) return value;
  const separator = ' … ';
  const leadingLength = Math.ceil((maximumLength - separator.length) * 0.65);
  const trailingLength = maximumLength - separator.length - leadingLength;
  return `${value.slice(0, leadingLength)}${separator}${value.slice(-trailingLength)}`;
}

export function buildTripFollowUpPrompt(
  originalPrompt: string,
  current: TripInput,
  questions: readonly TripClarificationQuestion[],
  answer: string,
  protectedPaths: ReadonlySet<string> = new Set(),
  priorAnswers: readonly string[] = [],
  answerReferenceDate?: string,
  originalReferenceDate?: string,
): string {
  const confirmed: Record<string, unknown> = {};
  const readPath = (path: string): unknown => {
    const tripMatch = /^trip\.(name|destinationArea|startDate|endDate|travelerCount)$/.exec(path);
    if (tripMatch) return current[tripMatch[1] as keyof Pick<TripInput, 'name' | 'destinationArea' | 'startDate' | 'endDate' | 'travelerCount'>];
    const stopMatch = /^stops\.(\d+)\.(name|locationText|arrivalDate|departureDate|localityKind|cityResolution)$/.exec(path);
    if (!stopMatch) return undefined;
    return current.stops[Number(stopMatch[1])]?.[stopMatch[2] as keyof TripDraftStop];
  };
  for (const path of protectedPaths) {
    const value = readPath(path);
    if (value !== undefined) confirmed[path] = value;
  }
  return [
    'This is a follow-up to a new-trip creation draft.',
    `Original request${originalReferenceDate ? ` (local date ${originalReferenceDate})` : ''}: ${boundedExcerpt(originalPrompt, 3_500)}`,
    `Earlier user follow-ups: ${boundedExcerpt(priorAnswers.slice(-4).join(' | ') || 'none', 900)}`,
    `Manually confirmed fields: ${boundedExcerpt(JSON.stringify(confirmed), 900)}`,
    `Still unresolved: ${boundedExcerpt(questions.map((item) => item.prompt).join(' | ') || 'none', 700)}`,
    `User follow-up${answerReferenceDate ? ` (local date ${answerReferenceDate})` : ''}: ${answer.slice(0, 1_500)}`,
    'Interpret the complete conversation. Keep confirmed details unless the latest follow-up explicitly changes them.',
  ].join('\n');
}
