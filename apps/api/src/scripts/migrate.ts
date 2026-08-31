import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';

import { readRuntimeConfig } from '../config.js';
import { createDatabase } from '../db/client.js';

const config = readRuntimeConfig();
const database = createDatabase(config.databaseUrl, { max: 1 });

try {
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  });
  console.log('TripDock database migrations are up to date.');
} finally {
  await database.pool.end();
}
