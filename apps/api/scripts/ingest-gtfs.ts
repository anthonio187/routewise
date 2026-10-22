/**
 * GTFS importer for authoritative local transit data.
 *
 *   npm run ingest:gtfs -- --zip ./feeds/london.zip \
 *     --code tfl-tube --name "Transport for London (GTFS)" \
 *     --url https://... --license "Open Government Licence v3" \
 *     --attribution "Transport for London" --official --city london
 *
 * Notes:
 *  - The feed's licence must permit database storage and display. You are
 *    responsible for verifying it.
 *  - Existing rows for the same source code are replaced (full refresh) unless
 *    --append is passed.
 *  - Large feeds are streamed in batches; stop_times is the heavy table.
 */
import path from 'node:path';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse';
import { pool } from '../src/db/pool.js';

interface Args {
  zip: string;
  code: string;
  name: string;
  url?: string;
  license?: string;
  licenseUrl?: string;
  attribution?: string;
  official: boolean;
  city?: string;
  timezone?: string;
  append: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    zip: '',
    code: '',
    name: '',
    official: false,
    append: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--zip':
        args.zip = next() ?? '';
        break;
      case '--code':
        args.code = next() ?? '';
        break;
      case '--name':
        args.name = next() ?? '';
        break;
      case '--url':
        args.url = next();
        break;
      case '--license':
        args.license = next();
        break;
      case '--license-url':
        args.licenseUrl = next();
        break;
      case '--attribution':
        args.attribution = next();
        break;
      case '--official':
        args.official = true;
        break;
      case '--city':
        args.city = next();
        break;
      case '--timezone':
        args.timezone = next();
        break;
      case '--append':
        args.append = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      default:
        if (arg?.startsWith('--')) throw new Error(`Unknown argument ${arg}`);
    }
  }
  if (!args.zip || !args.code || !args.name) {
    throw new Error('--zip, --code and --name are required');
  }
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(args.code)) {
    throw new Error('--code must be a lowercase slug (a-z, 0-9, -)');
  }
  return args;
}

const ROUTE_TYPES: Record<string, string> = {
  '0': 'tram',
  '1': 'subway',
  '2': 'train',
  '3': 'bus',
  '4': 'ferry',
  '5': 'cable_tram',
  '6': 'cable_tram',
  '7': 'funicular',
  '11': 'trolleybus',
  '12': 'monorail',
  '200': 'bus',
  '400': 'commuter_rail',
  '700': 'bus',
  '900': 'tram',
  '1000': 'ferry',
  '109': 'commuter_rail',
};

function gtfsSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.trim().split(':').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
}

