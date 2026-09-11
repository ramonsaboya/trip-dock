import assert from 'node:assert/strict';
import test from 'node:test';

import { config as loadEnv } from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createApi } from '../src/graphql.js';
import { UnconfiguredAiGateway } from '../src/ai.js';
import { exerciseItinerary } from './itinerary-scenarios.js';
import { exercisePacking } from './packing-scenarios.js';
import { exerciseBackendTransactions } from './backend-scenarios.js';
import { exerciseReadSnapshots } from './postgres-read-scenarios.js';

import { createDatabase } from '../src/db/client.js';

loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

test('generated migrations apply to an explicitly configured real PostgreSQL database', async (context) => {
  if (process.env.TRIPDOCK_REQUIRE_POSTGRES_TEST !== '1') {
    context.skip('Run pnpm test:postgres to use the explicitly configured PostgreSQL database.');
    return;
  }
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    assert.fail('TEST_DATABASE_URL must be set for the explicit PostgreSQL smoke test.');
  }
  const target = new URL(connectionString);
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(target.hostname));
  assert.equal(target.pathname.replace(/^\//, ''), 'tripdock_test');
  const database = createDatabase(connectionString, { max: 4 });
  try {
    await database.pool.query('drop schema if exists public cascade');
    await database.pool.query('drop schema if exists drizzle cascade');
    await database.pool.query('create schema public');
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    const rows = await database.pool.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = 'trips'",
    );
    assert.equal(rows.rowCount, 1);
    await exerciseBackendTransactions(database.db, true);
    await exerciseReadSnapshots(database.db);
    await exercisePacking(database.db, true);
    await exerciseItinerary(createApi({ db: database.db, aiGateway: new UnconfiguredAiGateway(), webOrigin: 'http://localhost:3000', graphiql: false }));

    // Rebuild the previous schema with an existing route, then upgrade in place.
    await database.pool.query('drop schema public cascade');
    await database.pool.query('create schema public');
    for (const name of ['0000_special_robbie_robertson.sql', '0001_big_raider.sql']) {
      await database.pool.query(await readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8'));
    }
    const trip = (await database.pool.query("insert into trips (name, destination_area, start_date, end_date) values ('Existing', 'Coast', '2027-06-01', '2027-06-06') returning id")).rows[0].id;
    const stops = (await database.pool.query("insert into trip_stops (trip_id, name, position) values ($1, 'A', 0), ($1, 'B', 1) returning id", [trip])).rows;
    const oldLeg = (await database.pool.query("insert into transport_legs (trip_id, from_stop_id, to_stop_id, position, mode, title) values ($1, $2, $3, 0, 'TRAIN', 'Existing train') returning id", [trip, stops[0].id, stops[1].id])).rows[0].id;
    await database.pool.query(await readFile(new URL('../drizzle/0002_salty_masked_marvel.sql', import.meta.url), 'utf8'));
    const oldActivity = (await database.pool.query("insert into activities (trip_id, stop_id, position, title) values ($1, $2, 0, 'Existing activity') returning id", [trip, stops[0].id])).rows[0].id;
    await database.pool.query(await readFile(new URL('../drizzle/0003_rich_banshee.sql', import.meta.url), 'utf8'));
    const preservedActivity = (await database.pool.query('select title, duration_minutes from activities where id = $1', [oldActivity])).rows[0];
    assert.equal(preservedActivity.title, 'Existing activity');
    assert.equal(preservedActivity.duration_minutes, 60);
    await database.pool.query(await readFile(new URL('../drizzle/0004_late_jack_flag.sql', import.meta.url), 'utf8'));
    assert.equal((await database.pool.query('select title from activities where id = $1', [oldActivity])).rows[0].title, 'Existing activity');
    await assert.rejects(database.pool.query('update activities set duration_minutes = 0 where id = $1', [oldActivity]), /activities_duration_check/);
    const preserved = (await database.pool.query('select * from transport_legs where id = $1', [oldLeg])).rows[0];
    assert.equal(preserved.title, 'Existing train');
    assert.equal(preserved.from_stop_id, stops[0].id);
    assert.equal(preserved.to_stop_id, stops[1].id);
    assert.equal(preserved.from_location, null);
    await assert.rejects(database.pool.query("insert into transport_legs (trip_id, from_location, to_location, position, mode, title) values ($1, 'Home', 'Elsewhere', 1, 'CAR', 'Invalid')", [trip]), /transport_legs_endpoints_check/);
    await assert.rejects(database.pool.query("insert into transport_legs (trip_id, from_location, to_stop_id, position, mode, title) values ($1, ' ', $2, 1, 'CAR', 'Invalid')", [trip, stops[0].id]), /transport_legs_endpoints_check/);
  } finally {
    await database.pool.end();
  }
});
