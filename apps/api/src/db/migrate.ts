/**
 * Forward-only migration runner.
 *
 * Two entry points share the same code:
 *  - `npm run db:migrate` (CLI, below), and
 *  - the API boot sequence when `AUTO_MIGRATE=true` (see `bootstrap.ts`), so a
 *    fresh Render deploy creates its own schema without a paid pre-deploy step.
 *
 * Each `db/migrations/*.sql` file is applied once, inside its own transaction,
 * and recorded in `schema_migrations`.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function locateMigrations(): Promise<string> {
  const candidates = [
    path.resolve(here, '../../../db/migrations'), // tsx: apps/api/src/db -> repo/db
    path.resolve(here, '../../../../db/migrations'), // built: apps/api/dist/db -> repo/db
    path.resolve(process.cwd(), 'db/migrations'),
    path.resolve(process.cwd(), '../../db/migrations'),
  ];
  for (const candidate of candidates) {
    try {
      await readdir(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error('Could not locate db/migrations directory');
}

/**
 * Apply every pending migration. Safe to call on each boot: applied files are
 * skipped by name, so repeated calls are no-ops.
 */
export async function runMigrations(
  log: (message: string) => void = () => undefined,
): Promise<MigrationResult> {
  if (!pool) throw new Error('DATABASE_URL is not set — nothing to migrate.');
  const dir = await locateMigrations();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const appliedRows = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations',
  );
  const applied = new Set(appliedRows.rows.map((r) => r.filename));

  const result: MigrationResult = { applied: [], skipped: [] };

  for (const file of files) {
    if (applied.has(file)) {
      result.skipped.push(file);
      continue;
    }
    const sql = await readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      result.applied.push(file);
      log(`+ ${file}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error(`! ${file} failed`);
      throw err;
    } finally {
      client.release();
    }
  }
  return result;
}

async function main() {
  if (!pool) {
    console.error('DATABASE_URL is not set — nothing to migrate.');
    process.exitCode = 1;
    return;
  }
  const result = await runMigrations((message) => console.log(message));
  for (const file of result.skipped) console.log(`= ${file} (already applied)`);
  console.log('Migrations complete.');
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool?.end();
    });
}
