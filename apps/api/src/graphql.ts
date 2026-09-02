import { createSchema, createYoga } from 'graphql-yoga';
import { GraphQLError, GraphQLScalarType, Kind } from 'graphql';
import { and, asc, eq, inArray, max, ne, sql } from 'drizzle-orm';
import { z, ZodError } from 'zod';

import {
  AI_PROMPT_VERSION,
  AI_SCHEMA_VERSION,
  type AiGateway,
  type TripAiContext,
} from './ai.js';
import { loadProposal, loadTrip, loadTrips, type TripView } from './data.js';
import type { AppDatabase } from './db/client.js';
import {
  activities,
  aiProposalOperations,
  aiProposals,
  stays,
  transportLegs,
  trips,
  tripStops,
} from './db/schema.js';
import {
  activityStatusSchema,
  AppError,
  compareStopsByDate,
  isoDateSchema,
  isoDateTimeSchema,
  proposalOperationSchema,
  timezoneSchema,
  tripDraftStopSchema,
  validateDateRange,
  type DatedStop,
  type ProposalOperation,
} from './domain.js';

const typeDefs = /* GraphQL */ `
  scalar JSON

  type Query {
    trips: [Trip!]!
    trip(id: ID!): Trip
    proposal(id: ID!): AiProposal
  }

  type Mutation {
    createTrip(input: CreateTripInput!): Trip!
    updateTrip(id: ID!, expectedRevision: Int!, input: UpdateTripInput!): Trip!
    deleteTrip(id: ID!, expectedRevision: Int!): Boolean!

    addTripStop(tripId: ID!, expectedRevision: Int!, input: TripStopInput!): Trip!
    updateTripStop(id: ID!, expectedRevision: Int!, input: TripStopInput!): Trip!
    removeTripStop(id: ID!, expectedRevision: Int!): Trip!
    reorderTripStops(tripId: ID!, expectedRevision: Int!, stopIds: [ID!]!): Trip!
      @deprecated(reason: "Destinations are ordered automatically by date.")

    addTransportLeg(tripId: ID!, expectedRevision: Int!, input: TransportLegInput!): Trip!
    updateTransportLeg(id: ID!, expectedRevision: Int!, input: TransportLegInput!): Trip!
    removeTransportLeg(id: ID!, expectedRevision: Int!): Trip!

    addStay(tripId: ID!, expectedRevision: Int!, input: StayInput!): Trip!
    updateStay(id: ID!, expectedRevision: Int!, input: StayInput!): Trip!
    removeStay(id: ID!, expectedRevision: Int!): Trip!

    addActivity(tripId: ID!, expectedRevision: Int!, input: ActivityInput!): Trip!
    updateActivity(id: ID!, expectedRevision: Int!, input: ActivityInput!): Trip!
    removeActivity(id: ID!, expectedRevision: Int!): Trip!

    generateTripDraft(prompt: String!): TripDraft!
    prepareTripProposal(tripId: ID!, prompt: String!): AiProposal!
    applyTripProposal(proposalId: ID!, includedOperationIds: [ID!]!): Trip!
    discardTripProposal(proposalId: ID!): AiProposal!
  }

  type Trip {
    id: ID!
    name: String!
    destinationArea: String!
    startDate: String!
    endDate: String!
    travelerCount: Int!
    revision: Int!
    createdAt: String!
    updatedAt: String!
    stops: [TripStop!]!
    transportLegs: [TransportLeg!]!
    stays: [Stay!]!
    activities: [Activity!]!
    proposals: [AiProposal!]!
  }

  type TripStop {
    id: ID!
    tripId: ID!
    name: String!
    locationText: String
    position: Int!
    arrivalDate: String
    departureDate: String
    createdAt: String!
    updatedAt: String!
  }

  type TransportLeg {
    id: ID!
    tripId: ID!
    fromStopId: ID!
    toStopId: ID!
    position: Int!
    mode: String!
    title: String!
    details: String
    departureTime: String
    arrivalTime: String
    timezone: String
    createdAt: String!
    updatedAt: String!
  }

  type Stay {
    id: ID!
    tripId: ID!
    stopId: ID!
    position: Int!
    name: String!
    checkIn: String
    checkOut: String
    timezone: String
    createdAt: String!
    updatedAt: String!
  }

  type Activity {
    id: ID!
    tripId: ID!
    stopId: ID!
    position: Int!
    title: String!
    status: String!
    scheduledAt: String
    timezone: String
    createdAt: String!
    updatedAt: String!
  }

  type AiProposal {
    id: ID!
    tripId: ID!
    prompt: String!
    summary: String!
    status: String!
    baseTripRevision: Int!
    model: String!
    openaiResponseId: String
    schemaVersion: String!
    promptVersion: String!
    createdAt: String!
    updatedAt: String!
    appliedAt: String
    discardedAt: String
    operations: [AiProposalOperation!]!
  }

  type AiProposalOperation {
    id: ID!
    proposalId: ID!
    position: Int!
    operationType: String!
    description: String!
    payload: JSON!
    status: String!
    createdAt: String!
    updatedAt: String!
  }

  type TripDraft {
    name: String!
    destinationArea: String!
    startDate: String
    endDate: String
    travelerCount: Int
    stops: [TripDraftStop!]!
    assumptions: [String!]!
    warnings: [String!]!
  }

  type TripDraftStop {
    name: String!
    locationText: String
    arrivalDate: String
    departureDate: String
  }

  input CreateTripInput {
    name: String!
    destinationArea: String!
    startDate: String
    endDate: String
    travelerCount: Int!
    stops: [TripStopDraftInput!]!
  }

  input UpdateTripInput {
    name: String!
    destinationArea: String!
    startDate: String!
    endDate: String!
    travelerCount: Int!
  }

  input TripStopDraftInput {
    name: String!
    locationText: String
    arrivalDate: String
    departureDate: String
  }

  input TripStopInput {
    name: String!
    locationText: String
    arrivalDate: String
    departureDate: String
  }

  input TransportLegInput {
    fromStopId: ID!
    toStopId: ID!
    mode: String!
    title: String!
    details: String
    departureTime: String
    arrivalTime: String
    timezone: String
  }

  input StayInput {
    stopId: ID!
    name: String!
    checkIn: String
    checkOut: String
    timezone: String
  }

  input ActivityInput {
    stopId: ID!
    title: String!
    status: String!
    scheduledAt: String
    timezone: String
  }
`;

