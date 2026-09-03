import { createSchema, createYoga } from 'graphql-yoga';
import { GraphQLError } from 'graphql';
import { and, eq, inArray, max, sql } from 'drizzle-orm';
import { z, ZodError } from 'zod';

import type { AiGateway } from './ai.js';
import { loadTrip, loadTrips } from './data.js';
import type { AppDatabase } from './db/client.js';
import {
  activities,
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
  timezoneSchema,
  tripDraftStopSchema,
  validateDateRange,
  type DatedStop,
} from './domain.js';
import { buildTripCreationDraft, tripCreationRequestSchema } from './trip-creation.js';

const typeDefs = /* GraphQL */ `
  type Query {
    trips: [Trip!]!
    trip(id: ID!): Trip
  }

  type Mutation {
    createTrip(input: CreateTripInput!): Trip!
    updateTrip(id: ID!, expectedRevision: Int!, input: UpdateTripInput!): Trip!
    deleteTrip(id: ID!, expectedRevision: Int!): Boolean!

    addTripStop(tripId: ID!, expectedRevision: Int!, input: TripStopInput!, moveTripEnd: Boolean = false): Trip!
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

    generateTripDraft(input: GenerateTripDraftInput!): TripDraft!
  }

  type Trip {
    id: ID!
    name: String!
    destinationArea: String!
    startDate: String!
    endDate: String!
    travelerCount: Int
    revision: Int!
    createdAt: String!
    updatedAt: String!
    stops: [TripStop!]!
    transportLegs: [TransportLeg!]!
    stays: [Stay!]!
    activities: [Activity!]!
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

  type TripDraft {
    name: String!
    destinationArea: String!
    startDate: String
    endDate: String
    travelerCount: Int
    stops: [TripDraftStop!]!
    assumptions: [String!]!
    warnings: [String!]!
    fieldStates: [TripDraftFieldState!]!
    questions: [TripClarificationQuestion!]!
    minimumViable: Boolean!
    referenceDate: String!
    locale: String!
    timeZone: String!
  }

  type TripDraftStop {
    draftId: ID!
    name: String!
    locationText: String
    arrivalDate: String
    departureDate: String
    localityKind: String!
    cityResolution: String!
  }

  type TripDraftFieldState {
    path: String!
    status: String!
    evidence: String
    message: String
    blocking: Boolean!
  }

  type TripClarificationQuestion {
    id: ID!
    fieldPaths: [String!]!
    prompt: String!
    options: [TripClarificationOption!]!
    allowFreeText: Boolean!
    blocking: Boolean!
  }

  type TripClarificationOption {
    id: ID!
    label: String!
    updates: [TripClarificationUpdate!]!
  }

  type TripClarificationUpdate {
    path: String!
    value: String
  }

  input GenerateTripDraftInput {
    prompt: String!
    locale: String!
    timeZone: String!
    referenceDate: String!
  }

  input CreateTripInput {
    name: String!
    destinationArea: String!
    startDate: String
    endDate: String
    travelerCount: Int
    stops: [TripStopDraftInput!]!
  }

  input UpdateTripInput {
    name: String!
    destinationArea: String!
    startDate: String!
    endDate: String!
    travelerCount: Int
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
    travelerCount: z.number().int().min(1).max(20).nullish().transform((value) => value ?? null),
    stops: z.array(tripDraftStopSchema).min(1).max(20),
  })
  .strict();

const updateTripInputSchema = z
  .object({
    name: requiredText.max(160),
    destinationArea: requiredText.max(200),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    travelerCount: z.number().int().min(1).max(20).nullish().transform((value) => value ?? null),
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
  if (first.arrivalDate === oldStartDate) {
    first.arrivalDate = newStartDate;
  }
  if (last.departureDate === oldEndDate) {
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
        throw new AppError('The generated draft creates an invalid destination date range.', errorCode);
      }
      throw error;
    }
    for (const date of [stop.arrivalDate, stop.departureDate]) {
      if (date && (date < startDate || date > endDate)) {
        throw new AppError(
          errorCode === 'AI_INVALID_OUTPUT'
            ? 'The generated draft dates exclude a destination date.'
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

function buildResolvers(db: AppDatabase, aiGateway: AiGateway) {
  return {
    Query: {
      trips: () => handle(() => loadTrips(db)),
      trip: (_root: unknown, args: { id: string }) =>
        handle(async () => loadTrip(db, parse(idSchema, args.id))),
    },
    Mutation: {
      createTrip: (_root: unknown, args: { input: unknown }) =>
        handle(async () => {
          const input = parse(createTripInputSchema, args.input);
          const enteredStops = input.stops.map((stop, position) => ({ ...stop, position }));
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
          const preparedStops = chronologicallyOrdered.map((stop, position) => ({ ...stop, position }));
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
        args: { tripId: string; expectedRevision: number; input: unknown; moveTripEnd?: boolean },
      ) =>
        handle(async () => {
          const tripId = parse(idSchema, args.tripId);
          const expectedRevision = parse(revisionSchema, args.expectedRevision);
          const input = parse(stopInputSchema, args.input);
          await db.transaction(async (tx) => {
            const trip = await lockTrip(tx, tripId, expectedRevision);
            const currentStops = await orderedTripStops(tx, tripId);
            const previous = currentStops.at(-1);
            const canMoveLinkedTripEnd = Boolean(
              args.moveTripEnd === true &&
              previous &&
              previous.departureDate === trip.endDate &&
              input.departureDate === trip.endDate,
            );
            const stop = {
              ...input,
              arrivalDate: input.arrivalDate,
              departureDate: input.departureDate,
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
            let ordered = await orderedTripStops(tx, tripId);
            const movesLinkedTripEnd = Boolean(
              canMoveLinkedTripEnd &&
              previous &&
              ordered.at(-1)?.id === inserted.id,
            );
            if (movesLinkedTripEnd && previous) {
              await tx
                .update(tripStops)
                .set({ departureDate: null, updatedAt: new Date().toISOString() })
                .where(eq(tripStops.id, previous.id));
              ordered = await orderedTripStops(tx, tripId);
            }
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
            const existingIndex = before.findIndex((item) => item.id === id);
            const linkedNext = before[existingIndex + 1];
            const previousFirst = before[0]!;
            const previousLast = before.at(-1)!;
            const changedArrival = input.arrivalDate !== existing.arrivalDate;
            const changedDeparture = input.departureDate !== existing.departureDate;
            const updatesLinkedNext = Boolean(
              changedDeparture &&
              linkedNext &&
              linkedNext.arrivalDate === existing.departureDate,
            );
            if (updatesLinkedNext && linkedNext) {
              validateDateRange(input.departureDate, linkedNext.departureDate, 'destination date range');
            }
            await tx.update(tripStops).set({ ...input, updatedAt: new Date().toISOString() }).where(eq(tripStops.id, id));
            if (updatesLinkedNext && linkedNext) {
              await tx
                .update(tripStops)
                .set({ arrivalDate: input.departureDate, updatedAt: new Date().toISOString() })
                .where(eq(tripStops.id, linkedNext.id));
            }
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
            const removedLinkedEnd = previousLast.id === id && previousLast.departureDate === trip.endDate;
            const startDate = previousFirst.id === id &&
              previousFirst.arrivalDate === trip.startDate &&
              nextFirst.arrivalDate
              ? nextFirst.arrivalDate
              : trip.startDate;
            const endDate = removedLinkedEnd &&
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
      generateTripDraft: (_root: unknown, args: { input: unknown }) =>
        handle(async () => {
          const request = parse(tripCreationRequestSchema, args.input);
          const result = await aiGateway.interpretTripCreation(request);
          try {
            return buildTripCreationDraft(result.value, request);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new AppError(
                'The AI interpretation could not be converted into a safe trip draft.',
                'AI_INVALID_OUTPUT',
              );
            }
            throw error;
          }
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
