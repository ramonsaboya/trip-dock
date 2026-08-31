import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';

import { readRuntimeConfig } from '../config.js';
import { createDatabase } from '../db/client.js';

const config = readRuntimeConfig();
const target = new URL(config.databaseUrl);
const databaseName = target.pathname.replace(/^\//, '');
const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
const allowedNames = new Set(['tripdock', 'tripdock_test']);

if (
  process.env.NODE_ENV === 'production' ||
  !localHosts.has(target.hostname) ||
  !allowedNames.has(databaseName)
) {
  throw new Error(
    'Refusing to reset: DATABASE_URL must target the local tripdock or tripdock_test database.',
  );
}

const database = createDatabase(config.databaseUrl, { max: 1 });
try {
  await database.pool.query('drop schema if exists public cascade');
  await database.pool.query('drop schema if exists drizzle cascade');
  await database.pool.query('create schema public');
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  });
  console.log(`Reset and migrated local database ${databaseName}.`);
} finally {
  await database.pool.end();
}