function gtfsDate(value: string | undefined): string | null {
  if (!value || !/^\d{8}$/.test(value.trim())) return null;
  const v = value.trim();
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

class ZipCsv {
  constructor(private readonly zip: AdmZip) {}

  has(name: string): boolean {
    return this.zip.getEntry(name) != null;
  }

  async *rows(name: string): AsyncGenerator<Record<string, string>> {
    const entry = this.zip.getEntry(name);
    if (!entry) return;
    const parser = parse({
      columns: true,
      relax_quotes: true,
      relax_column_count: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
    });
    parser.write(entry.getData());
    parser.end();
    for await (const record of parser) {
      yield record as Record<string, string>;
    }
  }
}

/**
 * Resolve a city reference. Accepts, in order:
 *  1. an exact slug (`london-2643743`),
 *  2. a GeoNames id,
 *  3. an exact (ASCII-insensitive) name, preferring the largest population,
 *  4. a slug/name prefix, again preferring the largest population.
 * Returns null rather than guessing when nothing plausible matches.
 */
async function resolveCity(
  client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ id: string }> }> },
  reference: string,
): Promise<string | null> {
  const ref = reference.trim();
  if (!ref) return null;

  const numeric = /^\d+$/.test(ref);
  const res = await client.query(
    `SELECT id FROM cities
     WHERE slug = $1
        OR ($2::boolean AND geoname_id = $1::bigint)
        OR lower(ascii_name) = lower($1)
        OR lower(name) = lower($1)
        OR slug LIKE lower($1) || '-%'
     ORDER BY (slug = $1) DESC,
              ($2::boolean AND geoname_id = $1::bigint) DESC,
              population DESC NULLS LAST
     LIMIT 1`,
    [ref, numeric],
  );
  return res.rows[0]?.id ?? null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!pool) {
    console.error('DATABASE_URL is not set.');
    process.exitCode = 1;
    return;
  }
  const zip = new AdmZip(path.resolve(args.zip));
  const csv = new ZipCsv(zip);

  const stats: Record<string, number> = {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (!args.append) {
      await client.query(
        `DELETE FROM data_sources WHERE code = $1`, // cascades stops/routes/trips etc.
        [args.code],
      );
    }

    const source = await client.query<{ id: string }>(
      `INSERT INTO data_sources (code, name, kind, url, license_name, license_url, attribution, is_official)
       VALUES ($1, $2, 'gtfs', $3, $4, $5, $6, $7)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url,
         license_name = EXCLUDED.license_name, license_url = EXCLUDED.license_url,
         attribution = EXCLUDED.attribution, is_official = EXCLUDED.is_official, updated_at = now()
       RETURNING id`,
      [args.code, args.name, args.url ?? null, args.license ?? null, args.licenseUrl ?? null, args.attribution ?? null, args.official],
    );
    const sourceId = source.rows[0]!.id;

    let cityId: string | null = null;
    if (args.city) {
      cityId = await resolveCity(client, args.city);
      if (!cityId) {
        console.warn(
          `City "${args.city}" not found. Pass a slug (e.g. london-2643743), a GeoNames id, ` +
            'or a city name. Stops will not be linked to a city.',
        );
      }
    }

    // --- agency.txt ---------------------------------------------------------
    const agencyIds = new Map<string, string>();
    for await (const row of csv.rows('agency.txt')) {
      const externalId = String(row.agency_id ?? 'default');
      const res = await client.query<{ id: string }>(
        `INSERT INTO agencies (data_source_id, external_id, name, url, timezone, language, phone, city_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (data_source_id, external_id) DO UPDATE SET name = EXCLUDED.name,
           url = EXCLUDED.url, timezone = EXCLUDED.timezone, city_id = EXCLUDED.city_id
         RETURNING id`,
        [
          sourceId,
          externalId,
          row.agency_name ?? args.name,
          row.agency_url ?? null,
          row.agency_timezone ?? args.timezone ?? 'UTC',
          row.agency_lang ?? null,
          row.agency_phone ?? null,
          cityId,
        ],
      );
      agencyIds.set(externalId, res.rows[0]!.id);
    }

    // --- stops.txt ----------------------------------------------------------
    let stopBatch: Array<{ id: string; name: string; code: string | null; lat: number; lon: number; wheelchair: number }> = [];
    const flushStops = async () => {
      if (stopBatch.length === 0) return;
      await client.query(
        `INSERT INTO stops (agency_id, city_id, data_source_id, external_id, name, code, location, wheelchair_boarding)
         SELECT $1, $2, $3, u.external_id, u.name, u.code,
                ST_SetSRID(ST_MakePoint(u.lon, u.lat), 4326)::geography, u.wheelchair
         FROM unnest($4::text[], $5::text[], $6::text[], $7::float8[], $8::float8[], $9::int[])
           AS u(external_id, name, code, lon, lat, wheelchair)
         ON CONFLICT (data_source_id, external_id) DO UPDATE SET
           name = EXCLUDED.name, code = EXCLUDED.code, location = EXCLUDED.location,
           wheelchair_boarding = EXCLUDED.wheelchair_boarding`,
        [
          [...agencyIds.values()][0] ?? null,
          null, // linked to a city after import, from the stop coordinates
          sourceId,
          stopBatch.map((s) => s.id),
          stopBatch.map((s) => s.name),
          stopBatch.map((s) => s.code),
          stopBatch.map((s) => s.lon),
          stopBatch.map((s) => s.lat),
          stopBatch.map((s) => s.wheelchair),
        ],
      );
      stats.stops = (stats.stops ?? 0) + stopBatch.length;
      stopBatch = [];
    };
    const parentLinks: Array<{ child: string; parent: string }> = [];
    for await (const row of csv.rows('stops.txt')) {
      const lat = Number(row.stop_lat);
      const lon = Number(row.stop_lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      stopBatch.push({
        id: String(row.stop_id),
        name: String(row.stop_name ?? row.stop_id),
        code: row.stop_code ? String(row.stop_code) : null,
        lat,
        lon,
        wheelchair: Number(row.wheelchair_boarding ?? 0) || 0,
      });
      if (row.parent_station) parentLinks.push({ child: String(row.stop_id), parent: String(row.parent_station) });
      if (stopBatch.length >= 1000) await flushStops();
    }
    await flushStops();

    // --- city attribution ---------------------------------------------------
    // Assign every stop the nearest city within 35 km. This keeps a feed that
    // crosses municipal borders honest instead of stamping one city on all of
    // it, and it lets `--city` act as a fallback rather than an assumption.
    const linked = await client.query(
      `UPDATE stops s
       SET city_id = nearest.city_id
       FROM (
         SELECT s2.id AS stop_id, c.id AS city_id
         FROM stops s2
         CROSS JOIN LATERAL (
           SELECT c.id
           FROM cities c
           WHERE ST_DWithin(c.center, s2.location, 35000)
           ORDER BY c.center <-> s2.location
           LIMIT 1
         ) c
         WHERE s2.data_source_id = $1 AND s2.city_id IS NULL
       ) nearest
       WHERE s.id = nearest.stop_id`,
      [sourceId],
    );
    stats.stops_linked_to_city = linked.rowCount ?? 0;

    if (cityId) {
      // Fallback for stops outside every known city centre but still reasonably
      // close to the city the operator named (large municipal territories).
      const fallback = await client.query(
        `UPDATE stops s SET city_id = $2
         FROM cities c
         WHERE c.id = $2 AND s.data_source_id = $1 AND s.city_id IS NULL
           AND ST_DWithin(c.center, s.location, 150000)`,
        [sourceId, cityId],
      );
      stats.stops_linked_by_flag = fallback.rowCount ?? 0;
    }

    // Routes and agencies inherit the predominant city of the stops they serve.
    await client.query(
      `UPDATE routes r SET city_id = pick.city_id
       FROM (
         SELECT t.route_id, mode() WITHIN GROUP (ORDER BY s.city_id) AS city_id
         FROM trips t
         JOIN stop_times st ON st.trip_id = t.id
         JOIN stops s ON s.id = st.stop_id
         WHERE s.data_source_id = $1 AND s.city_id IS NOT NULL
         GROUP BY t.route_id
       ) pick
       WHERE r.id = pick.route_id AND r.city_id IS NULL AND pick.city_id IS NOT NULL`,
      [sourceId],
    );
    await client.query(
      `UPDATE agencies a SET city_id = pick.city_id
       FROM (
         SELECT s.agency_id, mode() WITHIN GROUP (ORDER BY s.city_id) AS city_id
         FROM stops s
         WHERE s.data_source_id = $1 AND s.city_id IS NOT NULL AND s.agency_id IS NOT NULL
         GROUP BY s.agency_id
       ) pick
       WHERE a.id = pick.agency_id AND a.city_id IS NULL AND pick.city_id IS NOT NULL`,
      [sourceId],
    );

    if (parentLinks.length > 0) {
      await client.query(
        `UPDATE stops c SET parent_stop_id = p.id
         FROM unnest($1::text[], $2::text[]) AS u(child, parent)
         JOIN stops p ON p.data_source_id = $3 AND p.external_id = u.parent
         WHERE c.data_source_id = $3 AND c.external_id = u.child`,
        [parentLinks.map((l) => l.child), parentLinks.map((l) => l.parent), sourceId],
      );
    }

    // --- routes.txt ---------------------------------------------------------
    let routeCount = 0;
    for await (const row of csv.rows('routes.txt')) {
      await client.query(
        `INSERT INTO routes (agency_id, city_id, data_source_id, external_id, short_name, long_name,
            description, mode, route_type, color, text_color, wheelchair_accessible, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (data_source_id, external_id) DO UPDATE SET
           short_name = EXCLUDED.short_name, long_name = EXCLUDED.long_name, mode = EXCLUDED.mode,
           color = EXCLUDED.color, text_color = EXCLUDED.text_color`,
        [
          agencyIds.get(String(row.agency_id ?? 'default')) ?? null,
          cityId,
          sourceId,
          String(row.route_id),
          row.route_short_name ?? null,
          row.route_long_name ?? null,
          row.route_desc ?? null,
          ROUTE_TYPES[String(row.route_type ?? '3')] ?? 'other',
          Number(row.route_type ?? 3) || 3,
          /^[0-9a-f]{6}$/i.test(String(row.route_color ?? '')) ? String(row.route_color) : null,
          /^[0-9a-f]{6}$/i.test(String(row.route_text_color ?? '')) ? String(row.route_text_color) : null,
          Number(row.wheelchair_accessible ?? 0) || 0,
          Number(row.route_sort_order ?? 0) || 0,
        ],
      );
      routeCount += 1;
    }
    stats.routes = routeCount;

    // --- calendar.txt / calendar_dates.txt ---------------------------------
    const calendars = new Map<string, string>();
    let calendarRows = 0;
    for await (const row of csv.rows('calendar.txt')) {
      const res = await client.query<{ id: string }>(
        `INSERT INTO service_calendars (data_source_id, external_id, name, monday, tuesday, wednesday,
            thursday, friday, saturday, sunday, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (data_source_id, external_id) DO UPDATE SET
           monday = EXCLUDED.monday, tuesday = EXCLUDED.tuesday, wednesday = EXCLUDED.wednesday,
           thursday = EXCLUDED.thursday, friday = EXCLUDED.friday, saturday = EXCLUDED.saturday,
           sunday = EXCLUDED.sunday, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date
         RETURNING id`,
        [
          sourceId,
          String(row.service_id),
          row.service_id ? String(row.service_id) : null,
          row.monday === '1', row.tuesday === '1', row.wednesday === '1', row.thursday === '1',
          row.friday === '1', row.saturday === '1', row.sunday === '1',
          gtfsDate(row.start_date), gtfsDate(row.end_date),
        ],
      );
      calendars.set(String(row.service_id), res.rows[0]!.id);
      calendarRows += 1;
    }

    const exceptions: Array<{ service: string; date: string; type: number }> = [];
    for await (const row of csv.rows('calendar_dates.txt')) {
      const date = gtfsDate(row.date);
      if (!date) continue;
      exceptions.push({ service: String(row.service_id), date, type: Number(row.exception_type) });
    }

    if (calendars.size === 0 && exceptions.length > 0) {
      // calendar_dates-only feed: synthesise an all-days calendar per service.
      const dates = exceptions.map((e) => e.date).sort();
      const services = [...new Set(exceptions.map((e) => e.service))];
      for (const service of services) {
        const res = await client.query<{ id: string }>(
          `INSERT INTO service_calendars (data_source_id, external_id, name, monday, tuesday, wednesday,
              thursday, friday, saturday, sunday, start_date, end_date)
           VALUES ($1, $2, $2, true, true, true, true, true, true, true, $3, $4)
           ON CONFLICT (data_source_id, external_id) DO UPDATE SET start_date = EXCLUDED.start_date,
             end_date = EXCLUDED.end_date
           RETURNING id`,
          [sourceId, service, dates[0], dates.at(-1)],
        );
        calendars.set(service, res.rows[0]!.id);
      }
    }
    stats.calendars = calendarRows + calendars.size;

    for (const exception of exceptions) {
      const calendarId = calendars.get(exception.service);
      if (!calendarId) continue;
      await client.query(
        `INSERT INTO service_exceptions (calendar_id, exception_date, exception_type)
         VALUES ($1, $2, $3) ON CONFLICT (calendar_id, exception_date) DO UPDATE
         SET exception_type = EXCLUDED.exception_type`,
        [calendarId, exception.date, exception.type],
      );
    }

    // --- trips.txt ----------------------------------------------------------
    let tripCount = 0;
    for await (const row of csv.rows('trips.txt')) {
      await client.query(
        `INSERT INTO trips (route_id, calendar_id, data_source_id, external_id, direction_id,
            headsign, short_name, wheelchair_accessible, bikes_allowed)
         SELECT r.id, $2, $3, $4, $5, $6, $7, $8, $9 FROM routes r
         WHERE r.data_source_id = $3 AND r.external_id = $1
         ON CONFLICT (data_source_id, external_id) DO UPDATE SET
           headsign = EXCLUDED.headsign, wheelchair_accessible = EXCLUDED.wheelchair_accessible`,
        [
          String(row.route_id),
          calendars.get(String(row.service_id)) ?? null,
          sourceId,
          String(row.trip_id),
          Number(row.direction_id ?? 0) || 0,
          row.trip_headsign ?? null,
          row.trip_short_name ?? null,
          Number(row.wheelchair_accessible ?? 0) || 0,
          Number(row.bikes_allowed ?? 0) || 0,
        ],
      );
      tripCount += 1;
    }
    stats.trips = tripCount;

    // --- stop_times.txt (streamed, batched) --------------------------------
    let batch: Array<{
      trip: string;
      seq: number;
      stop: string;
      arr: number;
      dep: number;
      pickup: number;
      dropoff: number;
      timepoint: boolean;
    }> = [];
    let stopTimes = 0;
    const flushStopTimes = async () => {
      if (batch.length === 0) return;
      await client.query(
        `INSERT INTO stop_times (trip_id, stop_sequence, stop_id, arrival_seconds, departure_seconds,
            pickup_type, drop_off_type, timepoint)
         SELECT t.id, u.seq, s.id, u.arr, u.dep, u.pickup, u.dropoff, u.timepoint
         FROM unnest($1::text[], $2::int[], $3::text[], $4::int[], $5::int[], $6::int[], $7::int[], $8::boolean[])
           AS u(trip_ext, seq, stop_ext, arr, dep, pickup, dropoff, timepoint)
         JOIN trips t ON t.data_source_id = $9 AND t.external_id = u.trip_ext
         JOIN stops s ON s.data_source_id = $9 AND s.external_id = u.stop_ext
         ON CONFLICT (trip_id, stop_sequence) DO UPDATE SET
           stop_id = EXCLUDED.stop_id, arrival_seconds = EXCLUDED.arrival_seconds,
           departure_seconds = EXCLUDED.departure_seconds, pickup_type = EXCLUDED.pickup_type,
           drop_off_type = EXCLUDED.drop_off_type, timepoint = EXCLUDED.timepoint`,
        [
          batch.map((b) => b.trip),
          batch.map((b) => b.seq),
          batch.map((b) => b.stop),
          batch.map((b) => b.arr),
          batch.map((b) => b.dep),
          batch.map((b) => b.pickup),
          batch.map((b) => b.dropoff),
          batch.map((b) => b.timepoint),
          sourceId,
        ],
      );
      stopTimes += batch.length;
      batch = [];
    };

    for await (const row of csv.rows('stop_times.txt')) {
      const arrival = gtfsSeconds(row.arrival_time) ?? gtfsSeconds(row.departure_time);
      const departure = gtfsSeconds(row.departure_time) ?? arrival;
      if (arrival === null || departure === null) continue;
      batch.push({
        trip: String(row.trip_id),
        seq: Number(row.stop_sequence),
        stop: String(row.stop_id),
        arr: arrival,
        dep: departure,
        pickup: Number(row.pickup_type ?? 0) || 0,
        dropoff: Number(row.drop_off_type ?? 0) || 0,
        timepoint: row.timepoint !== '0',
      });
      if (batch.length >= 2000) await flushStopTimes();
    }
    await flushStopTimes();
    stats.stop_times = stopTimes;

    // --- transfers.txt ------------------------------------------------------
    let transferCount = 0;
    for await (const row of csv.rows('transfers.txt')) {
      await client.query(
        `INSERT INTO transfers (data_source_id, from_stop_id, to_stop_id, transfer_type,
            min_transfer_seconds, walk_seconds)
         SELECT $1, f.id, t.id, $4, $5, $5
         FROM stops f, stops t
         WHERE f.data_source_id = $1 AND f.external_id = $2
           AND t.data_source_id = $1 AND t.external_id = $3
         ON CONFLICT (data_source_id, from_stop_id, to_stop_id) DO UPDATE
         SET min_transfer_seconds = EXCLUDED.min_transfer_seconds`,
        [
          sourceId,
          String(row.from_stop_id),
          String(row.to_stop_id),
          Number(row.transfer_type ?? 0) || 0,
          gtfsSeconds(row.min_transfer_time),
        ],
      );
      transferCount += 1;
    }
    stats.transfers = transferCount;

    // --- shapes.txt ---------------------------------------------------------
    let shapeCount = 0;
    let shapeBatch: Array<{ shape: string; seq: number; lat: number; lon: number }> = [];
    const flushShapes = async () => {
      if (shapeBatch.length === 0) return;
      await client.query(
        `INSERT INTO shape_points (data_source_id, shape_id, seq, location)
         SELECT $1, u.shape, u.seq, ST_SetSRID(ST_MakePoint(u.lon, u.lat), 4326)::geography
         FROM unnest($2::text[], $3::int[], $4::float8[], $5::float8[])
           AS u(shape, seq, lat, lon)
         ON CONFLICT (data_source_id, shape_id, seq) DO NOTHING`,
        [
          sourceId,
          shapeBatch.map((s) => s.shape),
          shapeBatch.map((s) => s.seq),
          shapeBatch.map((s) => s.lat),
          shapeBatch.map((s) => s.lon),
        ],
      );
      shapeCount += shapeBatch.length;
      shapeBatch = [];
    };
    for await (const row of csv.rows('shapes.txt')) {
      shapeBatch.push({
        shape: String(row.shape_id),
        seq: Number(row.shape_pt_sequence),
        lat: Number(row.shape_pt_lat),
        lon: Number(row.shape_pt_lon),
      });
      if (shapeBatch.length >= 3000) await flushShapes();
    }
    await flushShapes();
    stats.shape_points = shapeCount;

    await client.query(
      `UPDATE data_sources SET last_imported_at = now(), updated_at = now() WHERE id = $1`,
      [sourceId],
    );
    await client.query(
      `INSERT INTO source_imports (data_source_id, finished_at, status, stats)
       VALUES ($1, now(), 'success', $2::jsonb)`,
      [sourceId, JSON.stringify(stats)],
    );

    if (args.dryRun) {
      await client.query('ROLLBACK');
      console.log('Dry run — rolled back. Stats:', stats);
    } else {
      await client.query('COMMIT');
      console.log('Imported GTFS feed:', stats);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end();
  });
