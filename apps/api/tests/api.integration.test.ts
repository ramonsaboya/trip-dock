import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { DataType, newDb } from 'pg-mem';
import type { Pool } from 'pg';

import { FixtureAiGateway, UnconfiguredAiGateway, type AiGateway } from '../src/ai.js';
import type { AppDatabase } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { createApi } from '../src/graphql.js';

type Yoga = ReturnType<typeof createApi>;

type Harness = {
  pool: Pool;
  yoga: Yoga;
  withGateway(gateway: AiGateway): Yoga;
};

async function createHarness(gateway: AiGateway = new UnconfiguredAiGateway()): Promise<Harness> {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    impure: true,
    implementation: randomUUID,
  });
  const adapter = memory.adapters.createPg();
  // Drizzle uses two optional node-postgres query features that pg-mem does not
  // implement: a per-query type parser and array-shaped rows. Keep the production
  // adapter untouched and bridge only this in-memory test adapter.
  const prototype = adapter.Pool.prototype as {
    query: (config: unknown, ...args: unknown[]) => unknown;
  };
  const query = prototype.query;
  const transactionBackups = new WeakMap<object, ReturnType<typeof memory.backup>>();
  prototype.query = function patchedQuery(config: unknown, ...args: unknown[]) {
    const record = config && typeof config === 'object'
      ? config as Record<string, unknown>
      : undefined;
    const sql = typeof config === 'string'
      ? config
      : typeof record?.text === 'string'
        ? record.text
        : '';
    const transactionCommand = sql.trim().split(/\s+/, 1)[0]?.toLowerCase();
    const owner = this as object;
    if (transactionCommand === 'begin') transactionBackups.set(owner, memory.backup());

    const requestedArrayRows = record?.rowMode === 'array';
    const supportedConfig = record
      ? (({ types: _types, rowMode: _rowMode, ...supported }) => supported)(record)
      : config;
    const result = query.call(this, supportedConfig, ...args);

    return Promise.resolve(result).then((value) => {
      if (transactionCommand === 'rollback') {
        transactionBackups.get(owner)?.restore();
        transactionBackups.delete(owner);
      } else if (transactionCommand === 'commit') {
        transactionBackups.delete(owner);
      }

      if (!requestedArrayRows) return value;
      const pgResult = value as {
        rows: Array<Record<string, unknown> | unknown[]>;
        [key: string]: unknown;
      };
      return {
        ...pgResult,
        rows: pgResult.rows.map((row) => (Array.isArray(row) ? row : Object.values(row))),
      };
    });
  };
  const pool = new adapter.Pool() as unknown as Pool;
  const migrationDirectory = fileURLToPath(new URL('../drizzle', import.meta.url));
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  assert.equal(migrationFiles.length, 1, 'The slice should have one baseline SQL migration.');
  const migration = await readFile(join(migrationDirectory, migrationFiles[0]!), 'utf8');
  for (const statement of migration.split('--> statement-breakpoint')) {
    if (statement.trim()) await pool.query(statement);
  }
  const db = drizzle(pool, { schema }) as AppDatabase;
  const withGateway = (aiGateway: AiGateway) =>
    createApi({ db, aiGateway, webOrigin: 'http://localhost:3000', graphiql: false });
  return { pool, yoga: withGateway(gateway), withGateway };
}

