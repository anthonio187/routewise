import type { CitySummary } from '@routewise/shared';
import { query } from '../pool.js';

interface CityRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  default_currency: string | null;
  country_code: string;
  center_lat: number;
  center_lng: number;
  stop_count: string | number | null;
  route_count: string | number | null;
  distance_m: number | null;
  population: number | null;
}

const SELECT_CITY = `
  SELECT c.id, c.name, c.slug, c.timezone, c.default_currency, c.population,
         co.iso2 AS country_code,
         ST_Y(c.center::geometry) AS center_lat,
         ST_X(c.center::geometry) AS center_lng,
         (SELECT count(*) FROM stops s WHERE s.city_id = c.id AND s.is_active) AS stop_count,
         (SELECT count(*) FROM routes r WHERE r.city_id = c.id) AS route_count
  FROM cities c
  JOIN countries co ON co.id = c.country_id
`;

export async function findNearestCity(
  lat: number,
  lng: number,
  maxKm = 80,
): Promise<(CitySummary & { slug: string }) | null> {
  const res = await query<CityRow>(
    `${SELECT_CITY}
     WHERE ST_DWithin(c.center, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
     ORDER BY ST_Distance(c.center, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography)
     LIMIT 1`,
    [lat, lng, maxKm * 1000],
  );
  const row = res.rows[0];
  if (!row) return null;
  return mapCity(row);
}

export async function listCities(q?: string, limit = 60): Promise<CitySummary[]> {
  // Pick the best matches first (population is the only globally available
  // relevance signal), then compute stop/route counts for just those rows.
  // This keeps search fast with hundreds of thousands of cities.
  const res = await query<CityRow>(
    `WITH picked AS (
       SELECT c.id, c.population
       FROM cities c
       WHERE ($1::text IS NULL OR c.name ILIKE '%' || $1 || '%' OR c.ascii_name ILIKE '%' || $1 || '%')
       ORDER BY c.population DESC NULLS LAST, c.name ASC
       LIMIT $2
     )
     SELECT c.id, c.name, c.slug, c.timezone, c.default_currency, c.population,
            co.iso2 AS country_code,
            ST_Y(c.center::geometry) AS center_lat,
            ST_X(c.center::geometry) AS center_lng,
            (SELECT count(*) FROM stops s WHERE s.city_id = c.id AND s.is_active) AS stop_count,
            (SELECT count(*) FROM routes r WHERE r.city_id = c.id) AS route_count
     FROM picked p
     JOIN cities c ON c.id = p.id
     JOIN countries co ON co.id = c.country_id
     ORDER BY (SELECT count(*) FROM stops s WHERE s.city_id = c.id AND s.is_active) DESC,
              c.population DESC NULLS LAST, c.name ASC`,
    [q?.trim() ? q.trim() : null, limit],
  );
  return res.rows.map(mapCity);
}

/**
 * Fast city lookup for the place-search dropdown.
 *
 * Prefix matches come first, then substring matches, both ordered by
 * population, so typing "lag" in Nigeria offers Lagos before smaller namesakes.
 * `near` adds distance as a tiebreaker when the query is ambiguous.
 */
export async function findCitiesForSearch(
  q: string,
  limit = 5,
  near?: { lat: number; lng: number },
): Promise<Array<{ id: string; name: string; countryCode: string; location: { lat: number; lng: number }; population: number | null; timezone: string }>> {
  const term = q.trim();
  if (term.length < 2) return [];
  const res = await query<{
    id: string;
    name: string;
    country_code: string;
    center_lat: number;
    center_lng: number;
    population: number | null;
    timezone: string;
    distance_m: number | null;
  }>(
    `SELECT c.id, c.name, co.iso2 AS country_code,
            ST_Y(c.center::geometry) AS center_lat,
            ST_X(c.center::geometry) AS center_lng,
            c.population, c.timezone,
            CASE WHEN $3::float8 IS NULL THEN NULL
                 ELSE ST_Distance(c.center, ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326)::geography)
            END AS distance_m,
            (c.name ILIKE $1::text || '%' OR c.ascii_name ILIKE $1::text || '%') AS is_prefix
     FROM cities c
     JOIN countries co ON co.id = c.country_id
     WHERE c.name ILIKE $1::text || '%' OR c.ascii_name ILIKE $1::text || '%'
        OR c.name ILIKE '%' || $1::text || '%' OR c.ascii_name ILIKE '%' || $1::text || '%'
     -- PostgreSQL only accepts a bare output alias in ORDER BY, never an alias
     -- inside an expression, so the CASE is written out again here.
     ORDER BY is_prefix DESC,
              c.population DESC NULLS LAST,
              CASE WHEN $3::float8 IS NULL THEN 0
                   ELSE ST_Distance(c.center, ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326)::geography)
              END ASC,
              c.name ASC
     LIMIT $2`,
    [term, limit, near?.lat ?? null, near?.lng ?? null],
  );
  return res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    countryCode: row.country_code,
    location: { lat: Number(row.center_lat), lng: Number(row.center_lng) },
    population: row.population,
    timezone: row.timezone,
  }));
}

