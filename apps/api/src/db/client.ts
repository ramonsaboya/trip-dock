import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as tables from './schema.js';

export type AppDatabase = NodePgDatabase<typeof tables>;

export type DatabaseHandle = {
  db: AppDatabase;
  pool: Pool;
};

export function createDatabase(
  connectionString: string,
  overrides: Omit<PoolConfig, 'connectionString'> = {},
): DatabaseHandle {
  const pool = new Pool({ connectionString, max: 10, ...overrides });
  return { db: drizzle(pool, { schema: tables }), pool };
}