async function gql<T>(
  yoga: Yoga,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<{ data?: T; errors?: Array<{ message: string; extensions: { code?: string } }> }> {
  const response = await yoga.fetch('http://127.0.0.1:4000/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify({ query, variables }),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string; extensions: { code?: string } }>;
  };
}

const tripFields = `
  id name destinationArea startDate endDate travelerCount revision
  stops { id name position arrivalDate departureDate }
  transportLegs { id fromStopId toStopId mode title }
  stays { id stopId name }
  activities { id stopId title status scheduledAt }
`;

const createTripMutation = `mutation Create($input: CreateTripInput!) {
  createTrip(input: $input) { ${tripFields} }
}`;

const baseTripInput = {
  name: 'Database journey',
  destinationArea: 'Northern coast',
  startDate: '2027-06-01',
  endDate: '2027-06-06',
  travelerCount: 2,
  stops: [
    {
      name: 'Harbor',
      locationText: null,
      arrivalDate: '2027-06-01',
      departureDate: '2027-06-03',
    },
    {
      name: 'Old town',
      locationText: null,
      arrivalDate: '2027-06-03',
      departureDate: '2027-06-06',
    },
  ],
};

type TripResult = {
  id: string;
  name: string;
  destinationArea: string;
  startDate: string;
  endDate: string;
  travelerCount: number;
  revision: number;
  stops: Array<{
    id: string;
    name: string;
    position: number;
    arrivalDate: string | null;
    departureDate: string | null;
  }>;
  transportLegs: Array<{ id: string }>;
  stays: Array<{ id: string }>;
  activities: Array<{ id: string; title: string }>;
};

async function createTrip(yoga: Yoga): Promise<TripResult> {
  const result = await gql<{ createTrip: TripResult }>(yoga, createTripMutation, {
    input: baseTripInput,
  });
  assert.equal(result.errors, undefined);
  return result.data!.createTrip;
}

test('generated migration creates a genuine empty database with no fixtures', async () => {
  const harness = await createHarness();
  try {
    const tables = await harness.pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      [
        'activities',
        'ai_proposal_operations',
        'ai_proposals',
        'stays',
        'transport_legs',
        'trip_stops',
        'trips',
      ],
    );
    const result = await gql<{ trips: unknown[] }>(harness.yoga, 'query { trips { id } }');
    assert.deepEqual(result.data?.trips, []);
  } finally {
    await harness.pool.end();
  }
});

