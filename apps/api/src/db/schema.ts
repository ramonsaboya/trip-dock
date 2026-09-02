import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .defaultNow()
    .notNull(),
};

export const trips = pgTable(
  'trips',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    destinationArea: text('destination_area').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    travelerCount: integer('traveler_count').notNull(),
    revision: integer('revision').default(0).notNull(),
    ...timestamps,
  },
  (table) => [
    check('trips_date_range_check', sql`${table.endDate} >= ${table.startDate}`),
    check(
      'trips_traveler_count_check',
      sql`${table.travelerCount} >= 1 and ${table.travelerCount} <= 20`,
    ),
    check('trips_revision_check', sql`${table.revision} >= 0`),
  ],
);

export const tripStops = pgTable(
  'trip_stops',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    locationText: text('location_text'),
    position: integer('position').notNull(),
    arrivalDate: date('arrival_date', { mode: 'string' }),
    departureDate: date('departure_date', { mode: 'string' }),
    ...timestamps,
  },
  (table) => [
    unique('trip_stops_id_trip_id_unique').on(table.id, table.tripId),
    unique('trip_stops_trip_position_unique').on(table.tripId, table.position),
    index('trip_stops_trip_position_idx').on(table.tripId, table.position),
    check('trip_stops_position_check', sql`${table.position} >= 0`),
    check(
      'trip_stops_date_range_check',
      sql`${table.arrivalDate} is null or ${table.departureDate} is null or ${table.departureDate} >= ${table.arrivalDate}`,
    ),
  ],
);

export const transportLegs = pgTable(
  'transport_legs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    fromStopId: uuid('from_stop_id').notNull(),
    toStopId: uuid('to_stop_id').notNull(),
    position: integer('position').notNull(),
    mode: text('mode').notNull(),
    title: text('title').notNull(),
    details: text('details'),
    departureTime: timestamp('departure_time', { withTimezone: true, mode: 'string' }),
    arrivalTime: timestamp('arrival_time', { withTimezone: true, mode: 'string' }),
    timezone: text('timezone'),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: 'transport_legs_from_stop_trip_fk',
      columns: [table.fromStopId, table.tripId],
      foreignColumns: [tripStops.id, tripStops.tripId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'transport_legs_to_stop_trip_fk',
      columns: [table.toStopId, table.tripId],
      foreignColumns: [tripStops.id, tripStops.tripId],
    }).onDelete('cascade'),
    unique('transport_legs_trip_position_unique').on(table.tripId, table.position),
    index('transport_legs_trip_position_idx').on(table.tripId, table.position),
    check('transport_legs_position_check', sql`${table.position} >= 0`),
  ],
);

export const stays = pgTable(
  'stays',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    stopId: uuid('stop_id').notNull(),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    checkIn: timestamp('check_in', { withTimezone: true, mode: 'string' }),
    checkOut: timestamp('check_out', { withTimezone: true, mode: 'string' }),
    timezone: text('timezone'),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: 'stays_stop_trip_fk',
      columns: [table.stopId, table.tripId],
      foreignColumns: [tripStops.id, tripStops.tripId],
    }).onDelete('cascade'),
    unique('stays_stop_position_unique').on(table.stopId, table.position),
    index('stays_trip_stop_position_idx').on(table.tripId, table.stopId, table.position),
    check('stays_position_check', sql`${table.position} >= 0`),
  ],
);

export const activities = pgTable(
  'activities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    stopId: uuid('stop_id').notNull(),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    status: text('status').default('IDEA').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true, mode: 'string' }),
    timezone: text('timezone'),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: 'activities_stop_trip_fk',
      columns: [table.stopId, table.tripId],
      foreignColumns: [tripStops.id, tripStops.tripId],
    }).onDelete('cascade'),
    unique('activities_stop_position_unique').on(table.stopId, table.position),
    index('activities_trip_stop_position_idx').on(table.tripId, table.stopId, table.position),
    check('activities_position_check', sql`${table.position} >= 0`),
    check(
      'activities_status_check',
      sql`${table.status} in ('IDEA', 'PLANNED', 'BOOKED', 'DONE')`,
    ),
  ],
);

// These legacy tables remain declared so the already-applied baseline migration
// stays reproducible. No current GraphQL or application runtime reads or writes them.
export const aiProposals = pgTable(
  'ai_proposals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    prompt: text('prompt').notNull(),
    summary: text('summary').notNull(),
    status: text('status').default('PENDING').notNull(),
    baseTripRevision: integer('base_trip_revision').notNull(),
    model: text('model').notNull(),
    openaiResponseId: text('openai_response_id'),
    schemaVersion: text('schema_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'string' }),
    discardedAt: timestamp('discarded_at', { withTimezone: true, mode: 'string' }),
    ...timestamps,
  },
  (table) => [
    index('ai_proposals_trip_created_idx').on(table.tripId, table.createdAt),
    check(
      'ai_proposals_status_check',
      sql`${table.status} in ('PENDING', 'APPLIED', 'DISCARDED', 'STALE')`,
    ),
  ],
);

export const aiProposalOperations = pgTable(
  'ai_proposal_operations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => aiProposals.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    operationType: text('operation_type').notNull(),
    description: text('description').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').default('PENDING').notNull(),
    ...timestamps,
  },
  (table) => [
    unique('ai_proposal_operations_position_unique').on(table.proposalId, table.position),
    index('ai_proposal_operations_order_idx').on(table.proposalId, table.position),
    check('ai_proposal_operations_position_check', sql`${table.position} >= 0`),
    check(
      'ai_proposal_operations_status_check',
      sql`${table.status} in ('PENDING', 'APPLIED', 'EXCLUDED')`,
    ),
  ],
);

export const schema = {
  trips,
  tripStops,
  transportLegs,
  stays,
  activities,
  aiProposals,
  aiProposalOperations,
};
