/**
 * Optional first-boot initialisation.
 *
 * Render's free plan has no pre-deploy command and no shell access, so a fresh
 * deploy has to be able to create its own schema and reference geography. When
 * `AUTO_SETUP=true`, the API applies pending migrations and, if the country
 * table is empty, imports the bundled GeoNames city extract.
 *
 * Every step is idempotent: restarts, wake-ups and repeated deploys are cheap
 * no-ops. Failures are logged and never stop the API from serving — a degraded
 * API (walking/cycling + live transit) is better than a dead one.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pool } from './pool.js';
import { runMigrations } from './migrate.js';
import { importCities } from './cityImport.js';

export interface SetupResult {
  migrated: number;
  citiesImported: number;
  skipped: boolean;
  error?: string;
}

async function locateSeedFile(name: string): Promise<string | null> {
  const candidates = [
    path.resolve(process.cwd(), 'db/seeds', name),
    path.resolve(process.cwd(), '../../db/seeds', name),
  ];
  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export async function runAutoSetup(log: Logger): Promise<SetupResult> {
  const result: SetupResult = { migrated: 0, citiesImported: 0, skipped: false };
  if (!pool) {
    result.skipped = true;
    return result;
  }

  try {
    const migrations = await runMigrations((message) => log.info({}, message));
    result.migrated = migrations.applied.length;
    if (migrations.applied.length > 0) {
      log.info({ applied: migrations.applied }, 'database schema created/updated');
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'automatic migration failed; continuing in degraded mode');
    return result;
  }

  try {
    const counts = await pool.query<{ countries: string; cities: string }>(
      `SELECT (SELECT count(*) FROM countries) AS countries,
              (SELECT count(*) FROM cities) AS cities`,
    );
    const countries = Number(counts.rows[0]?.countries ?? 0);
    const cities = Number(counts.rows[0]?.cities ?? 0);

    if (countries === 0) {
      const reference = await locateSeedFile('reference.sql');
      if (reference) {
        const { readFile } = await import('node:fs/promises');
        await pool.query(await readFile(reference, 'utf8'));
        log.info({}, 'reference geography seeded (countries, currencies, time zones)');
      } else {
        log.warn({}, 'db/seeds/reference.sql not found; country metadata will be empty');
      }
    }

    // The city import is idempotent but not atomic across its batches: a deploy
    // or restart can interrupt it. A completion marker makes the import
    // resumable — it runs again until it has finished once.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS setup_state (
        key        text PRIMARY KEY,
        value      text,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    const marker = await pool.query<{ value: string }>(
      "SELECT value FROM setup_state WHERE key = 'cities_seed'",
    );
    const citiesSeeded = marker.rows[0]?.value === 'complete';

    if (!citiesSeeded) {
      const cityFile = await locateSeedFile('cities.csv.gz');
      if (!cityFile) {
        log.warn({}, 'db/seeds/cities.csv.gz not found; city search will be empty');
        return result;
      }
      const started = Date.now();
      let lastLogged = 0;
      const imported = await importCities({
        file: cityFile,
        onProgress: (count) => {
          if (count - lastLogged >= 50_000) {
            lastLogged = count;
            log.info({ imported: count }, 'importing cities');
          }
        },
      });
      result.citiesImported = imported.imported;
      const total = await pool.query<{ count: string }>('SELECT count(*) AS count FROM cities');
      await pool.query(
        `INSERT INTO setup_state (key, value) VALUES ('cities_seed', 'complete')
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      );
      log.info(
        {
          imported: imported.imported,
          citiesInDatabase: Number(total.rows[0]?.count ?? 0),
          seconds: (Date.now() - started) / 1000,
        },
        'global city reference imported',
      );
    } else if (cities < 1000) {
      log.warn({ cities }, 'city seed marked complete but the table is nearly empty');
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'automatic seed failed; continuing in degraded mode');
  }

  return result;
}