test('manual GraphQL data persists across API instances and every edit bumps revision', async () => {
  const harness = await createHarness();
  try {
    let trip = await createTrip(harness.yoga);
    assert.equal(trip.revision, 0);
    const restartedApi = harness.withGateway(new UnconfiguredAiGateway());
    const restored = await gql<{ trip: TripResult }>(
      restartedApi,
      `query Trip($id: ID!) { trip(id: $id) { ${tripFields} } }`,
      { id: trip.id },
    );
    assert.equal(restored.data?.trip.name, 'Database journey');

    const addStop = await gql<{ addTripStop: TripResult }>(
      restartedApi,
      `mutation Add($tripId: ID!, $revision: Int!, $input: TripStopInput!) {
        addTripStop(tripId: $tripId, expectedRevision: $revision, input: $input) { ${tripFields} }
      }`,
      {
        tripId: trip.id,
        revision: trip.revision,
        input: {
          name: 'Clifftop',
          locationText: null,
          arrivalDate: null,
          departureDate: null,
        },
      },
    );
    trip = addStop.data!.addTripStop;
    assert.equal(trip.revision, 1);
    assert.equal(trip.stops.at(-1)?.name, 'Clifftop');
    assert.equal(trip.stops.at(-1)?.arrivalDate, null);
    assert.equal(trip.stops.at(-1)?.departureDate, null);

    const reordered = await gql<{ reorderTripStops: TripResult }>(
      restartedApi,
      `mutation Order($tripId: ID!, $revision: Int!, $ids: [ID!]!) {
        reorderTripStops(tripId: $tripId, expectedRevision: $revision, stopIds: $ids) { ${tripFields} }
      }`,
      {
        tripId: trip.id,
        revision: trip.revision,
        ids: [...trip.stops].reverse().map((stop) => stop.id),
      },
    );
    trip = reordered.data!.reorderTripStops;
    assert.equal(trip.revision, 2);
    assert.deepEqual(trip.stops.map((stop) => stop.name), ['Harbor', 'Old town', 'Clifftop']);

    const [from, to] = trip.stops;
    const transport = await gql<{ addTransportLeg: TripResult }>(
      restartedApi,
      `mutation Add($tripId: ID!, $revision: Int!, $input: TransportLegInput!) {
        addTransportLeg(tripId: $tripId, expectedRevision: $revision, input: $input) { ${tripFields} }
      }`,
      {
        tripId: trip.id,
        revision: trip.revision,
        input: {
          fromStopId: from!.id,
          toStopId: to!.id,
          mode: 'TRAIN',
          title: 'Coastal train',
          details: null,
          departureTime: null,
          arrivalTime: null,
          timezone: null,
        },
      },
    );
    trip = transport.data!.addTransportLeg;
    assert.equal(trip.revision, 3);
    assert.equal(trip.transportLegs.length, 1);

    const stay = await gql<{ addStay: TripResult }>(
      restartedApi,
      `mutation Add($tripId: ID!, $revision: Int!, $input: StayInput!) {
        addStay(tripId: $tripId, expectedRevision: $revision, input: $input) { ${tripFields} }
      }`,
      {
        tripId: trip.id,
        revision: trip.revision,
        input: { stopId: from!.id, name: 'Harbor house', checkIn: null, checkOut: null, timezone: null },
      },
    );
    trip = stay.data!.addStay;
    assert.equal(trip.revision, 4);
    assert.equal(trip.stays.length, 1);

    const activity = await gql<{ addActivity: TripResult }>(
      restartedApi,
      `mutation Add($tripId: ID!, $revision: Int!, $input: ActivityInput!) {
        addActivity(tripId: $tripId, expectedRevision: $revision, input: $input) { ${tripFields} }
      }`,
      {
        tripId: trip.id,
        revision: trip.revision,
        input: { stopId: from!.id, title: 'Sunset walk', status: 'PLANNED', scheduledAt: null, timezone: null },
      },
    );
    trip = activity.data!.addActivity;
    assert.equal(trip.revision, 5);
    assert.equal(trip.activities[0]?.title, 'Sunset walk');

    const removedLinkedLast = await gql<{ removeTripStop: TripResult }>(
      restartedApi,
      `mutation Remove($id: ID!, $revision: Int!) {
        removeTripStop(id: $id, expectedRevision: $revision) { ${tripFields} }
      }`,
      { id: trip.stops.at(-1)!.id, revision: trip.revision },
    );
    assert.equal(removedLinkedLast.errors, undefined);
    trip = removedLinkedLast.data!.removeTripStop;
    assert.equal(trip.revision, 6);
    assert.equal(trip.stops.at(-1)?.departureDate, '2027-06-06');
  } finally {
    await harness.pool.end();
  }
});