const jsonScalar = new GraphQLScalarType({
  name: 'JSON',
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING || ast.kind === Kind.BOOLEAN) return ast.value;
    if (ast.kind === Kind.INT || ast.kind === Kind.FLOAT) return Number(ast.value);
    if (ast.kind === Kind.NULL) return null;
    return null;
  },
});

const requiredText = z.string().trim().min(1).max(240);
const nullableText = z.string().trim().min(1).max(500).nullable();
const revisionSchema = z.number().int().min(0);
const idSchema = z.string().uuid();

const createTripInputSchema = z
  .object({
    name: requiredText.max(160),
    destinationArea: requiredText.max(200),
    startDate: isoDateSchema.nullish(),
    endDate: isoDateSchema.nullish(),
    travelerCount: z.number().int().min(1).max(20),
    stops: z.array(tripDraftStopSchema).min(1).max(20),
  })
  .strict();

const updateTripInputSchema = z
  .object({
    name: requiredText.max(160),
    destinationArea: requiredText.max(200),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    travelerCount: z.number().int().min(1).max(20),
  })
  .strict();
const stopInputSchema = tripDraftStopSchema;
const transportInputSchema = z
  .object({
    fromStopId: idSchema,
    toStopId: idSchema,
    mode: requiredText.max(60),
    title: requiredText.max(200),
    details: nullableText,
    departureTime: isoDateTimeSchema.nullable(),
    arrivalTime: isoDateTimeSchema.nullable(),
    timezone: timezoneSchema,
  })
  .strict();
const stayInputSchema = z
  .object({
    stopId: idSchema,
    name: requiredText.max(200),
    checkIn: isoDateTimeSchema.nullable(),
    checkOut: isoDateTimeSchema.nullable(),
    timezone: timezoneSchema,
  })
  .strict();
const activityInputSchema = z
  .object({
    stopId: idSchema,
    title: requiredText.max(200),
    status: activityStatusSchema,
    scheduledAt: isoDateTimeSchema.nullable(),
    timezone: timezoneSchema,
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(result.error.issues[0]?.message ?? 'Invalid input.', 'BAD_USER_INPUT');
  }
  return result.data;
}

function toGraphQLError(error: unknown): never {
  if (error instanceof GraphQLError) throw error;
  if (error instanceof ZodError) {
    throw new GraphQLError(error.issues[0]?.message ?? 'Invalid input.', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
  if (error instanceof AppError) {
    throw new GraphQLError(error.message, {
      extensions: { code: error.code, ...error.details },
    });
  }
  throw error;
}

async function handle<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    return toGraphQLError(error);
  }
}

type DbTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

async function lockTrip(
  tx: DbTransaction,
  tripId: string,
  expectedRevision: number,
): Promise<typeof trips.$inferSelect> {
  const [trip] = await tx
    .select()
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1)
    .for('update');
  if (!trip) throw new AppError('Trip not found.', 'NOT_FOUND');
  if (trip.revision !== expectedRevision) {
    throw new AppError('This trip changed in another request. Refresh and try again.', 'REVISION_CONFLICT', {
      currentRevision: trip.revision,
    });
  }
  return trip;
}

async function finishManualMutation(
  tx: DbTransaction,
  tripId: string,
  revision: number,
): Promise<void> {
  const now = new Date().toISOString();
  await tx
    .update(trips)
    .set({ revision: revision + 1, updatedAt: now })
    .where(and(eq(trips.id, tripId), eq(trips.revision, revision)));
  await tx
    .update(aiProposals)
    .set({ status: 'STALE', updatedAt: now })
    .where(and(eq(aiProposals.tripId, tripId), eq(aiProposals.status, 'PENDING')));
}

async function assertStopsBelong(
  tx: DbTransaction,
  tripId: string,
  stopIds: string[],
): Promise<void> {
  if (new Set(stopIds).size !== stopIds.length) {
    throw new AppError('Stop identifiers must be unique.', 'BAD_USER_INPUT');
  }
  const found = await tx
    .select({ id: tripStops.id })
    .from(tripStops)
    .where(and(eq(tripStops.tripId, tripId), inArray(tripStops.id, stopIds)));
  if (found.length !== stopIds.length) {
    throw new AppError('Every referenced stop must belong to this trip.', 'BAD_USER_INPUT');
  }
}

function validateTimestampRange(start: string | null, end: string | null, label: string): void {
  if (start && end && new Date(end).getTime() < new Date(start).getTime()) {
    throw new AppError(`The ${label} ends before it starts.`, 'BAD_USER_INPUT');
  }
}

function orderStopsByDate<T extends DatedStop>(stops: T[]): T[] {
  return [...stops].sort(compareStopsByDate);
}

function withLinkedTripBoundaryDates<T extends DatedStop>(
  stops: T[],
  oldStartDate: string | null,
  oldEndDate: string | null,
  newStartDate: string,
  newEndDate: string,
): T[] {
  const ordered = stops.map((stop) => ({ ...stop }));
  const first = ordered[0];
  const last = ordered.at(-1);
  if (!first || !last) {
    throw new AppError('A trip must keep at least one destination.', 'BAD_USER_INPUT');
  }
  if (!first.arrivalDate || first.arrivalDate === oldStartDate) {
    first.arrivalDate = newStartDate;
  }
  if (!last.departureDate || last.departureDate === oldEndDate) {
    last.departureDate = newEndDate;
  }
  return ordered;
}

function validateStopsWithinTrip(
  stops: DatedStop[],
  startDate: string,
  endDate: string,
  errorCode: 'BAD_USER_INPUT' | 'AI_INVALID_OUTPUT' = 'BAD_USER_INPUT',
): void {
  validateDateRange(startDate, endDate, 'trip date range');
  for (const stop of stops) {
    try {
      validateDateRange(stop.arrivalDate, stop.departureDate, 'destination date range');
    } catch (error) {
      if (errorCode === 'AI_INVALID_OUTPUT') {
        throw new AppError('The proposed trip creates an invalid destination date range.', errorCode);
      }
      throw error;
    }
    for (const date of [stop.arrivalDate, stop.departureDate]) {
      if (date && (date < startDate || date > endDate)) {
        throw new AppError(
          errorCode === 'AI_INVALID_OUTPUT'
            ? 'The proposed trip dates exclude an existing destination date.'
            : 'A destination date falls outside the trip dates.',
          errorCode,
        );
      }
    }
  }
}

