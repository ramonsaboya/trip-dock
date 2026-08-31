import assert from 'node:assert/strict';
import test from 'node:test';

import { config as loadEnv } from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';

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
  const database = createDatabase(connectionString, { max: 1 });
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
  } finally {
    await database.pool.end();
  }
});