test('destination departure changes keep only an untouched next arrival linked', async () => {
  const harness = await createHarness();
  try {
    let trip = await createTrip(harness.yoga);
    const [first, second] = trip.stops;
    const updateStopMutation = `mutation Update($id: ID!, $revision: Int!, $input: TripStopInput!) {
      updateTripStop(id: $id, expectedRevision: $revision, input: $input) { ${tripFields} }
    }`;

    const linked = await gql<{ updateTripStop: TripResult }>(harness.yoga, updateStopMutation, {
      id: first!.id,
      revision: trip.revision,
      input: {
        name: first!.name,
        locationText: null,
        arrivalDate: first!.arrivalDate,
        departureDate: '2027-06-04',
      },
    });
    assert.equal(linked.errors, undefined);
    trip = linked.data!.updateTripStop;
    assert.equal(trip.stops.find((stop) => stop.id === second!.id)?.arrivalDate, '2027-06-04');

    const customNext = await gql<{ updateTripStop: TripResult }>(harness.yoga, updateStopMutation, {
      id: second!.id,
      revision: trip.revision,
      input: {
        name: second!.name,
        locationText: null,
        arrivalDate: '2027-06-05',
        departureDate: second!.departureDate,
      },
    });
    assert.equal(customNext.errors, undefined);
    trip = customNext.data!.updateTripStop;

    const preserved = await gql<{ updateTripStop: TripResult }>(harness.yoga, updateStopMutation, {
      id: first!.id,
      revision: trip.revision,
      input: {
        name: first!.name,
        locationText: null,
        arrivalDate: first!.arrivalDate,
        departureDate: '2027-06-02',
      },
    });
    assert.equal(preserved.errors, undefined);
    assert.equal(
      preserved.data!.updateTripStop.stops.find((stop) => stop.id === second!.id)?.arrivalDate,
      '2027-06-05',
    );

    trip = preserved.data!.updateTripStop;
    const clearedNext = await gql<{ updateTripStop: TripResult }>(harness.yoga, updateStopMutation, {
      id: second!.id,
      revision: trip.revision,
      input: {
        name: second!.name,
        locationText: null,
        arrivalDate: null,
        departureDate: second!.departureDate,
      },
    });
    assert.equal(clearedNext.errors, undefined);
    trip = clearedNext.data!.updateTripStop;

    const keptClear = await gql<{ updateTripStop: TripResult }>(harness.yoga, updateStopMutation, {
      id: first!.id,
      revision: trip.revision,
      input: {
        name: first!.name,
        locationText: null,
        arrivalDate: first!.arrivalDate,
        departureDate: '2027-06-03',
      },
    });
    assert.equal(keptClear.errors, undefined);
    assert.equal(
      keptClear.data!.updateTripStop.stops.find((stop) => stop.id === second!.id)?.arrivalDate,
      null,
    );
  } finally {
    await harness.pool.end();
  }
});

test('adding a destination transfers an explicitly linked trip end without inventing a link on removal', async () => {
  const harness = await createHarness();
  try {
    let trip = await createTrip(harness.yoga);
    const previousLastId = trip.stops.at(-1)!.id;
    const added = await gql<{ addTripStop: TripResult }>(
      harness.yoga,
      `mutation Add($tripId: ID!, $revision: Int!, $input: TripStopInput!, $moveTripEnd: Boolean) {
        addTripStop(tripId: $tripId, expectedRevision: $revision, input: $input, moveTripEnd: $moveTripEnd) { ${tripFields} }
      }`,
      {
        tripId: trip.id,
        revision: trip.revision,
        moveTripEnd: true,
        input: {
          name: 'Clifftop',
          locationText: null,
          arrivalDate: null,
          departureDate: trip.endDate,
        },
      },
    );
    assert.equal(added.errors, undefined);
    trip = added.data!.addTripStop;
    assert.equal(trip.stops.find((stop) => stop.id === previousLastId)?.departureDate, null);
    assert.equal(trip.stops.at(-1)?.arrivalDate, null);
    assert.equal(trip.stops.at(-1)?.departureDate, trip.endDate);

    const removed = await gql<{ removeTripStop: TripResult }>(
      harness.yoga,
      `mutation Remove($id: ID!, $revision: Int!) {
        removeTripStop(id: $id, expectedRevision: $revision) { ${tripFields} }
      }`,
      { id: trip.stops.at(-1)!.id, revision: trip.revision },
    );
    assert.equal(removed.errors, undefined);
    assert.equal(removed.data!.removeTripStop.stops.at(-1)?.departureDate, null);
    assert.equal(removed.data!.removeTripStop.endDate, trip.endDate);
  } finally {
    await harness.pool.end();
  }
});