/**
 * Nearest city plus its country name, used to qualify POI searches locally
 * ("market" -> "market Maiduguri Nigeria"). Returns null when nothing seeded
 * is within `maxKm`, so a far-away city is never used to skew a search.
 */
export async function findNearestCityWithCountry(
  lat: number,
  lng: number,
  maxKm = 60,
): Promise<{ name: string; countryName: string; countryCode: string } | null> {
  const res = await query<{ name: string; country_name: string; iso2: string; distance_m: number }>(
    `SELECT c.name, co.name AS country_name, co.iso2,
            ST_Distance(c.center, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_m
     FROM cities c
     JOIN countries co ON co.id = c.country_id
     WHERE ST_DWithin(c.center, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
     ORDER BY distance_m ASC
     LIMIT 1`,
    [lat, lng, maxKm * 1000],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { name: row.name, countryName: row.country_name, countryCode: row.iso2 };
}

export interface CitySearchOptions {
  q?: string;
  country?: string;
  hasTransit?: boolean;
  limit?: number;
  offset?: number;
}

export interface CitySearchResult {
  cities: CitySummary[];
  total: number;
}

/** Paginated city search with country and coverage filters (Explore page). */
export async function searchCities(options: CitySearchOptions = {}): Promise<CitySearchResult> {
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const q = options.q?.trim() ? options.q.trim() : null;
  const country = options.country?.trim() ? options.country.trim().toUpperCase() : null;
  const hasTransit = options.hasTransit ? true : null;

  const filter = `WHERE ($1::text IS NULL OR c.name ILIKE '%' || $1 || '%' OR c.ascii_name ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR co.iso2 = $2)
       AND ($3::boolean IS NULL OR EXISTS (SELECT 1 FROM stops s WHERE s.city_id = c.id AND s.is_active))`;

  const counted = await query<{ total: string }>(
    `SELECT count(*) AS total
     FROM cities c JOIN countries co ON co.id = c.country_id
     ${filter}`,
    [q, country, hasTransit],
  );

  const res = await query<CityRow>(
    `SELECT c.id, c.name, c.slug, c.timezone, c.default_currency, c.population,
            co.iso2 AS country_code,
            ST_Y(c.center::geometry) AS center_lat,
            ST_X(c.center::geometry) AS center_lng,
            (SELECT count(*) FROM stops s WHERE s.city_id = c.id AND s.is_active) AS stop_count,
            (SELECT count(*) FROM routes r WHERE r.city_id = c.id) AS route_count
     FROM cities c JOIN countries co ON co.id = c.country_id
     ${filter}
     ORDER BY (SELECT count(*) FROM stops s WHERE s.city_id = c.id AND s.is_active) DESC,
              c.population DESC NULLS LAST, c.name ASC
     LIMIT $4 OFFSET $5`,
    [q, country, hasTransit, limit, offset],
  );

  return { cities: res.rows.map(mapCity), total: Number(counted.rows[0]?.total ?? 0) };
}

export async function getCityById(id: string): Promise<CitySummary | null> {
  const res = await query<CityRow>(`${SELECT_CITY} WHERE c.id = $1`, [id]);
  const row = res.rows[0];
  return row ? mapCity(row) : null;
}

/** Resolve the city for an arbitrary place, creating a minimal record if unknown. */
export async function ensureCityForPoint(
  lat: number,
  lng: number,
  hints?: { name?: string; countryCode?: string; timezone?: string; currency?: string },
): Promise<CitySummary | null> {
  const nearest = await findNearestCity(lat, lng, 80);
  if (nearest) return nearest;

  const countryCode = hints?.countryCode?.toUpperCase();
  if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) return null;
  const country = await query<{ id: string }>('SELECT id FROM countries WHERE iso2 = $1', [
    countryCode,
  ]);
  const countryId = country.rows[0]?.id;
  if (!countryId || !hints?.name) return null;

  const slug = `${hints.name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}-${Math.round(lat * 100)}-${Math.round(lng * 100)}`;
  const inserted = await query<CityRow>(
    `WITH ins AS (
       INSERT INTO cities (country_id, name, slug, timezone, center, default_currency)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, $7)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id
     )
     ${SELECT_CITY}
     WHERE c.slug = $3`,
    [
      countryId,
      hints.name,
      slug,
      hints.timezone ?? 'UTC',
      lat,
      lng,
      hints.currency?.toUpperCase() ?? null,
    ],
  );
  const row = inserted.rows[0];
  return row ? mapCity(row) : null;
}

function mapCity(row: CityRow): CitySummary & { slug: string } {
  const stopCount = Number(row.stop_count ?? 0);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    countryCode: row.country_code,
    timezone: row.timezone,
    defaultCurrency: row.default_currency ?? '',
    center: { lat: Number(row.center_lat), lng: Number(row.center_lng) },
    stopCount,
    hasTransitData: stopCount > 0,
    population: row.population === null || row.population === undefined ? null : Number(row.population),
  };
}
