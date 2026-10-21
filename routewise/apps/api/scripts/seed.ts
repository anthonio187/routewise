/**
 * Apply the reference seed.
 *
 *   npm run db:seed                 # all 250 countries/territories + ~236k cities
 *   npm run db:seed -- --countries-only
 *
 * The seed contains real-world reference geography only; it never contains a
 * transit network. Transit coverage comes from ingested GTFS feeds or the
 * configured live provider. City rows are discovery anchors, not coverage claims.
 *
 * City data: GeoNames (CC BY 4.0) — see db/seeds/README.md.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importCities } from '../src/db/cityImport.js';
import { pool } from '../src/db/pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));

async function findFirst(candidates: string[]): Promise<string | null> {
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

async function main() {
  if (!pool) {
    console.error('DATABASE_URL is not set.');
    process.exitCode = 1;
    return;
  }
  const countriesOnly = process.argv.includes('--countries-only');

  const seedFile = await findFirst([
    path.resolve(here, '../../../db/seeds/reference.sql'),
    path.resolve(process.cwd(), 'db/seeds/reference.sql'),
    path.resolve(process.cwd(), '../../db/seeds/reference.sql'),
  ]);
  if (!seedFile) throw new Error('Could not locate db/seeds/reference.sql');

  await pool.query(await readFile(seedFile, 'utf8'));

  const cityFile = await findFirst([
    path.resolve(here, '../../../db/seeds/cities.csv.gz'),
    path.resolve(process.cwd(), 'db/seeds/cities.csv.gz'),
    path.resolve(process.cwd(), '../../db/seeds/cities.csv.gz'),
  ]);

  if (!countriesOnly && cityFile) {
    console.log('Importing global cities from db/seeds/cities.csv.gz …');
    let lastLogged = 0;
    const started = Date.now();
    const result = await importCities({
      file: cityFile,
      onProgress: (imported) => {
        if (imported - lastLogged >= 50_000) {
          lastLogged = imported;
          console.log(`  … ${imported.toLocaleString('en-US')} cities`);
        }
      },
    });
    console.log(
      `Cities imported: ${result.imported.toLocaleString('en-US')} in ` +
        `${((Date.now() - started) / 1000).toFixed(1)}s ` +
        `(${result.skipped} rejected rows).`,
    );
  }

  const counts = await pool.query<{ countries: string; cities: string }>(
    `SELECT (SELECT count(*) FROM countries) AS countries, (SELECT count(*) FROM cities) AS cities`,
  );
  console.log(
    `Seed applied: ${counts.rows[0]?.countries ?? 0} countries/territories, ` +
      `${counts.rows[0]?.cities ?? 0} cities.`,
  );
  console.log('Transit coverage: 0 stops unless you ingest a GTFS feed (npm run ingest:gtfs).');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end();
  });