test('adding a destination preserves explicit date intent when no end transfer occurs', async () => {
  const harness = await createHarness();
  try {
    const addMutation = `mutation Add($tripId: ID!, $revision: Int!, $input: TripStopInput!, $moveTripEnd: Boolean) {
      addTripStop(tripId: $tripId, expectedRevision: $revision, input: $input, moveTripEnd: $moveTripEnd) { ${tripFields} }
    }`;
    let trip = await createTrip(harness.yoga);
    const previousLastId = trip.stops.at(-1)!.id;
    const explicitBlank = await gql<{ addTripStop: TripResult }>(harness.yoga, addMutation, {
      tripId: trip.id,
      revision: trip.revision,
      moveTripEnd: false,
      input: {
        name: 'Open dates',
        locationText: null,
        arrivalDate: null,
        departureDate: null,
      },
    });
    assert.equal(explicitBlank.errors, undefined);
    trip = explicitBlank.data!.addTripStop;
    assert.equal(trip.stops.find((stop) => stop.name === 'Open dates')?.arrivalDate, null);
    assert.equal(trip.stops.find((stop) => stop.id === previousLastId)?.departureDate, trip.endDate);

    const harnessTwo = await createHarness();
    try {
      const secondTrip = await createTrip(harnessTwo.yoga);
      const secondPreviousLastId = secondTrip.stops.at(-1)!.id;
      const insertedEarlier = await gql<{ addTripStop: TripResult }>(harnessTwo.yoga, addMutation, {
        tripId: secondTrip.id,
        revision: secondTrip.revision,
        moveTripEnd: true,
        input: {
          name: 'Mid-route',
          locationText: null,
          arrivalDate: '2027-06-02',
          departureDate: secondTrip.endDate,
        },
      });
      assert.equal(insertedEarlier.errors, undefined);
      assert.notEqual(insertedEarlier.data!.addTripStop.stops.at(-1)?.name, 'Mid-route');
      assert.equal(
        insertedEarlier.data!.addTripStop.stops.find((stop) => stop.id === secondPreviousLastId)?.departureDate,
        secondTrip.endDate,
      );
    } finally {
      await harnessTwo.pool.end();
    }
  } finally {
    await harness.pool.end();
  }
});

test('trip boundaries and destination dates synchronize while destinations stay date-ordered', async () => {
  const harness = await createHarness();
  try {
    const inferred = await gql<{ createTrip: TripResult }>(harness.yoga, createTripMutation, {
      input: {
        name: 'Chronological journey',
        destinationArea: 'Two places',
        startDate: null,
        endDate: null,
        travelerCount: 2,
        stops: [
          {
            name: 'Later place',
            locationText: null,
            arrivalDate: '2027-06-04',
            departureDate: '2027-06-07',
          },
          {
            name: 'Earlier place',
            locationText: null,
            arrivalDate: '2027-06-01',
            departureDate: '2027-06-04',
          },
        ],
      },
    });
    assert.equal(inferred.errors, undefined);
    let trip = inferred.data!.createTrip;
    assert.equal(trip.startDate, '2027-06-01');
    assert.equal(trip.endDate, '2027-06-07');
    assert.deepEqual(
      trip.stops.map(({ name, position }) => ({ name, position })),
      [
        { name: 'Earlier place', position: 0 },
        { name: 'Later place', position: 1 },
      ],
    );

    const changedTripDates = await gql<{ updateTrip: TripResult }>(
      harness.yoga,
      `mutation Update($id: ID!, $revision: Int!, $input: UpdateTripInput!) {
        updateTrip(id: $id, expectedRevision: $revision, input: $input) { ${tripFields} }
      }`,
      {
        id: trip.id,
        revision: trip.revision,
        input: {
          name: trip.name,
          destinationArea: trip.destinationArea,
          startDate: '2027-05-31',
          endDate: '2027-06-08',
          travelerCount: trip.travelerCount,
        },
      },
    );
    assert.equal(changedTripDates.errors, undefined);
    trip = changedTripDates.data!.updateTrip;
    assert.equal(trip.stops[0]?.arrivalDate, '2027-05-31');
    assert.equal(trip.stops.at(-1)?.departureDate, '2027-06-08');

    const formerLast = trip.stops.at(-1)!;
    const movedEarlier = await gql<{ updateTripStop: TripResult }>(
      harness.yoga,
      `mutation Update($id: ID!, $revision: Int!, $input: TripStopInput!) {
        updateTripStop(id: $id, expectedRevision: $revision, input: $input) { ${tripFields} }
      }`,
      {
        id: formerLast.id,
        revision: trip.revision,
        input: {
          name: formerLast.name,
          locationText: null,
          arrivalDate: '2027-05-29',
          departureDate: '2027-05-30',
        },
      },
    );
    assert.equal(movedEarlier.errors, undefined);
    trip = movedEarlier.data!.updateTripStop;
    assert.deepEqual(trip.stops.map((stop) => stop.name), ['Later place', 'Earlier place']);
    assert.deepEqual(trip.stops.map((stop) => stop.position), [0, 1]);
    assert.equal(trip.startDate, '2027-05-29');
    assert.equal(trip.endDate, '2027-06-04');

    const added = await gql<{ addTripStop: TripResult }>(
      harness.yoga,
      `mutation Add($tripId: ID!, $revision: Int!, $input: TripStopInput!) {
        addTripStop(tripId: $tripId, expectedRevision: $revision, input: $input) { ${tripFields} }
      }`,
      {
        tripId: trip.id,
        revision: trip.revision,
        input: {
          name: 'Final place',
          locationText: null,
          arrivalDate: null,
          departureDate: '2027-06-06',
        },
      },
    );
    assert.equal(added.errors, undefined);
    trip = added.data!.addTripStop;
    assert.equal(trip.stops.at(-1)?.name, 'Final place');
    assert.equal(trip.stops.at(-1)?.arrivalDate, null);
    assert.equal(trip.endDate, '2027-06-06');

    const removed = await gql<{ removeTripStop: TripResult }>(
      harness.yoga,
      `mutation Remove($id: ID!, $revision: Int!) {
        removeTripStop(id: $id, expectedRevision: $revision) { ${tripFields} }
      }`,
      { id: trip.stops.at(-1)!.id, revision: trip.revision },
    );
    assert.equal(removed.errors, undefined);
    trip = removed.data!.removeTripStop;
    assert.equal(trip.endDate, '2027-06-04');
    assert.equal(trip.stops.at(-1)?.departureDate, '2027-06-04');
  } finally {
    await harness.pool.end();
  }
});

