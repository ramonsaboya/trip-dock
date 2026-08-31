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

export type ProposalOperation = {
  id: string;
  proposalId: string;
  position: number;
  operationType: 'UPDATE_TRIP' | 'ADD_ACTIVITY' | 'UPDATE_ACTIVITY' | 'REMOVE_ACTIVITY';
  description: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'APPLIED' | 'EXCLUDED';
};

export type Proposal = {
  id: string;
  tripId: string;
  prompt: string;
  summary: string;
  status: 'PENDING' | 'APPLIED' | 'DISCARDED' | 'STALE';
  baseTripRevision: number;
  model: string;
  openaiResponseId: string | null;
  schemaVersion: string;
  promptVersion: string;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
  discardedAt: string | null;
  operations: ProposalOperation[];
};

export type Trip = {
  id: string;
  name: string;
  destinationArea: string;
  startDate: string;
  endDate: string;
  travelerCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  stops: TripStop[];
  transportLegs: TransportLeg[];
  stays: Stay[];
  activities: Activity[];
  proposals: Proposal[];
};

export type TripDraftStop = {
  name: string;
  locationText: string | null;
  arrivalDate: string | null;
  departureDate: string | null;
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
};

export type TripInput = {
  name: string;
  destinationArea: string;
  startDate: string;
  endDate: string;
  travelerCount: number;
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
      'TripDock could not reach the local API. Start PostgreSQL and the API, then retry.',
      'NETWORK_ERROR',
    );
  }
  if (!response.ok) {
    throw new TripDockGraphQLError(
      `The local API returned HTTP ${response.status}.`,
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
    throw new TripDockGraphQLError('The local API returned no data.', 'EMPTY_RESPONSE');
  }
  return payload.data;
}

const PROPOSAL_FIELDS = `
  id tripId prompt summary status baseTripRevision model openaiResponseId
  schemaVersion promptVersion createdAt updatedAt appliedAt discardedAt
  operations { id proposalId position operationType description payload status }
`;

const TRIP_FIELDS = `
  id name destinationArea startDate endDate travelerCount revision createdAt updatedAt
  stops { id tripId name locationText position arrivalDate departureDate }
  transportLegs {
    id tripId fromStopId toStopId position mode title details
    departureTime arrivalTime timezone
  }
  stays { id tripId stopId position name checkIn checkOut timezone }
  activities { id tripId stopId position title status scheduledAt timezone }
  proposals { ${PROPOSAL_FIELDS} }
`;

export const operations = {
  trips: `query Trips { trips { ${TRIP_FIELDS} } }`,
  trip: `query Trip($id: ID!) { trip(id: $id) { ${TRIP_FIELDS} } }`,
  proposal: `query Proposal($id: ID!) { proposal(id: $id) { ${PROPOSAL_FIELDS} } }`,
  createTrip: `mutation CreateTrip($input: CreateTripInput!) { createTrip(input: $input) { ${TRIP_FIELDS} } }`,
  updateTrip: `mutation UpdateTrip($id: ID!, $expectedRevision: Int!, $input: UpdateTripInput!) {
    updateTrip(id: $id, expectedRevision: $expectedRevision, input: $input) { ${TRIP_FIELDS} }
  }`,
  deleteTrip: `mutation DeleteTrip($id: ID!, $expectedRevision: Int!) {
    deleteTrip(id: $id, expectedRevision: $expectedRevision)
  }`,
  addStop: `mutation AddStop($tripId: ID!, $expectedRevision: Int!, $input: TripStopInput!) {
    addTripStop(tripId: $tripId, expectedRevision: $expectedRevision, input: $input) { ${TRIP_FIELDS} }
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
  generateDraft: `mutation GenerateDraft($prompt: String!) {
    generateTripDraft(prompt: $prompt) {
      name destinationArea startDate endDate travelerCount assumptions warnings
      stops { name locationText arrivalDate departureDate }
    }
  }`,
  prepareProposal: `mutation PrepareProposal($tripId: ID!, $prompt: String!) {
    prepareTripProposal(tripId: $tripId, prompt: $prompt) { ${PROPOSAL_FIELDS} }
  }`,
  applyProposal: `mutation ApplyProposal($proposalId: ID!, $includedOperationIds: [ID!]!) {
    applyTripProposal(proposalId: $proposalId, includedOperationIds: $includedOperationIds) { ${TRIP_FIELDS} }
  }`,
  discardProposal: `mutation DiscardProposal($proposalId: ID!) {
    discardTripProposal(proposalId: $proposalId) { ${PROPOSAL_FIELDS} }
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

export function draftToTripInput(draft: TripDraft): TripInput {
  return {
    name: draft.name,
    destinationArea: draft.destinationArea,
    startDate: draft.startDate ?? '',
    endDate: draft.endDate ?? '',
    travelerCount: draft.travelerCount ?? 2,
    stops: draft.stops.map((stop) => ({ ...stop })),
  };
}

export function toggleSelectedOperation(
  current: ReadonlySet<string>,
  operationId: string,
): Set<string> {
  const next = new Set(current);
  if (next.has(operationId)) next.delete(operationId);
  else next.add(operationId);
  return next;
}