async function orderedTripStops(tx: DbTransaction, tripId: string) {
  const rows = await tx.select().from(tripStops).where(eq(tripStops.tripId, tripId));
  return orderStopsByDate(rows);
}

async function resequenceTripStops(
  tx: DbTransaction,
  tripId: string,
  ordered: Array<typeof tripStops.$inferSelect>,
): Promise<void> {
  if (ordered.every((stop, position) => stop.position === position)) return;
  await tx
    .update(tripStops)
    .set({ position: sql`${tripStops.position} + ${ordered.length}` })
    .where(eq(tripStops.tripId, tripId));
  for (const [position, stop] of ordered.entries()) {
    await tx.update(tripStops).set({ position }).where(eq(tripStops.id, stop.id));
  }
}

async function synchronizeStopsFromTripDates(
  tx: DbTransaction,
  trip: typeof trips.$inferSelect,
  startDate: string,
  endDate: string,
): Promise<void> {
  const current = await orderedTripStops(tx, trip.id);
  const linked = withLinkedTripBoundaryDates(
    current,
    trip.startDate,
    trip.endDate,
    startDate,
    endDate,
  );
  validateStopsWithinTrip(linked, startDate, endDate);
  const currentFirst = current[0]!;
  const currentLast = current.at(-1)!;
  const linkedFirst = linked[0]!;
  const linkedLast = linked.at(-1)!;
  const now = new Date().toISOString();
  if (currentFirst.arrivalDate !== linkedFirst.arrivalDate) {
    await tx
      .update(tripStops)
      .set({ arrivalDate: linkedFirst.arrivalDate, updatedAt: now })
      .where(eq(tripStops.id, linkedFirst.id));
  }
  if (currentLast.departureDate !== linkedLast.departureDate) {
    await tx
      .update(tripStops)
      .set({ departureDate: linkedLast.departureDate, updatedAt: now })
      .where(eq(tripStops.id, linkedLast.id));
  }
  await resequenceTripStops(tx, trip.id, linked);
}

async function persistStopChronology(
  tx: DbTransaction,
  trip: typeof trips.$inferSelect,
  startDate = trip.startDate,
  endDate = trip.endDate,
): Promise<Array<typeof tripStops.$inferSelect>> {
  const ordered = await orderedTripStops(tx, trip.id);
  validateStopsWithinTrip(ordered, startDate, endDate);
  await resequenceTripStops(tx, trip.id, ordered);
  if (startDate !== trip.startDate || endDate !== trip.endDate) {
    await tx
      .update(trips)
      .set({ startDate, endDate, updatedAt: new Date().toISOString() })
      .where(eq(trips.id, trip.id));
  }
  return ordered;
}

function buildAiContext(trip: TripView): TripAiContext {
  return {
    id: trip.id,
    revision: trip.revision,
    name: trip.name,
    destinationArea: trip.destinationArea,
    startDate: trip.startDate,
    endDate: trip.endDate,
    travelerCount: trip.travelerCount,
    stops: trip.stops.map(({ id, name, position }) => ({ id, name, position })),
    activities: trip.activities.map(
      ({ id, stopId, title, status, scheduledAt, timezone }) => ({
        id,
        stopId,
        title,
        status,
        scheduledAt,
        timezone,
      }),
    ),
  };
}