test('createTrip preserves intentionally blank destination boundaries', async () => {
  const harness = await createHarness();
  try {
    const result = await gql<{ createTrip: TripResult }>(harness.yoga, createTripMutation, {
      input: {
        name: 'Boundary defaults',
        destinationArea: 'One place',
        startDate: '2027-08-10',
        endDate: '2027-08-14',
        travelerCount: 1,
        stops: [
          {
            name: 'Only place',
            locationText: null,
            arrivalDate: null,
            departureDate: null,
          },
        ],
      },
    });
    assert.equal(result.errors, undefined);
    assert.equal(result.data?.createTrip.stops[0]?.arrivalDate, null);
    assert.equal(result.data?.createTrip.stops[0]?.departureDate, null);
  } finally {
    await harness.pool.end();
  }
});

test('explicit destination boundary dates can diverge while linked edits still flow both ways', async () => {
  const harness = await createHarness();
  try {
    const created = await gql<{ createTrip: TripResult }>(harness.yoga, createTripMutation, {
      input: {
        name: 'Travel-day buffer',
        destinationArea: 'One place',
        startDate: '2027-08-10',
        endDate: '2027-08-20',
        travelerCount: 1,
        stops: [
          {
            name: 'The stay',
            locationText: null,
            arrivalDate: '2027-08-12',
            departureDate: '2027-08-18',
          },
        ],
      },
    });
    assert.equal(created.errors, undefined);
    let trip = created.data!.createTrip;
    assert.equal(trip.stops[0]?.arrivalDate, '2027-08-12');
    assert.equal(trip.stops[0]?.departureDate, '2027-08-18');

    const tripEdit = await gql<{ updateTrip: TripResult }>(
      harness.yoga,
      `mutation Update($id: ID!, $revision: Int!, $input: UpdateTripInput!) {
        updateTrip(id: $id, expectedRevision: $revision, input: $input) { ${tripFields} }
      }`,
      {
        id: trip.id,
        revision: trip.revision,
        input: {
          name: trip.name,
          destinationArea: trip.destinationArea,
          startDate: '2027-08-09',
          endDate: '2027-08-21',
          travelerCount: trip.travelerCount,
        },
      },
    );
    assert.equal(tripEdit.errors, undefined);
    trip = tripEdit.data!.updateTrip;
    assert.equal(trip.stops[0]?.arrivalDate, '2027-08-12');
    assert.equal(trip.stops[0]?.departureDate, '2027-08-18');

    const stop = trip.stops[0]!;
    const stopEdit = await gql<{ updateTripStop: TripResult }>(
      harness.yoga,
      `mutation Update($id: ID!, $revision: Int!, $input: TripStopInput!) {
        updateTripStop(id: $id, expectedRevision: $revision, input: $input) { ${tripFields} }
      }`,
      {
        id: stop.id,
        revision: trip.revision,
        input: {
          name: stop.name,
          locationText: null,
          arrivalDate: '2027-08-11',
          departureDate: stop.departureDate,
        },
      },
    );
    assert.equal(stopEdit.errors, undefined);
    assert.equal(stopEdit.data?.updateTripStop.startDate, '2027-08-11');
    assert.equal(stopEdit.data?.updateTripStop.endDate, '2027-08-21');
  } finally {
    await harness.pool.end();
  }
});

