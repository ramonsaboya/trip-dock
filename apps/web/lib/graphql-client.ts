export type TripStop = {
  id: string;
  tripId: string;
  name: string;
  locationText: string | null;
  position: number;
  arrivalDate: string | null;
  departureDate: string | null;
};

export type TransportLeg = {
  id: string;
  tripId: string;
  fromStopId: string;
  toStopId: string;
  position: number;
  mode: string;
  title: string;
  details: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  timezone: string | null;
};

export type Stay = {
  id: string;
  tripId: string;
  stopId: string;
  position: number;
  name: string;
  checkIn: string | null;
  checkOut: string | null;
  timezone: string | null;
};

export type Activity = {
  id: string;
  tripId: string;
  stopId: string;
  position: number;
  title: string;
  status: 'IDEA' | 'PLANNED' | 'BOOKED' | 'DONE';
  scheduledAt: string | null;
  timezone: string | null;
};

export type Trip = {
  id: string;
  name: string;
  destinationArea: string;
  startDate: string;
  endDate: string;
  travelerCount: number | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  stops: TripStop[];
  transportLegs: TransportLeg[];
  stays: Stay[];
  activities: Activity[];
};

export type TripDraftStop = {
  draftId?: string;
  name: string;
  locationText: string | null;
  arrivalDate: string | null;
  departureDate: string | null;
  localityKind?: 'CITY' | 'COUNTRY' | 'REGION' | 'PREFERENCE' | 'AMBIGUOUS' | 'UNKNOWN';
  cityResolution?: 'RESOLVED' | 'SUGGESTED' | 'AMBIGUOUS' | 'UNRESOLVED';
};

export type TripDraftFieldStatus =
  | 'EXPLICIT'
  | 'INTERPRETED'
  | 'SUGGESTED'
  | 'CONFIRMED'
  | 'MISSING'
  | 'NEEDS_ATTENTION'
  | 'INVALID'
  | 'CONFLICTING'
  | 'PAST';

export type TripDraftFieldState = {
  path: string;
  status: TripDraftFieldStatus;
  evidence: string | null;
  message: string | null;
  blocking: boolean;
};

export type TripClarificationUpdate = { path: string; value: string | null };

export type TripClarificationOption = {
  id: string;
  label: string;
  updates: TripClarificationUpdate[];
};

export type TripClarificationQuestion = {
  id: string;
  fieldPaths: string[];
  prompt: string;
  options: TripClarificationOption[];
  allowFreeText: boolean;
  blocking: boolean;
};

export type TripDraft = {
  name: string;
  destinationArea: string;
  startDate: string | null;
  endDate: string | null;
  travelerCount: number | null;
  stops: TripDraftStop[];
  assumptions: string[];
  warnings: string[];
  fieldStates: TripDraftFieldState[];
  questions: TripClarificationQuestion[];
  minimumViable: boolean;
  referenceDate: string;
  locale: string;
  timeZone: string;
};

export type GenerateTripDraftInput = {
  prompt: string;
  locale: string;
  timeZone: string;
  referenceDate: string;
};

export type TripInput = {
  name: string;
  destinationArea: string;
  startDate: string;
  endDate: string;
  travelerCount: number | null;
  stops: TripDraftStop[];
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string; [key: string]: unknown } }>;
};

export class TripDockGraphQLError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    code = 'GRAPHQL_ERROR',
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'TripDockGraphQLError';
    this.code = code;
    this.details = details;
  }
}

export async function graphqlRequest<TData, TVariables extends Record<string, unknown>>(
  query: string,
  variables: TVariables,
  signal?: AbortSignal,
): Promise<TData> {
  const endpoint =
    process.env.NEXT_PUBLIC_GRAPHQL_URL ?? 'http://localhost:4000/graphql';
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new TripDockGraphQLError(
      'TripDock could not connect. Check that the app services are running, then retry.',
      'NETWORK_ERROR',
    );
  }
  if (!response.ok) {
    throw new TripDockGraphQLError(
      `TripDock returned HTTP ${response.status}.`,
      'HTTP_ERROR',
      { status: response.status },
    );
  }
  const payload = (await response.json()) as GraphQLResponse<TData>;
  const firstError = payload.errors?.[0];
  if (firstError) {
    const { code = 'GRAPHQL_ERROR', ...details } = firstError.extensions ?? {};
    throw new TripDockGraphQLError(firstError.message, code, details);
  }
  if (!payload.data) {
    throw new TripDockGraphQLError('TripDock returned no data.', 'EMPTY_RESPONSE');
  }
  return payload.data;
}

