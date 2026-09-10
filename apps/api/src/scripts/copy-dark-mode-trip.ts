import pg from 'pg';
import { readRuntimeConfig } from '../config.js';

// Deliberately fixed: this script must never write to the main database.
const targetUrl = 'postgresql://tripdock:tripdock@127.0.0.1:55437/tripdock_dark_mode';
const sourceUrl = process.env.DARK_MODE_SOURCE_DATABASE_URL ?? readRuntimeConfig().databaseUrl;
const source = new pg.Client({ connectionString: sourceUrl, connectionTimeoutMillis: 5000 });
const target = new pg.Client({ connectionString: targetUrl, connectionTimeoutMillis: 5000 });

try {
  await target.connect();
  const identity = await target.query('SELECT current_database() AS name');
  if (identity.rows[0].name !== 'tripdock_dark_mode') throw new Error('Refusing to write outside the dark-mode database.');
  await target.query('BEGIN');
  await target.query("SELECT pg_advisory_xact_lock(hashtext('tripdock-dark-mode-copy'))");
  await target.query('CREATE TABLE IF NOT EXISTS dark_mode_seed (trip_id uuid PRIMARY KEY, copied_at timestamptz NOT NULL DEFAULT now())');
  const previous = await target.query('SELECT trip_id FROM dark_mode_seed');
  if (previous.rowCount) {
    console.log('Rome was already copied. Keeping all dark-mode test edits (including deletions).');
  } else {
    await source.connect();
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const selectedId = process.env.DARK_MODE_TRIP_ID;
    const candidates = selectedId
      ? await source.query('SELECT id, name FROM trips WHERE id = $1::uuid', [selectedId])
      : await source.query(`SELECT t.id, t.name FROM trips t
          WHERE concat_ws(' ', t.name, t.destination_area) ~* '\\m(rome|roma)\\M'
             OR EXISTS (SELECT 1 FROM trip_stops s WHERE s.trip_id = t.id AND concat_ws(' ', s.name, s.location_text) ~* '\\m(rome|roma)\\M')
          ORDER BY t.start_date, t.id`);
    if (candidates.rows.length !== 1) {
      throw new Error(`Expected one Rome trip; found ${candidates.rows.length}. Set DARK_MODE_TRIP_ID to the desired trip UUID. Candidates: ${candidates.rows.map(row => `${row.id} (${row.name})`).join(', ') || 'none'}`);
    }
    const trip = candidates.rows[0];
    if ((await target.query('SELECT 1 FROM trips LIMIT 1')).rowCount) {
      throw new Error('The unseeded dark-mode database already contains trips. Refusing to overwrite its content.');
    }

    // Copy exact PostgreSQL JSON representations so dates, timestamps, IDs, and
    // JSON packing explanations survive without JavaScript date coercion.
    async function copy(table: string, where: string, params: unknown[]) {
      const result = await source.query(`SELECT to_jsonb(t) AS record FROM ${table} t WHERE ${where}`, params);
      if (result.rows.length) {
        const columns = Object.keys(result.rows[0].record).map(column => `"${column.replaceAll('"', '""')}"`).join(', ');
        await target.query(
          `INSERT INTO ${table} (${columns}) SELECT ${columns} FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`,
          [JSON.stringify(result.rows.map(row => row.record))],
        );
      }
      console.log(`Copied ${result.rows.length} ${table} rows.`);
    }
    await copy('trips', 'id = $1', [trip.id]);
    for (const table of ['trip_stops', 'transport_legs', 'stays', 'activities']) {
      await copy(table, 'trip_id = $1', [trip.id]);
    }
    // Older main databases may not yet have packing. Do not migrate the source.
    const packing = await source.query("SELECT to_regclass('public.packing_plans') AS table_name");
    if (packing.rows[0].table_name) {
      const profiles = 'profile_id IN (SELECT profile_id FROM packing_plans WHERE trip_id = $1)';
      await copy('packing_profiles', 'id IN (SELECT profile_id FROM packing_plans WHERE trip_id = $1)', [trip.id]);
      for (const table of ['packing_categories', 'packing_items', 'packing_tags', 'packing_tag_items']) {
        await copy(table, profiles, [trip.id]);
      }
      await copy('packing_plans', 'trip_id = $1', [trip.id]);
      for (const table of ['packing_day_tags', 'packing_entries']) {
        await copy(table, 'plan_id IN (SELECT id FROM packing_plans WHERE trip_id = $1)', [trip.id]);
      }
    }
    await target.query('INSERT INTO dark_mode_seed (trip_id) VALUES ($1)', [trip.id]);
    await source.query('COMMIT');
    console.log(`Copied "${trip.name}" into the isolated dark-mode database.`);
  }
  await target.query('COMMIT');
} catch (error) {
  await target.query('ROLLBACK').catch(() => {});
  await source.query('ROLLBACK').catch(() => {});
  console.error(error instanceof Error ? error.message : 'Copy failed.');
  process.exitCode = 1;
} finally {
  await Promise.all([source.end(), target.end()]);
}