test('homepage AI draft generation remains available without persisting a trip', async () => {
  const draft = {
    name: 'Coastal draft',
    destinationArea: 'Atlantic coast',
    startDate: '2027-09-10',
    endDate: '2027-09-15',
    travelerCount: 2,
    stops: [{
      name: 'Harbor',
      locationText: null,
      arrivalDate: '2027-09-10',
      departureDate: '2027-09-15',
    }],
    assumptions: [],
    warnings: [],
  };
  const gateway = new FixtureAiGateway(draft);
  const harness = await createHarness(gateway);
  try {
    const result = await gql<{ generateTripDraft: typeof draft }>(
      harness.yoga,
      `mutation($prompt: String!) {
        generateTripDraft(prompt: $prompt) {
          name destinationArea startDate endDate travelerCount assumptions warnings
          stops { name locationText arrivalDate departureDate }
        }
      }`,
      { prompt: 'Plan a detailed five-day coastal trip for two people.' },
    );
    assert.equal(result.errors, undefined);
    assert.deepEqual(result.data?.generateTripDraft, draft);
    assert.deepEqual(gateway.calls, [{
      kind: 'draft',
      prompt: 'Plan a detailed five-day coastal trip for two people.',
    }]);
    const tripsResult = await gql<{ trips: Array<{ id: string }> }>(
      harness.yoga,
      'query { trips { id } }',
    );
    assert.deepEqual(tripsResult.data?.trips, []);
  } finally {
    await harness.pool.end();
  }
});

test('existing-trip AI proposal fields are absent from the GraphQL schema', async () => {
  const harness = await createHarness();
  try {
    const result = await gql<{
      mutation: { fields: Array<{ name: string }> };
      query: { fields: Array<{ name: string }> };
      trip: { fields: Array<{ name: string }> };
    }>(
      harness.yoga,
      `query {
        mutation: __type(name: "Mutation") { fields { name } }
        query: __type(name: "Query") { fields { name } }
        trip: __type(name: "Trip") { fields { name } }
      }`,
    );
    assert.equal(result.errors, undefined);
    const mutationFields = result.data!.mutation.fields.map(({ name }) => name);
    assert.ok(mutationFields.includes('generateTripDraft'));
    assert.ok(!mutationFields.includes('prepareTripProposal'));
    assert.ok(!mutationFields.includes('applyTripProposal'));
    assert.ok(!mutationFields.includes('discardTripProposal'));
    assert.ok(!result.data!.query.fields.some(({ name }) => name === 'proposal'));
    assert.ok(!result.data!.trip.fields.some(({ name }) => name === 'proposals'));
  } finally {
    await harness.pool.end();
  }
});