const TRIP_FIELDS = `
  id name destinationArea startDate endDate travelerCount revision createdAt updatedAt
  stops { id tripId name locationText position arrivalDate departureDate }
  transportLegs {
    id tripId fromStopId toStopId position mode title details
    departureTime arrivalTime timezone
  }
  stays { id tripId stopId position name checkIn checkOut timezone }
  activities { id tripId stopId position title status scheduledAt timezone }
`;

export const operations = {
  trips: `query Trips { trips { ${TRIP_FIELDS} } }`,
  trip: `query Trip($id: ID!) { trip(id: $id) { ${TRIP_FIELDS} } }`,
  createTrip: `mutation CreateTrip($input: CreateTripInput!) { createTrip(input: $input) { ${TRIP_FIELDS} } }`,
  updateTrip: `mutation UpdateTrip($id: ID!, $expectedRevision: Int!, $input: UpdateTripInput!) {
    updateTrip(id: $id, expectedRevision: $expectedRevision, input: $input) { ${TRIP_FIELDS} }
  }`,
  deleteTrip: `mutation DeleteTrip($id: ID!, $expectedRevision: Int!) {
    deleteTrip(id: $id, expectedRevision: $expectedRevision)
  }`,
  addStop: `mutation AddStop($tripId: ID!, $expectedRevision: Int!, $input: TripStopInput!, $moveTripEnd: Boolean) {
    addTripStop(tripId: $tripId, expectedRevision: $expectedRevision, input: $input, moveTripEnd: $moveTripEnd) { ${TRIP_FIELDS} }
  }`,
  updateStop: `mutation UpdateStop($id: ID!, $expectedRevision: Int!, $input: TripStopInput!) {
    updateTripStop(id: $id, expectedRevision: $expectedRevision, input: $input) { ${TRIP_FIELDS} }
  }`,
  removeStop: `mutation RemoveStop($id: ID!, $expectedRevision: Int!) {
    removeTripStop(id: $id, expectedRevision: $expectedRevision) { ${TRIP_FIELDS} }
  }`,
  reorderStops: `mutation ReorderStops($tripId: ID!, $expectedRevision: Int!, $stopIds: [ID!]!) {
    reorderTripStops(tripId: $tripId, expectedRevision: $expectedRevision, stopIds: $stopIds) { ${TRIP_FIELDS} }
  }`,
  addTransport: `mutation AddTransport($tripId: ID!, $expectedRevision: Int!, $input: TransportLegInput!) {
    addTransportLeg(tripId: $tripId, expectedRevision: $expectedRevision, input: $input) { ${TRIP_FIELDS} }
  }`,
  updateTransport: `mutation UpdateTransport($id: ID!, $expectedRevision: Int!, $input: TransportLegInput!) {
    updateTransportLeg(id: $id, expectedRevision: $expectedRevision, input: $input) { ${TRIP_FIELDS} }
  }`,
  removeTransport: `mutation RemoveTransport($id: ID!, $expectedRevision: Int!) {
    removeTransportLeg(id: $id, expectedRevision: $expectedRevision) { ${TRIP_FIELDS} }
  }`,
  addStay: `mutation AddStay($tripId: ID!, $expectedRevision: Int!, $input: StayInput!) {
    addStay(tripId: $tripId, expectedRevision: $expectedRevision, input: $input) { ${TRIP_FIELDS} }
  }`,
  updateStay: `mutation UpdateStay($id: ID!, $expectedRevision: Int!, $input: StayInput!) {
    updateStay(id: $id, expectedRevision: $expectedRevision, input: $input) { ${TRIP_FIELDS} }
  }`,
  removeStay: `mutation RemoveStay($id: ID!, $expectedRevision: Int!) {
    removeStay(id: $id, expectedRevision: $expectedRevision) { ${TRIP_FIELDS} }
  }`,
  addActivity: `mutation AddActivity($tripId: ID!, $expectedRevision: Int!, $input: ActivityInput!) {
    addActivity(tripId: $tripId, expectedRevision: $expectedRevision, input: $input) { ${TRIP_FIELDS} }
  }`,
  updateActivity: `mutation UpdateActivity($id: ID!, $expectedRevision: Int!, $input: ActivityInput!) {
    updateActivity(id: $id, expectedRevision: $expectedRevision, input: $input) { ${TRIP_FIELDS} }
  }`,
  removeActivity: `mutation RemoveActivity($id: ID!, $expectedRevision: Int!) {
    removeActivity(id: $id, expectedRevision: $expectedRevision) { ${TRIP_FIELDS} }
  }`,
  generateDraft: `mutation GenerateDraft($input: GenerateTripDraftInput!) {
    generateTripDraft(input: $input) {
      name destinationArea startDate endDate travelerCount assumptions warnings
      minimumViable referenceDate locale timeZone
      stops { draftId name locationText arrivalDate departureDate localityKind cityResolution }
      fieldStates { path status evidence message blocking }
      questions {
        id fieldPaths prompt allowFreeText blocking
        options { id label updates { path value } }
      }
    }
  }`,
} as const;