function calendarDateForTimestamp(value: string, timezone: string | null): string {
  const date = new Date(value);
  if (!timezone) return date.toISOString().slice(0, 10);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function validateActivitySchedule(
  trip: TripView,
  stopId: string,
  scheduledAt: string | null,
  timezone: string | null,
): void {
  if (!scheduledAt) return;
  const date = calendarDateForTimestamp(scheduledAt, timezone);
  if (date < trip.startDate || date > trip.endDate) {
    throw new AppError('A proposed activity falls outside the trip dates.', 'AI_INVALID_OUTPUT');
  }
  const stop = trip.stops.find((item) => item.id === stopId);
  if (!stop) throw new AppError('The proposal references a stop outside this trip.', 'AI_INVALID_OUTPUT');
  if (
    (stop.arrivalDate && date < stop.arrivalDate) ||
    (stop.departureDate && date > stop.departureDate)
  ) {
    throw new AppError('A proposed activity falls outside its destination dates.', 'AI_INVALID_OUTPUT');
  }
}

function validateProposalSemantics(trip: TripView, operations: ProposalOperation[]): void {
  const stopIds = new Set(trip.stops.map((stop) => stop.id));
  const activityIds = new Set(trip.activities.map((activity) => activity.id));
  const targeted = new Set<string>();
  let updatesTrip = false;
  for (const operation of operations) {
    if (operation.type === 'UPDATE_TRIP') {
      if (updatesTrip) {
        throw new AppError('A proposal may update trip essentials only once.', 'AI_INVALID_OUTPUT');
      }
      updatesTrip = true;
      validateDateRange(operation.payload.startDate, operation.payload.endDate, 'trip date range');
      const boundedStops = withLinkedTripBoundaryDates(
        orderStopsByDate(trip.stops),
        trip.startDate,
        trip.endDate,
        operation.payload.startDate,
        operation.payload.endDate,
      );
      validateStopsWithinTrip(
        boundedStops,
        operation.payload.startDate,
        operation.payload.endDate,
        'AI_INVALID_OUTPUT',
      );
      for (const activity of trip.activities) {
        if (!activity.scheduledAt) continue;
        const date = calendarDateForTimestamp(activity.scheduledAt, activity.timezone);
        if (date < operation.payload.startDate || date > operation.payload.endDate) {
          throw new AppError('The proposed trip dates exclude an existing activity.', 'AI_INVALID_OUTPUT');
        }
      }
      continue;
    }
    if (operation.type === 'ADD_ACTIVITY') {
      if (!stopIds.has(operation.payload.stopId)) {
        throw new AppError('The proposal references a stop outside this trip.', 'AI_INVALID_OUTPUT');
      }
      validateActivitySchedule(
        trip,
        operation.payload.stopId,
        operation.payload.scheduledAt,
        operation.payload.timezone,
      );
      continue;
    }
    const activityId = operation.payload.activityId;
    if (!activityIds.has(activityId)) {
      throw new AppError('The proposal references an activity outside this trip.', 'AI_INVALID_OUTPUT');
    }
    if (targeted.has(activityId)) {
      throw new AppError('The proposal changes the same activity more than once.', 'AI_INVALID_OUTPUT');
    }
    targeted.add(activityId);
    if (operation.type === 'UPDATE_ACTIVITY' && !stopIds.has(operation.payload.stopId)) {
      throw new AppError('The proposal moves an activity to a stop outside this trip.', 'AI_INVALID_OUTPUT');
    }
    if (operation.type === 'UPDATE_ACTIVITY') {
      validateActivitySchedule(
        trip,
        operation.payload.stopId,
        operation.payload.scheduledAt,
        operation.payload.timezone,
      );
    }
  }
}

async function applyProposalOperation(
  tx: DbTransaction,
  tripId: string,
  operation: ProposalOperation,
): Promise<void> {
  const now = new Date().toISOString();
  if (operation.type === 'UPDATE_TRIP') {
    validateDateRange(operation.payload.startDate, operation.payload.endDate, 'trip date range');
    const [trip] = await tx.select().from(trips).where(eq(trips.id, tripId)).limit(1);
    if (!trip) throw new AppError('Trip not found.', 'NOT_FOUND');
    await synchronizeStopsFromTripDates(tx, trip, operation.payload.startDate, operation.payload.endDate);
    await tx.update(trips).set({ ...operation.payload, updatedAt: now }).where(eq(trips.id, tripId));
    return;
  }
  if (operation.type === 'ADD_ACTIVITY') {
    await assertStopsBelong(tx, tripId, [operation.payload.stopId]);
    const [positionRow] = await tx
      .select({ value: max(activities.position) })
      .from(activities)
      .where(and(eq(activities.tripId, tripId), eq(activities.stopId, operation.payload.stopId)));
    await tx.insert(activities).values({
      tripId,
      position: (positionRow?.value ?? -1) + 1,
      ...operation.payload,
    });
    return;
  }
  const [existing] = await tx
    .select()
    .from(activities)
    .where(and(eq(activities.id, operation.payload.activityId), eq(activities.tripId, tripId)))
    .limit(1);
  if (!existing) throw new AppError('A proposed activity no longer exists.', 'STALE_PROPOSAL');
  if (operation.type === 'REMOVE_ACTIVITY') {
    await tx.delete(activities).where(eq(activities.id, operation.payload.activityId));
    return;
  }
  await assertStopsBelong(tx, tripId, [operation.payload.stopId]);
  const { activityId: _activityId, ...values } = operation.payload;
  let position = existing.position;
  if (values.stopId !== existing.stopId) {
    const [positionRow] = await tx
      .select({ value: max(activities.position) })
      .from(activities)
      .where(eq(activities.stopId, values.stopId));
    position = (positionRow?.value ?? -1) + 1;
  }
  await tx.update(activities).set({ ...values, position, updatedAt: now }).where(eq(activities.id, existing.id));
}

function buildResolvers(db: AppDatabase, aiGateway: AiGateway) {
  return {
    JSON: jsonScalar,
    Query: {
      trips: () => handle(() => loadTrips(db)),
      trip: (_root: unknown, args: { id: string }) =>
        handle(async () => loadTrip(db, parse(idSchema, args.id))),
      proposal: (_root: unknown, args: { id: string }) =>
        handle(async () => loadProposal(db, parse(idSchema, args.id))),
    },
    Mutation: {
      createTrip: (_root: unknown, args: { input: unknown }) =>
        handle(async () => {
          const input = parse(createTripInputSchema, args.input);
          const enteredStops = input.stops.map((stop, position) => {
            const previous = position > 0 ? input.stops[position - 1] : undefined;
            return {
              ...stop,
              position,
              arrivalDate: stop.arrivalDate ?? previous?.departureDate ?? null,
            };
          });
          const chronologicallyOrdered = orderStopsByDate(enteredStops);
          const startDate = input.startDate ?? chronologicallyOrdered[0]?.arrivalDate;
          const endDate = input.endDate ?? chronologicallyOrdered.at(-1)?.departureDate;
          if (!startDate) {
            throw new AppError(
              'Provide either a trip start date or an arrival date for the first destination.',
              'BAD_USER_INPUT',
            );
          }
          if (!endDate) {
            throw new AppError(
              'Provide either a trip end date or a departure date for the last destination.',
              'BAD_USER_INPUT',
            );
          }
          const linkedEnteredStops = withLinkedTripBoundaryDates(
            enteredStops,
            null,
            null,
            startDate,
            endDate,
          );
          const preparedStops = withLinkedTripBoundaryDates(
            orderStopsByDate(linkedEnteredStops),
            null,
            null,
            startDate,
            endDate,
          ).map((stop, position) => ({ ...stop, position }));
          validateStopsWithinTrip(preparedStops, startDate, endDate);
          const tripId = await db.transaction(async (tx) => {
            const [trip] = await tx
              .insert(trips)
              .values({
                name: input.name,
                destinationArea: input.destinationArea,
                startDate,
                endDate,
                travelerCount: input.travelerCount,
              })
              .returning({ id: trips.id });
            if (!trip) throw new Error('Trip insert did not return an identifier.');
            await tx.insert(tripStops).values(
              preparedStops.map(({ position, ...stop }) => ({
                tripId: trip.id,
                position,
                ...stop,
              })),
            );
            return trip.id;
          });
          const created = await loadTrip(db, tripId);
          if (!created) throw new Error('Created trip could not be loaded.');
          return created;
        }),
      updateTrip: (
        _root: unknown,
        args: { id: string; expectedRevision: number; input: unknown },
      ) =>
        handle(async () => {
          const id = parse(idSchema, args.id);
          const expectedRevision = parse(revisionSchema, args.expectedRevision);
          const input = parse(updateTripInputSchema, args.input);
          validateDateRange(input.startDate, input.endDate, 'trip date range');
          await db.transaction(async (tx) => {
            const trip = await lockTrip(tx, id, expectedRevision);
            await synchronizeStopsFromTripDates(tx, trip, input.startDate, input.endDate);
            await tx.update(trips).set({ ...input, updatedAt: new Date().toISOString() }).where(eq(trips.id, id));
            await finishManualMutation(tx, id, trip.revision);
          });
          const updated = await loadTrip(db, id);
          if (!updated) throw new AppError('Trip not found.', 'NOT_FOUND');
          return updated;
        }),
      deleteTrip: (
        _root: unknown,
        args: { id: string; expectedRevision: number },
      ) =>
        handle(async () => {
          const id = parse(idSchema, args.id);
          const expectedRevision = parse(revisionSchema, args.expectedRevision);
          await db.transaction(async (tx) => {
            await lockTrip(tx, id, expectedRevision);
            await tx.delete(trips).where(eq(trips.id, id));
          });
          return true;
        }),
      addTripStop: (
        _root: unknown,
        args: { tripId: string; expectedRevision: number; input: unknown },
      ) =>
        handle(async () => {
          const tripId = parse(idSchema, args.tripId);
          const expectedRevision = parse(revisionSchema, args.expectedRevision);
          const input = parse(stopInputSchema, args.input);
          await db.transaction(async (tx) => {
            const trip = await lockTrip(tx, tripId, expectedRevision);
            const currentStops = await orderedTripStops(tx, tripId);
            const previous = currentStops.at(-1);
            const stop = {
              ...input,
              arrivalDate: input.arrivalDate ?? previous?.departureDate ?? null,
            };
            validateDateRange(stop.arrivalDate, stop.departureDate, 'destination date range');
            const [positionRow] = await tx
              .select({ value: max(tripStops.position) })
              .from(tripStops)
              .where(eq(tripStops.tripId, tripId));
            const [inserted] = await tx
              .insert(tripStops)
              .values({
                tripId,
                position: (positionRow?.value ?? -1) + 1,
                ...stop,
              })
              .returning();
            if (!inserted) throw new Error('Destination insert did not return a row.');
            const ordered = await orderedTripStops(tx, tripId);
            const startDate = ordered[0]?.id === inserted.id && inserted.arrivalDate
              ? inserted.arrivalDate
              : trip.startDate;
            const endDate = ordered.at(-1)?.id === inserted.id && inserted.departureDate
              ? inserted.departureDate
              : trip.endDate;
            await persistStopChronology(tx, trip, startDate, endDate);
            await finishManualMutation(tx, tripId, trip.revision);
          });
          return (await loadTrip(db, tripId))!;
        }),
      updateTripStop: (
        _root: unknown,
        args: { id: string; expectedRevision: number; input: unknown },
      ) =>
        handle(async () => {
          const id = parse(idSchema, args.id);
          const expectedRevision = parse(revisionSchema, args.expectedRevision);
          const input = parse(stopInputSchema, args.input);
          validateDateRange(input.arrivalDate, input.departureDate, 'stop date range');
          const [stop] = await db.select().from(tripStops).where(eq(tripStops.id, id)).limit(1);
          if (!stop) throw new AppError('Stop not found.', 'NOT_FOUND');
          await db.transaction(async (tx) => {
            const trip = await lockTrip(tx, stop.tripId, expectedRevision);
            const before = await orderedTripStops(tx, stop.tripId);
            const existing = before.find((item) => item.id === id);
            if (!existing) throw new AppError('Stop not found.', 'NOT_FOUND');
            const previousFirst = before[0]!;
            const previousLast = before.at(-1)!;
            const changedArrival = input.arrivalDate !== existing.arrivalDate;
            const changedDeparture = input.departureDate !== existing.departureDate;
            await tx.update(tripStops).set({ ...input, updatedAt: new Date().toISOString() }).where(eq(tripStops.id, id));
            const after = await orderedTripStops(tx, stop.tripId);
            const nextFirst = after[0]!;
            const nextLast = after.at(-1)!;
            let startDate = trip.startDate;
            let endDate = trip.endDate;
            if (changedArrival && input.arrivalDate && nextFirst.id === id) {
              startDate = input.arrivalDate;
            } else if (
              previousFirst.id === id &&
              previousFirst.arrivalDate === trip.startDate &&
              nextFirst.id !== id &&
              nextFirst.arrivalDate
            ) {
              startDate = nextFirst.arrivalDate;
            }
            if (changedDeparture && input.departureDate && nextLast.id === id) {
              endDate = input.departureDate;
            } else if (
              previousLast.id === id &&
              previousLast.departureDate === trip.endDate &&
              nextLast.id !== id &&
              nextLast.departureDate
            ) {
              endDate = nextLast.departureDate;
            }
            await persistStopChronology(tx, trip, startDate, endDate);
            await finishManualMutation(tx, stop.tripId, trip.revision);
          });
          return (await loadTrip(db, stop.tripId))!;
        }),
      removeTripStop: (
        _root: unknown,
        args: { id: string; expectedRevision: number },
      ) =>
        handle(async () => {
          const id = parse(idSchema, args.id);
          const expectedRevision = parse(revisionSchema, args.expectedRevision);
          const [stop] = await db.select().from(tripStops).where(eq(tripStops.id, id)).limit(1);
          if (!stop) throw new AppError('Stop not found.', 'NOT_FOUND');
          await db.transaction(async (tx) => {
            const trip = await lockTrip(tx, stop.tripId, expectedRevision);
            const before = await orderedTripStops(tx, stop.tripId);
            if (before.length <= 1) {
              throw new AppError('A trip must keep at least one stop.', 'BAD_USER_INPUT');
            }
            const previousFirst = before[0]!;
            const previousLast = before.at(-1)!;
            await tx.delete(tripStops).where(eq(tripStops.id, id));
            const after = await orderedTripStops(tx, stop.tripId);
            const nextFirst = after[0]!;
            const nextLast = after.at(-1)!;
            const startDate = previousFirst.id === id &&
              previousFirst.arrivalDate === trip.startDate &&
              nextFirst.arrivalDate
              ? nextFirst.arrivalDate
              : trip.startDate;
            const endDate = previousLast.id === id &&
              previousLast.departureDate === trip.endDate &&
              nextLast.departureDate
              ? nextLast.departureDate
              : trip.endDate;
            await persistStopChronology(tx, trip, startDate, endDate);
            await finishManualMutation(tx, stop.tripId, trip.revision);
          });
          return (await loadTrip(db, stop.tripId))!;
        }),
      reorderTripStops: (
        _root: unknown,
        args: { tripId: string; expectedRevision: number; stopIds: string[] },
      ) =>
        handle(async () => {
          const tripId = parse(idSchema, args.tripId);
          const expectedRevision = parse(revisionSchema, args.expectedRevision);
          const stopIds = parse(z.array(idSchema).min(1).max(20), args.stopIds);
          await db.transaction(async (tx) => {
            const trip = await lockTrip(tx, tripId, expectedRevision);
            const current = await tx.select().from(tripStops).where(eq(tripStops.tripId, tripId));
            if (
              new Set(stopIds).size !== stopIds.length ||
              stopIds.length !== current.length ||
              current.some(({ id }) => !stopIds.includes(id))
            ) {
              throw new AppError('The new order must contain every stop exactly once.', 'BAD_USER_INPUT');
            }
            await resequenceTripStops(tx, tripId, orderStopsByDate(current));
            await finishManualMutation(tx, tripId, trip.revision);
          });
          return (await loadTrip(db, tripId))!;
        }),
      addTransportLeg: (
        _root: unknown,
        args: { tripId: string; expectedRevision: number; input: unknown },
      ) =>
        handle(async () => {
          const tripId = parse(idSchema, args.tripId);
          const expectedRevision = parse(revisionSchema, args.expectedRevision);
          const input = parse(transportInputSchema, args.input);
          if (input.fromStopId === input.toStopId) {
            throw new AppError('Transport must connect two different stops.', 'BAD_USER_INPUT');
          }
          validateTimestampRange(input.departureTime, input.arrivalTime, 'transport timing');
          await db.transaction(async (tx) => {
            const trip = await lockTrip(tx, tripId, expectedRevision);
            await assertStopsBelong(tx, tripId, [input.fromStopId, input.toStopId]);
            const [positionRow] = await tx.select({ value: max(transportLegs.position) }).from(transportLegs).where(eq(transportLegs.tripId, tripId));
            await tx.insert(transportLegs).values({ tripId, position: (positionRow?.value ?? -1) + 1, ...input });
            await finishManualMutation(tx, tripId, trip.revision);
          });
          return (await loadTrip(db, tripId))!;
        }),
      updateTransportLeg: (
        _root: unknown,
        args: { id: string; expectedRevision: number; input: unknown },
      ) =>
        handle(async () => {
          const id = parse(idSchema, args.id);
          const expectedRevision = parse(revisionSchema, args.expectedRevision);
          const input = parse(transportInputSchema, args.input);
          if (input.fromStopId === input.toStopId) throw new AppError('Transport must connect two different stops.', 'BAD_USER_INPUT');
          validateTimestampRange(input.departureTime, input.arrivalTime, 'transport timing');
          const [leg] = await db.select().from(transportLegs).where(eq(transportLegs.id, id)).limit(1);
          if (!leg) throw new AppError('Transport leg not found.', 'NOT_FOUND');
          await db.transaction(async (tx) => {
            const trip = await lockTrip(tx, leg.tripId, expectedRevision);
            await assertStopsBelong(tx, leg.tripId, [input.fromStopId, input.toStopId]);
            await tx.update(transportLegs).set({ ...input, updatedAt: new Date().toISOString() }).where(eq(transportLegs.id, id));
            await finishManualMutation(tx, leg.tripId, trip.revision);
          });
          return (await loadTrip(db, leg.tripId))!;
        }),
      removeTransportLeg: (
        _root: unknown,
        args: { id: string; expectedRevision: number },
      ) =>
        handle(async () => {
          const id = parse(idSchema, args.id);
          const expectedRevision = parse(revisionSchema, args.expectedRevision);
          const [leg] = await db.select().from(transportLegs).where(eq(transportLegs.id, id)).limit(1);
          if (!leg) throw new AppError('Transport leg not found.', 'NOT_FOUND');
          await db.transaction(async (tx) => {
            const trip = await lockTrip(tx, leg.tripId, expectedRevision);
            await tx.delete(transportLegs).where(eq(transportLegs.id, id));
            await finishManualMutation(tx, leg.tripId, trip.revision);
          });
          return (await loadTrip(db, leg.tripId))!;
        }),
      addStay: (
        _root: unknown,
        args: { tripId: string; expectedRevision: number; input: unknown },
      ) =>
        handle(async () => {
          const tripId = parse(idSchema, args.tripId);
          const expectedRevision = parse(revisionSchema, args.expectedRevision);
          const input = parse(stayInputSchema, args.input);
          validateTimestampRange(input.checkIn, input.checkOut, 'stay');
          await db.transaction(async (tx) => {
            const trip = await lockTrip(tx, tripId, expectedRevision);
            await assertStopsBelong(tx, tripId, [input.stopId]);
            const [positionRow] = await tx.select({ value: max(stays.position) }).from(stays).where(and(eq(stays.tripId, tripId), eq(stays.stopId, input.stopId)));
            await tx.insert(stays).values({ tripId, position: (positionRow?.value ?? -1) + 1, ...input });
            await finishManualMutation(tx, tripId, trip.revision);
          });
          return (await loadTrip(db, tripId))!;
        }),
      updateStay: (
        _root: unknown,
        args: { id: string; expectedRevision: number; input: unknown },
      ) =>
        handle(async () => {
          const id = parse(idSchema, args.id);
          const expectedRevision = parse(revisionSchema, args.expectedRevision);
          const input = parse(stayInputSchema, args.input);
          validateTimestampRange(input.checkIn, input.checkOut, 'stay');
          const [stay] = await db.select().from(stays).where(eq(stays.id, id)).limit(1);
          if (!stay) throw new AppError('Stay not found.', 'NOT_FOUND');
          await db.transaction(async (tx) => {
            const trip = await lockTrip(tx, stay.tripId, expectedRevision);
            await assertStopsBelong(tx, stay.tripId, [input.stopId]);
            let position = stay.position;
            if (input.stopId !== stay.stopId) {
              const [positionRow] = await tx
                .select({ value: max(stays.position) })
                .from(stays)
                .where(eq(stays.stopId, input.stopId));
              position = (positionRow?.value ?? -1) + 1;
            }
            await tx.update(stays).set({ ...input, position, updatedAt: new Date().toISOString() }).where(eq(stays.id, id));
            await finishManualMutation(tx, stay.tripId, trip.revision);
          });
          return (await loadTrip(db, stay.tripId))!;
        }),
      removeStay: (
        _root: unknown,
        args: { id: string; expectedRevision: number },
      ) =>
        handle(async () => {
          const id = parse(idSchema, args.id);
          const expectedRevision = parse(revisionSchema, args.expectedRevision);
          const [stay] = await db.select().from(stays).where(eq(stays.id, id)).limit(1);
          if (!stay) throw new AppError('Stay not found.', 'NOT_FOUND');
          await db.transaction(async (tx) => {
            const trip = await lockTrip(tx, stay.tripId, expectedRevision);
            await tx.delete(stays).where(eq(stays.id, id));
            await finishManualMutation(tx, stay.tripId, trip.revision);
          });
          return (await loadTrip(db, stay.tripId))!;
        }),
      addActivity: (
        _root: unknown,
        args: { tripId: string; expectedRevision: number; input: unknown },
      ) =>
        handle(async () => {
          const tripId = parse(idSchema, args.tripId);
          const expectedRevision = parse(revisionSchema, args.expectedRevision);
          const input = parse(activityInputSchema, args.input);
          await db.transaction(async (tx) => {
            const trip = await lockTrip(tx, tripId, expectedRevision);
            await assertStopsBelong(tx, tripId, [input.stopId]);
            const [positionRow] = await tx.select({ value: max(activities.position) }).from(activities).where(and(eq(activities.tripId, tripId), eq(activities.stopId, input.stopId)));
            await tx.insert(activities).values({ tripId, position: (positionRow?.value ?? -1) + 1, ...input });
            await finishManualMutation(tx, tripId, trip.revision);
          });
          return (await loadTrip(db, tripId))!;
        }),
      updateActivity: (
        _root: unknown,
        args: { id: string; expectedRevision: number; input: unknown },
      ) =>
        handle(async () => {
          const id = parse(idSchema, args.id);
          const expectedRevision = parse(revisionSchema, args.expectedRevision);
          const input = parse(activityInputSchema, args.input);
          const [activity] = await db.select().from(activities).where(eq(activities.id, id)).limit(1);
          if (!activity) throw new AppError('Activity not found.', 'NOT_FOUND');
          await db.transaction(async (tx) => {
            const trip = await lockTrip(tx, activity.tripId, expectedRevision);
            await assertStopsBelong(tx, activity.tripId, [input.stopId]);
            let position = activity.position;
            if (input.stopId !== activity.stopId) {
              const [positionRow] = await tx
                .select({ value: max(activities.position) })
                .from(activities)
                .where(eq(activities.stopId, input.stopId));
              position = (positionRow?.value ?? -1) + 1;
            }
            await tx.update(activities).set({ ...input, position, updatedAt: new Date().toISOString() }).where(eq(activities.id, id));
            await finishManualMutation(tx, activity.tripId, trip.revision);
          });
          return (await loadTrip(db, activity.tripId))!;
        }),
      removeActivity: (
        _root: unknown,
        args: { id: string; expectedRevision: number },
      ) =>
        handle(async () => {
          const id = parse(idSchema, args.id);
          const expectedRevision = parse(revisionSchema, args.expectedRevision);
          const [activity] = await db.select().from(activities).where(eq(activities.id, id)).limit(1);
          if (!activity) throw new AppError('Activity not found.', 'NOT_FOUND');
          await db.transaction(async (tx) => {
            const trip = await lockTrip(tx, activity.tripId, expectedRevision);
            await tx.delete(activities).where(eq(activities.id, id));
            await finishManualMutation(tx, activity.tripId, trip.revision);
          });
          return (await loadTrip(db, activity.tripId))!;
        }),
      generateTripDraft: (_root: unknown, args: { prompt: string }) =>
        handle(async () => {
          const prompt = parse(z.string().trim().min(10).max(4_000), args.prompt);
          const result = await aiGateway.generateTripDraft(prompt);
          try {
            validateDateRange(result.value.startDate, result.value.endDate, 'trip date range');
            for (const stop of result.value.stops) {
              validateDateRange(stop.arrivalDate, stop.departureDate, 'stop date range');
              for (const date of [stop.arrivalDate, stop.departureDate]) {
                if (
                  date && result.value.startDate && result.value.endDate &&
                  (date < result.value.startDate || date > result.value.endDate)
                ) {
                  throw new Error('A destination date falls outside the trip dates.');
                }
              }
            }
          } catch {
            throw new AppError('OpenAI returned a draft with inconsistent dates.', 'AI_INVALID_OUTPUT');
          }
          return result.value;
        }),
      prepareTripProposal: (_root: unknown, args: { tripId: string; prompt: string }) =>
        handle(async () => {
          const tripId = parse(idSchema, args.tripId);
          const prompt = parse(z.string().trim().min(3).max(4_000), args.prompt);
          const snapshot = await loadTrip(db, tripId);
          if (!snapshot) throw new AppError('Trip not found.', 'NOT_FOUND');
          const result = await aiGateway.prepareTripProposal(buildAiContext(snapshot), prompt);
          validateProposalSemantics(snapshot, result.value.operations);
          const proposalId = await db.transaction(async (tx) => {
            await lockTrip(tx, tripId, snapshot.revision);
            const [proposal] = await tx
              .insert(aiProposals)
              .values({
                tripId,
                prompt,
                summary: result.value.summary,
                status: 'PENDING',
                baseTripRevision: snapshot.revision,
                model: result.model,
                openaiResponseId: result.responseId,
                schemaVersion: AI_SCHEMA_VERSION,
                promptVersion: AI_PROMPT_VERSION,
              })
              .returning({ id: aiProposals.id });
            if (!proposal) throw new Error('Proposal insert did not return an identifier.');
            await tx.insert(aiProposalOperations).values(
              result.value.operations.map((operation, position) => ({
                proposalId: proposal.id,
                position,
                operationType: operation.type,
                description: operation.description,
                payload: operation.payload,
              })),
            );
            return proposal.id;
          });
          const proposal = await loadProposal(db, proposalId);
          if (!proposal) throw new Error('Created proposal could not be loaded.');
          return proposal;
        }),
      applyTripProposal: (
        _root: unknown,
        args: { proposalId: string; includedOperationIds: string[] },
      ) =>
        handle(async () => {
          const proposalId = parse(idSchema, args.proposalId);
          const includedIds = parse(z.array(idSchema).min(1).max(12), args.includedOperationIds);
          if (new Set(includedIds).size !== includedIds.length) {
            throw new AppError('Select each proposal operation at most once.', 'BAD_USER_INPUT');
          }
          const [proposalHint] = await db
            .select({ tripId: aiProposals.tripId })
            .from(aiProposals)
            .where(eq(aiProposals.id, proposalId))
            .limit(1);
          if (!proposalHint) throw new AppError('Proposal not found.', 'NOT_FOUND');
          const acceptedSnapshot = await loadTrip(db, proposalHint.tripId);
          if (!acceptedSnapshot) throw new AppError('Trip not found.', 'NOT_FOUND');
          const tripId = await db.transaction(async (tx) => {
            // All accepted-data mutations lock the trip before proposal rows. A
            // consistent lock order prevents manual/apply and apply/apply deadlocks.
            const [trip] = await tx
              .select()
              .from(trips)
              .where(eq(trips.id, proposalHint.tripId))
              .limit(1)
              .for('update');
            if (!trip) throw new AppError('Trip not found.', 'NOT_FOUND');
            const [proposal] = await tx
              .select()
              .from(aiProposals)
              .where(eq(aiProposals.id, proposalId))
              .limit(1)
              .for('update');
            if (!proposal) throw new AppError('Proposal not found.', 'NOT_FOUND');
            if (proposal.tripId !== trip.id) {
              throw new AppError('The proposal no longer belongs to this trip.', 'STALE_PROPOSAL');
            }
            if (proposal.status === 'STALE') throw new AppError('This proposal is out of date. Prepare a new one.', 'STALE_PROPOSAL');
            if (proposal.status !== 'PENDING') throw new AppError('Only pending proposals can be applied.', 'BAD_USER_INPUT');
            if (trip.revision !== proposal.baseTripRevision) {
              throw new AppError('This proposal is out of date. Prepare a new one.', 'STALE_PROPOSAL');
            }
            const rows = await tx
              .select()
              .from(aiProposalOperations)
              .where(eq(aiProposalOperations.proposalId, proposalId))
              .orderBy(asc(aiProposalOperations.position));
            if (includedIds.some((id) => !rows.some((row) => row.id === id))) {
              throw new AppError('Every selected operation must belong to this proposal.', 'BAD_USER_INPUT');
            }
            let selectedTripUpdate = false;
            const selectedActivityTargets = new Set<string>();
            for (const row of rows) {
              if (!includedIds.includes(row.id)) continue;
              const operation = proposalOperationSchema.safeParse({
                type: row.operationType,
                description: row.description,
                payload: row.payload,
              });
              if (!operation.success) throw new AppError('A stored proposal operation is invalid.', 'AI_INVALID_OUTPUT');
              if (operation.data.type === 'UPDATE_TRIP') {
                if (selectedTripUpdate) {
                  throw new AppError('A proposal may update trip essentials only once.', 'AI_INVALID_OUTPUT');
                }
                selectedTripUpdate = true;
              }
              if (
                operation.data.type === 'UPDATE_ACTIVITY' ||
                operation.data.type === 'REMOVE_ACTIVITY'
              ) {
                const activityId = operation.data.payload.activityId;
                if (selectedActivityTargets.has(activityId)) {
                  throw new AppError('A proposal may change an activity only once.', 'AI_INVALID_OUTPUT');
                }
                selectedActivityTargets.add(activityId);
              }
              validateProposalSemantics(acceptedSnapshot, [operation.data]);
              await applyProposalOperation(tx, proposal.tripId, operation.data);
            }
            const now = new Date().toISOString();
            await tx
              .update(aiProposalOperations)
              .set({ status: 'APPLIED', updatedAt: now })
              .where(and(eq(aiProposalOperations.proposalId, proposalId), inArray(aiProposalOperations.id, includedIds)));
            await tx
              .update(aiProposalOperations)
              .set({ status: 'EXCLUDED', updatedAt: now })
              .where(and(eq(aiProposalOperations.proposalId, proposalId), ne(aiProposalOperations.status, 'APPLIED')));
            await tx.update(aiProposals).set({ status: 'APPLIED', appliedAt: now, updatedAt: now }).where(eq(aiProposals.id, proposalId));
            await tx.update(trips).set({ revision: trip.revision + 1, updatedAt: now }).where(eq(trips.id, proposal.tripId));
            await tx
              .update(aiProposals)
              .set({ status: 'STALE', updatedAt: now })
              .where(and(eq(aiProposals.tripId, proposal.tripId), eq(aiProposals.status, 'PENDING'), ne(aiProposals.id, proposalId)));
            return proposal.tripId;
          });
          const updated = await loadTrip(db, tripId);
          if (!updated) throw new AppError('Trip not found.', 'NOT_FOUND');
          return updated;
        }),
      discardTripProposal: (_root: unknown, args: { proposalId: string }) =>
        handle(async () => {
          const proposalId = parse(idSchema, args.proposalId);
          await db.transaction(async (tx) => {
            const [proposal] = await tx.select().from(aiProposals).where(eq(aiProposals.id, proposalId)).limit(1).for('update');
            if (!proposal) throw new AppError('Proposal not found.', 'NOT_FOUND');
            if (!['PENDING', 'STALE'].includes(proposal.status)) {
              throw new AppError('Only pending or stale proposals can be discarded.', 'BAD_USER_INPUT');
            }
            const now = new Date().toISOString();
            await tx.update(aiProposals).set({ status: 'DISCARDED', discardedAt: now, updatedAt: now }).where(eq(aiProposals.id, proposalId));
            await tx.update(aiProposalOperations).set({ status: 'EXCLUDED', updatedAt: now }).where(eq(aiProposalOperations.proposalId, proposalId));
          });
          const discarded = await loadProposal(db, proposalId);
          if (!discarded) throw new AppError('Proposal not found.', 'NOT_FOUND');
          return discarded;
        }),
    },
  };
}

export type CreateApiOptions = {
  db: AppDatabase;
  aiGateway: AiGateway;
  webOrigin: string;
  graphiql?: boolean;
};

export function createApi({ db, aiGateway, webOrigin, graphiql = false }: CreateApiOptions) {
  return createYoga({
    schema: createSchema({ typeDefs, resolvers: buildResolvers(db, aiGateway) }),
    graphqlEndpoint: '/graphql',
    cors: {
      origin: webOrigin,
      methods: ['POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type'],
    },
    graphiql,
    logging: false,
    maskedErrors: true,
  });
}
