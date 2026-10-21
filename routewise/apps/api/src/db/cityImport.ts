/**
 * Global city import.
 *
 * Two input formats are supported:
 *  - RouteWise's normalized CSV (db/seeds/cities.csv.gz), generated from GeoNames;
 *  - the raw GeoNames dump (cities500.txt, tab-separated, no header).
 *
 * Import is idempotent: rows are keyed by GeoNames id, so re-running refreshes
 * coordinates/population/timezone instead of duplicating cities.
 */
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { parse as parseCsv } from 'csv-parse';
import { pool } from './pool.js';

export interface CityImportOptions {
  /** Path to a .csv, .csv.gz or GeoNames .txt file. */
  file: string;
  batchSize?: number;
  limit?: number;
  onProgress?: (imported: number) => void;
}

export interface CityImportResult {
  imported: number;
  skipped: number;
  batches: number;
}

interface NormalizedCity {
  geoname_id: number;
  name: string;
  ascii_name: string;
  country_iso2: string;
  lat: number;
  lng: number;
  population: number;
  timezone: string;
  slug: string;
}

/** Locale-neutral slug: ASCII, lowercase, with the GeoNames id for uniqueness. */
export function citySlug(name: string, geonameId: number): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `${base || 'city'}-${geonameId}`;
}

function toCity(row: {
  geoname_id?: string;
  name?: string;
  ascii_name?: string;
  country_iso2?: string;
  lat?: string;
  lng?: string;
  population?: string;
  timezone?: string;
}): NormalizedCity | null {
  const id = Number(row.geoname_id);
  const name = (row.name ?? '').trim();
  const country = (row.country_iso2 ?? '').trim().toUpperCase();
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  const population = Number(row.population ?? 0);
  const timezone = (row.timezone ?? '').trim();
  if (!Number.isFinite(id) || !name || !/^[A-Z]{2}$/.test(country)) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (!timezone) return null;
  return {
    geoname_id: id,
    name,
    ascii_name: (row.ascii_name ?? '').trim() || name,
    country_iso2: country,
    lat,
    lng,
    population: Number.isFinite(population) && population > 0 ? Math.round(population) : 0,
    timezone,
    slug: citySlug(name, id),
  };
}

const INSERT_SQL = `
  WITH rows AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(
      geoname_id bigint, name text, ascii_name text, country_iso2 text,
      lat double precision, lng double precision, population integer,
      timezone text, slug text
    )
  )
  INSERT INTO cities
    (geoname_id, country_id, name, ascii_name, slug, timezone, center, default_currency, population)
  SELECT rows.geoname_id, co.id, rows.name, rows.ascii_name, rows.slug, rows.timezone,
         ST_SetSRID(ST_MakePoint(rows.lng, rows.lat), 4326)::geography,
         co.default_currency, GREATEST(rows.population, 0)
  FROM rows
  JOIN countries co ON co.iso2 = rows.country_iso2
  ON CONFLICT (geoname_id) DO UPDATE
    SET country_id = EXCLUDED.country_id,
        name = EXCLUDED.name,
        ascii_name = EXCLUDED.ascii_name,
        timezone = EXCLUDED.timezone,
        center = EXCLUDED.center,
        default_currency = EXCLUDED.default_currency,
        population = EXCLUDED.population,
        updated_at = now()`;

async function insertBatch(batch: NormalizedCity[]): Promise<number> {
  if (!pool) throw new Error('DATABASE_URL is not set.');
  if (batch.length === 0) return 0;
  const res = await pool.query(INSERT_SQL, [JSON.stringify(batch)]);
  return res.rowCount ?? 0;
}

function isGeoNamesText(file: string): boolean {
  return /\.txt$/i.test(file);
}

export async function importCities(options: CityImportOptions): Promise<CityImportResult> {
  if (!pool) throw new Error('DATABASE_URL is not set.');
  const batchSize = options.batchSize ?? 2000;

  // Cities reference countries; importing before the reference seed would
  // silently drop every row, so fail loudly instead.
  const countryCount = await pool.query<{ count: string }>('SELECT count(*) AS count FROM countries');
  if (Number(countryCount.rows[0]?.count ?? 0) === 0) {
    throw new Error(
      'No countries found. Run `npm run db:seed -- --countries-only` (or npm run db:seed) before importing cities.',
    );
  }

  const fileStream = createReadStream(options.file);
  const decompressed = /\.gz$/i.test(options.file) ? fileStream.pipe(createGunzip()) : fileStream;

  let imported = 0;
  let processed = 0;
  let skipped = 0;
  let batches = 0;
  let batch: NormalizedCity[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    imported += await insertBatch(batch);
    batches += 1;
    batch = [];
    options.onProgress?.(imported);
  };

  const push = async (city: NormalizedCity | null) => {
    if (!city) {
      skipped += 1;
      return;
    }
    batch.push(city);
    processed += 1;
    if (batch.length >= batchSize) await flush();
    if (options.limit && processed >= options.limit) {
      await flush();
      throw new StopImport();
    }
  };

  try {
    if (isGeoNamesText(options.file)) {
      // GeoNames dump: geonameid, name, asciiname, alternatenames, lat, lng,
      // feature class, feature code, country code, cc2, admin1..4, population,
      // elevation, dem, timezone, modification date.
      const parser = decompressed.pipe(parseCsv({ delimiter: '\t', relax_column_count: true }));
      for await (const record of parser as AsyncIterable<string[]>) {
        await push(
          toCity({
            geoname_id: record[0],
            name: record[1],
            ascii_name: record[2],
            country_iso2: record[8],
            lat: record[4],
            lng: record[5],
            population: record[14],
            timezone: record[17],
          }),
        );
      }
    } else {
      const parser = decompressed.pipe(
        parseCsv({ columns: true, skip_empty_lines: true, relax_column_count: true }),
      );
      for await (const record of parser as AsyncIterable<Record<string, string>>) {
        await push(toCity(record));
      }
    }
    await flush();
  } catch (err) {
    if (!(err instanceof StopImport)) throw err;
  }

  return { imported, skipped, batches };
}

class StopImport extends Error {}