export function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
  const month = (date: Date) =>
    date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  if (sameMonth) {
    return `${start.getUTCDate()}–${end.getUTCDate()} ${month(end)} ${end.getUTCFullYear()}`;
  }
  if (sameYear) {
    return `${start.getUTCDate()} ${month(start)}–${end.getUTCDate()} ${month(end)} ${end.getUTCFullYear()}`;
  }
  return `${start.getUTCDate()} ${month(start)} ${start.getUTCFullYear()}–${end.getUTCDate()} ${month(end)} ${end.getUTCFullYear()}`;
}

export function formatDateTime(value: string | null, timezone: string | null): string {
  if (!value) return 'Timing not set';
  try {
    const formatted = new Date(value).toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone ?? undefined,
    });
    return timezone ? `${formatted} · ${timezone}` : formatted;
  } catch {
    return `${new Date(value).toLocaleString('en-GB')} · Invalid timezone: ${timezone}`;
  }
}

function zonedParts(value: Date, timezone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}

export function isoToDateTimeLocal(value: string | null, timezone: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!timezone) {
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  let parts: Record<string, string>;
  try {
    parts = zonedParts(date, timezone);
  } catch {
    throw new RangeError(`Use a valid IANA timezone instead of “${timezone}”.`);
  }
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function dateTimeLocalToIso(value: string | null, timezone: string | null): string | null {
  if (!value) return null;
  if (!timezone) return new Date(value).toISOString();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new RangeError('Use a valid local date and time.');
  const desired = match.slice(1).map(Number);
  const desiredUtc = Date.UTC(desired[0]!, desired[1]! - 1, desired[2]!, desired[3]!, desired[4]!);
  let candidate = desiredUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let parts: Record<string, string>;
    try {
      parts = zonedParts(new Date(candidate), timezone);
    } catch {
      throw new RangeError(`Use a valid IANA timezone instead of “${timezone}”.`);
    }
    const represented = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute),
    );
    candidate += desiredUtc - represented;
  }
  const resolved = isoToDateTimeLocal(new Date(candidate).toISOString(), timezone);
  if (resolved !== value) {
    throw new RangeError(`That local time does not exist in ${timezone}.`);
  }
  return new Date(candidate).toISOString();
}

export function dateTimeLocalToIsoPreserving(
  value: string | null,
  timezone: string | null,
  originalIso: string | null,
): string | null {
  if (originalIso && isoToDateTimeLocal(originalIso, timezone) === value) return originalIso;
  return dateTimeLocalToIso(value, timezone);
}

export function stayDateTimesForStop(
  stop: Pick<TripStop, 'arrivalDate' | 'departureDate'> | undefined,
): { checkIn: string | null; checkOut: string | null } {
  return {
    checkIn: stop?.arrivalDate ? `${stop.arrivalDate}T15:00` : null,
    checkOut: stop?.departureDate
      ? `${stop.departureDate}T${stop.departureDate === stop.arrivalDate ? '17:00' : '11:00'}`
      : null,
  };
}

export function transportDateTimesForStops(
  fromStop: Pick<TripStop, 'arrivalDate' | 'departureDate'> | undefined,
  toStop: Pick<TripStop, 'arrivalDate' | 'departureDate'> | undefined,
): { departureTime: string | null; arrivalTime: string | null } {
  const departureDate = fromStop?.departureDate ?? fromStop?.arrivalDate;
  const destinationDate = toStop?.arrivalDate ?? toStop?.departureDate;
  const arrivalDate = departureDate && destinationDate && destinationDate < departureDate
    ? departureDate
    : destinationDate;
  return {
    departureTime: departureDate ? `${departureDate}T09:00` : null,
    arrivalTime: arrivalDate ? `${arrivalDate}T17:00` : null,
  };
}

