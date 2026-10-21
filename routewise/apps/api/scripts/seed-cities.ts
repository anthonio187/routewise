/**
 * Import global cities.
 *
 *   npm run seed:cities                       # bundled GeoNames cities500 extract (~236k places)
 *   npm run seed:cities -- --dataset cities1000   # download a different GeoNames dataset
 *   npm run seed:cities -- --file ./cities.txt    # raw GeoNames dump, tab-separated
 *   npm run seed:cities -- --limit 5000           # smoke test
 *
 * Source: GeoNames (https://www.geonames.org/), CC BY 4.0. Attribution is
 * required when you redistribute or display the data. A city is only a
 * discovery/geocoding anchor — it is never a claim of transit coverage.
 */
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { importCities } from '../src/db/cityImport.js';
import { pool } from '../src/db/pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));

interface Args {
  file?: string;
  dataset?: string;
  batchSize?: number;
  limit?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--file':
        args.file = next();
        break;
      case '--dataset':
        args.dataset = next();
        break;
      case '--batch':
        args.batchSize = Number(next());
        break;
      case '--limit':
        args.limit = Number(next());
        break;
      default:
        break;
    }
  }
  return args;
}

async function bundledSeed(): Promise<string | null> {
  const candidates = [
    path.resolve(here, '../../../db/seeds/cities.csv.gz'),
    path.resolve(process.cwd(), 'db/seeds/cities.csv.gz'),
    path.resolve(process.cwd(), '../../db/seeds/cities.csv.gz'),
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

/** Download a GeoNames city dataset and extract its .txt member. */
async function downloadDataset(dataset: string): Promise<string> {
  if (!/^cities\d+$/.test(dataset)) {
    throw new Error(`Unknown dataset "${dataset}". Expected cities500, cities1000, cities5000 or cities15000.`);
  }
  const url = `https://download.geonames.org/export/dump/${dataset}.zip`;
  console.log(`Downloading ${url} …`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry(`${dataset}.txt`);
  if (!entry) throw new Error(`${dataset}.txt not found inside the archive`);
  const dir = await mkdtemp(path.join(tmpdir(), 'routewise-cities-'));
  const target = path.join(dir, `${dataset}.txt`);
  await writeFile(target, entry.getData());
  return target;
}

async function main() {
  if (!pool) {
    console.error('DATABASE_URL is not set.');
    process.exitCode = 1;
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  let file = args.file;
  if (!file && args.dataset) file = await downloadDataset(args.dataset);
  if (!file) {
    const bundled = await bundledSeed();
    if (!bundled) {
      throw new Error(
        'No city seed found. Pass --file, --dataset cities1000, or run from the repository root.',
      );
    }
    file = bundled;
  }

  const started = Date.now();
  let lastLogged = 0;
  const result = await importCities({
    file,
    batchSize: args.batchSize,
    limit: args.limit,
    onProgress: (imported) => {
      if (imported - lastLogged >= 20_000) {
        lastLogged = imported;
        console.log(`  … ${imported.toLocaleString('en-US')} cities`);
      }
    },
  });

  const counts = await pool.query<{
    cities: string;
    countries: string;
    countries_with_cities: string;
  }>(
    `SELECT (SELECT count(*) FROM cities) AS cities,
            (SELECT count(*) FROM countries) AS countries,
            (SELECT count(DISTINCT country_id) FROM cities) AS countries_with_cities`,
  );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `Imported ${result.imported.toLocaleString('en-US')} rows in ${seconds}s ` +
      `(${result.batches} batches, ${result.skipped} rejected).`,
  );
  console.log(
    `Database now holds ${counts.rows[0]?.cities} cities across ` +
      `${counts.rows[0]?.countries_with_cities} of ${counts.rows[0]?.countries} countries/territories.`,
  );
  console.log('Reminder: city rows are discovery anchors, not transit coverage.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end();
  });