export function activityDateTimeForStop(
  stop: Pick<TripStop, 'arrivalDate' | 'departureDate'> | undefined,
): string | null {
  const date = stop?.arrivalDate ?? stop?.departureDate;
  return date ? `${date}T09:00` : null;
}

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

function isRealIsoDate(value: string): boolean {
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

export function remapTripDraftPathAfterStopRemoval(
  path: string,
  removedIndex: number,
): string | null {
  const match = /^stops\.(\d+)\.(.+)$/.exec(path);
  if (!match) return path;
  const stopIndex = Number(match[1]);
  if (stopIndex === removedIndex) return null;
  return stopIndex > removedIndex ? `stops.${stopIndex - 1}.${match[2]}` : path;
}

export function remapDirtyTripDraftPaths(
  paths: ReadonlySet<string>,
  previousStops: readonly TripDraftStop[],
  nextStops: readonly TripDraftStop[],
): Set<string> {
  const indexMap = new Map<number, number>();
  const claimedNextIndices = new Set<number>();
  const uniqueNextIndex = (predicate: (stop: TripDraftStop) => boolean) => {
    const matches = nextStops.flatMap((stop, index) => predicate(stop) ? [index] : []);
    return matches.length === 1 ? matches[0]! : null;
  };
  previousStops.forEach((stop, previousIndex) => {
    let nextIndex = stop.draftId
      ? uniqueNextIndex((candidate) => candidate.draftId === stop.draftId)
      : null;
    const normalizedName = normalizedText(stop.name);
    if (nextIndex === null && normalizedName) {
      nextIndex = uniqueNextIndex((candidate) => normalizedText(candidate.name) === normalizedName);
    }
    if (
      nextIndex === null &&
      previousStops.length === nextStops.length &&
      nextStops[previousIndex] &&
      !claimedNextIndices.has(previousIndex)
    ) {
      nextIndex = previousIndex;
    }
    if (nextIndex !== null && !claimedNextIndices.has(nextIndex)) {
      indexMap.set(previousIndex, nextIndex);
      claimedNextIndices.add(nextIndex);
    }
  });

  return new Set([...paths].flatMap((path) => {
    const match = /^stops\.(\d+)(\..+)$/.exec(path);
    if (!match) return [path];
    const nextIndex = indexMap.get(Number(match[1]));
    return nextIndex === undefined ? [] : [`stops.${nextIndex}${match[2]}`];
  }));
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

function remapIncomingStopPath(
  path: string,
  incomingToAlignedIndex: ReadonlyMap<number, number>,
): string {
  const match = /^stops\.(\d+)(\..+)?$/.exec(path);
  if (!match) return path;
  const alignedIndex = incomingToAlignedIndex.get(Number(match[1]));
  return alignedIndex === undefined ? path : `stops.${alignedIndex}${match[2] ?? ''}`;
}

function explicitlyRemovesStop(
  latestAnswer: string,
  stopName: string,
  stopIndex: number,
): boolean {
  const answer = normalizedText(latestAnswer);
  if (!answer) return false;
  const deletionMatches = [...answer.matchAll(/\b(?:remove|delete|drop|skip|omit)\b/gu)];
  const affirmativeMatches = deletionMatches.filter((match) => {
    const prefix = answer.slice(Math.max(0, match.index! - 24), match.index!);
    return !/\b(?:do\s+not|don['’]?t|never|without|not\s+to)\s*$/u.test(prefix);
  });
  if (!affirmativeMatches.length) return false;
  const nameIndex = answer.indexOf(stopName);
  if (nameIndex >= 0 && affirmativeMatches.some((match) => {
    const verbIndex = match.index!;
    const between = answer.slice(
      Math.min(verbIndex + match[0].length, nameIndex),
      Math.max(verbIndex, nameIndex + stopName.length),
    );
    return Math.abs(verbIndex - nameIndex) <= 48 && !/[,.!?;]/u.test(between);
  })) return true;
  const positions = [
    ['first', '1st'],
    ['second', '2nd'],
    ['third', '3rd'],
    ['fourth', '4th'],
    ['fifth', '5th'],
  ][stopIndex] ?? [];
  return affirmativeMatches.length > 0 && positions.some((position) =>
    answer.includes(`${position} destination`) ||
    answer.includes(`${position} stop`) ||
    answer.includes(`${position} city`),
  );
}

export function alignIncomingTripDraftStops(
  current: TripInput,
  incoming: TripDraft,
  latestAnswer = '',
  openQuestions: readonly TripClarificationQuestion[] = [],
): TripDraft {
  const currentNames = current.stops.map((stop) => normalizedText(stop.name));
  const incomingNames = incoming.stops.map((stop) => normalizedText(stop.name));
  if (
    currentNames.some((name) => !name) ||
    incomingNames.some((name) => !name) ||
    new Set(currentNames).size !== currentNames.length ||
    new Set(incomingNames).size !== incomingNames.length
  ) {
    return incoming;
  }
  const incomingIndexByName = new Map(
    incomingNames.map((name, index) => [name, index] as const),
  );
  const currentNameSet = new Set(currentNames);
  const missingCurrent = currentNames.filter((name) => !incomingIndexByName.has(name));
  const incomingOnly = incomingNames.filter((name) => !currentNameSet.has(name));
  const answer = normalizedText(latestAnswer);
  const oneForOneCandidate = missingCurrent.length > 0 &&
    missingCurrent.length === incomingOnly.length &&
    current.stops.length === incoming.stops.length &&
    incomingOnly.every((name) => answer.includes(name));
  const replacementCue =
    /\b(?:change|replace|swap|go|going|head|heading|visit|visiting|make|actually|instead)\b/u;
  const openCityPaths = new Set(
    openQuestions.flatMap((question) => question.fieldPaths.filter((path) => path.endsWith('.name'))),
  );
  const directOpenCityAnswer = incoming.fieldStates.some((state) =>
    openCityPaths.has(state.path) &&
    state.path.endsWith('.name') &&
    state.evidence &&
    (answer === normalizedText(state.evidence) || answer === `${normalizedText(state.evidence)} please`),
  );
  const replacesMissingSet = oneForOneCandidate &&
    (replacementCue.test(answer) || directOpenCityAnswer);
  const sameCitySet = missingCurrent.length === 0 && incomingOnly.length === 0;
  const orderChanged = sameCitySet && incomingNames.some((name, index) => name !== currentNames[index]);
  const mentionedPositions = incomingNames.map((name) => answer.indexOf(name));
  const mentionsIncomingOrder = mentionedPositions.every((position) => position >= 0) &&
    mentionedPositions.every((position, index) => index === 0 || position > mentionedPositions[index - 1]!);
  const statesIncomingPairwiseOrder = incomingNames.some((earlierName, earlierIndex) =>
    incomingNames.slice(earlierIndex + 1).some((laterName) => {
      const earlierPosition = answer.indexOf(earlierName);
      const laterPosition = answer.indexOf(laterName);
      if (earlierPosition < 0 || laterPosition < 0) return false;
      if (earlierPosition < laterPosition) {
        const between = answer.slice(earlierPosition + earlierName.length, laterPosition);
        return /\b(?:before|then)\b/u.test(between);
      }
      const between = answer.slice(laterPosition + laterName.length, earlierPosition);
      return /\bafter\b/u.test(between);
    }),
  );
  const explicitOrderCue = /\b(?:first|then|last|before|after|order|reorder|route|reverse|visit|visiting)\b/u
    .test(answer);
  const explicitlyReorders = orderChanged && (
    /\breverse(?:\s+the)?\s+(?:trip|route|order)\b/u.test(answer) ||
    explicitOrderCue && (mentionsIncomingOrder || statesIncomingPairwiseOrder)
  );
  const removedNames = new Set(missingCurrent.filter((name) => {
    const currentIndex = currentNames.indexOf(name);
    return explicitlyRemovesStop(latestAnswer, name, currentIndex) || replacesMissingSet;
  }));

  const allMissingExplicitlyRemoved = missingCurrent.length > 0 &&
    missingCurrent.every((name) => removedNames.has(name));
  const targetNames = sameCitySet
    ? [...(explicitlyReorders ? incomingNames : currentNames)]
    : missingCurrent.length === 0 || allMissingExplicitlyRemoved
      ? [...incomingNames]
      : [...currentNames.filter((name) => !removedNames.has(name)), ...incomingOnly];
  if (!targetNames.length) return incoming;

  const incomingToAlignedIndex = new Map<number, number>();
  targetNames.forEach((name, alignedIndex) => {
    const incomingIndex = incomingIndexByName.get(name);
    if (incomingIndex !== undefined) incomingToAlignedIndex.set(incomingIndex, alignedIndex);
  });
  const remap = (path: string) => remapIncomingStopPath(path, incomingToAlignedIndex);
  const currentIndexByName = new Map(
    currentNames.map((name, index) => [name, index] as const),
  );
  const currentDraftIds = new Set(
    current.stops.flatMap((stop) => stop.draftId ? [stop.draftId] : []),
  );
  const stops = targetNames.map((name) => {
    const currentIndex = currentIndexByName.get(name);
    const incomingIndex = incomingIndexByName.get(name);
    if (incomingIndex === undefined) return { ...current.stops[currentIndex!]! };
    const stop = incoming.stops[incomingIndex]!;
    if (currentIndex !== undefined) {
      return { ...stop, draftId: current.stops[currentIndex]?.draftId };
    }
    return {
      ...stop,
      draftId: stop.draftId && !currentDraftIds.has(stop.draftId) ? stop.draftId : undefined,
    };
  });
  const suggestedName = incoming.fieldStates.some((state) =>
    state.path === 'trip.name' && state.status === 'SUGGESTED',
  );
  const firstResolvedCity = stops.find((stop) =>
    stop.localityKind === 'CITY' && stop.cityResolution === 'RESOLVED' && stop.name.trim(),
  );
  return {
    ...incoming,
    name: suggestedName && firstResolvedCity ? `Trip to ${firstResolvedCity.name.trim()}` : incoming.name,
    stops,
    fieldStates: incoming.fieldStates.map((state) => ({
      ...state,
      path: remap(state.path),
    })),
    questions: incoming.questions.map((question) => ({
      ...question,
      fieldPaths: question.fieldPaths.map(remap),
      options: question.options.map((option) => ({
        ...option,
        updates: option.updates.map((update) => ({
          ...update,
          path: remap(update.path),
        })),
      })),
    })),
  };
}

export function remapCurrentTripDraftPathToIncoming(
  current: TripInput,
  incoming: TripDraft,
  path: string,
  latestAnswer = '',
): string | null {
  const match = /^stops\.(\d+)(\..+)?$/.exec(path);
  if (!match) return path;
  const currentStop = current.stops[Number(match[1])];
  if (!currentStop) return null;
  const name = normalizedText(currentStop.name);
  if (!name) return path;
  const matches = incoming.stops.flatMap((stop, index) =>
    normalizedText(stop.name) === name ? [index] : [],
  );
  if (matches.length !== 1) {
    const answer = normalizedText(latestAnswer);
    const isOneForOneReplacement = current.stops.length === incoming.stops.length &&
      Number(match[1]) < incoming.stops.length &&
      /\b(?:change|replace|swap)\b/u.test(answer);
    if (isOneForOneReplacement) return path;
    return explicitlyRemovesStop(latestAnswer, name, Number(match[1])) ? null : path;
  }
  return `stops.${matches[0]}${match[2] ?? ''}`;
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

function normalizedText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function followUpPathCue(path: string, answer: string, evidence = ''): boolean {
  if (path === 'trip.name') return /\b(?:name|call|title)\b/u.test(answer);
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

export function localIsoDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function boundedExcerpt(value: string, maximumLength: number): string {
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
    const tripMatch = /^trip\.(name|startDate|endDate|travelerCount)$/.exec(path);
    if (tripMatch) return current[tripMatch[1] as keyof Pick<TripInput, 'name' | 'startDate' | 'endDate' | 'travelerCount'>];
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

export function updateTripBoundaryDate(
  input: TripInput,
  boundary: 'start' | 'end',
  date: string,
  options: { stopDateDirty?: boolean } = {},
): TripInput {
  const dateKey = boundary === 'start' ? 'startDate' : 'endDate';
  const stopKey = boundary === 'start' ? 'arrivalDate' : 'departureDate';
  const stopIndex = boundary === 'start' ? 0 : input.stops.length - 1;
  const previousDate = input[dateKey];
  return {
    ...input,
    [dateKey]: date,
    stops: input.stops.map((stop, index) =>
      index === stopIndex &&
      !options.stopDateDirty &&
      (!stop[stopKey] || stop[stopKey] === previousDate)
        ? { ...stop, [stopKey]: date || null }
        : stop,
    ),
  };
}

export function updateTripStopDate(
  input: TripInput,
  index: number,
  field: 'arrivalDate' | 'departureDate',
  date: string | null,
  options: { nextArrivalDirty?: boolean; tripBoundaryDirty?: boolean } = {},
): TripInput {
  const previousDate = input.stops[index]?.[field] ?? null;
  const next: TripInput = {
    ...input,
    stops: input.stops.map((stop, stopIndex) =>
      stopIndex === index
        ? { ...stop, [field]: date }
        : field === 'departureDate' &&
            stopIndex === index + 1 &&
            !options.nextArrivalDirty &&
            (!stop.arrivalDate || stop.arrivalDate === previousDate)
          ? { ...stop, arrivalDate: date }
          : stop,
    ),
  };
  if (index === 0 && field === 'arrivalDate' && date && !options.tripBoundaryDirty) {
    next.startDate = date;
  }
  if (
    index === input.stops.length - 1 &&
    field === 'departureDate' &&
    date &&
    !options.tripBoundaryDirty
  ) {
    next.endDate = date;
  }
  return next;
}

export function appendTripStop(
  input: TripInput,
  options: { lastDepartureDirty?: boolean } = {},
): TripInput {
  const previous = input.stops.at(-1);
  const movesLinkedTripEnd = Boolean(
    previous &&
    input.endDate &&
    !options.lastDepartureDirty &&
    previous.departureDate === input.endDate,
  );
  return {
    ...input,
    stops: [
      ...input.stops.map((stop, index) =>
        movesLinkedTripEnd && index === input.stops.length - 1
          ? { ...stop, departureDate: null }
          : stop,
      ),
      {
        name: '',
        locationText: null,
        arrivalDate: movesLinkedTripEnd ? null : previous?.departureDate ?? null,
        departureDate: input.endDate || null,
      },
    ],
  };
}

export function removeTripStop(
  input: TripInput,
  index: number,
  options: { preserveTripEnd?: boolean; survivingDepartureDirty?: boolean } = {},
): TripInput {
  const removed = input.stops[index];
  let stops = input.stops.filter((_, stopIndex) => stopIndex !== index);
  const removedLinkedStart = index === 0 && removed?.arrivalDate === input.startDate;
  const removedLinkedEnd = index === input.stops.length - 1 && removed?.departureDate === input.endDate;
  if (
    removedLinkedEnd &&
    stops.length &&
    !options.survivingDepartureDirty &&
    !stops.at(-1)?.departureDate
  ) {
    stops = stops.map((stop, stopIndex) =>
      stopIndex === stops.length - 1 ? { ...stop, departureDate: input.endDate || null } : stop,
    );
  }
  return {
    ...input,
    stops,
    startDate: removedLinkedStart ? stops[0]?.arrivalDate ?? input.startDate : input.startDate,
    endDate: removedLinkedEnd && !options.preserveTripEnd
      ? stops.at(-1)?.departureDate ?? input.endDate
      : input.endDate,
  };
}

export function destinationAreaFromStops(input: Pick<TripInput, 'name' | 'stops'>): string {
  const names = input.stops.map((stop) => stop.name.trim()).filter(Boolean);
  return (names.join(' · ') || input.name.trim() || 'Trip').slice(0, 200);
}

export function sortStopsByDate<T extends Pick<TripStop, 'arrivalDate' | 'departureDate' | 'position'>>(
  stops: readonly T[],
): T[] {
  return [...stops].sort((left, right) => {
    const leftDate = left.arrivalDate ?? left.departureDate;
    const rightDate = right.arrivalDate ?? right.departureDate;
    if (leftDate && rightDate && leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    if (leftDate && !rightDate) return -1;
    if (!leftDate && rightDate) return 1;
    const leftEnd = left.departureDate ?? left.arrivalDate;
    const rightEnd = right.departureDate ?? right.arrivalDate;
    if (leftEnd && rightEnd && leftEnd !== rightEnd) return leftEnd.localeCompare(rightEnd);
    if (leftEnd && !rightEnd) return -1;
    if (!leftEnd && rightEnd) return 1;
    return left.position - right.position;
  });
}
