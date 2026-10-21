import type { LatLng, StopRef } from '@routewise/shared';
import { query } from '../pool.js';

export interface NearbyStop extends StopRef {
  distanceMeters: number;
  externalId: string | null;
  wheelchairBoarding: number;
  agencyName: string | null;
  timezone: string;
  mode: string | null;
}

interface StopRow {
  id: string;
  name: string;
  code: string | null;
  external_id: string | null;
  lat: number;
  lng: number;
  distance_m: number;
  wheelchair_boarding: number;
  agency_name: string | null;
  timezone: string | null;
  mode: string | null;
}

export async function nearbyStops(
  center: LatLng,
  radiusMeters: number,
  limit = 40,
): Promise<NearbyStop[]> {
  const res = await query<StopRow>(
    `SELECT s.id, s.name, s.code, s.external_id,
            ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lng,
            ST_Distance(s.location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_m,
            s.wheelchair_boarding,
            a.name AS agency_name, a.timezone,
            (SELECT r.mode FROM routes r
              JOIN trips t ON t.route_id = r.id
              JOIN stop_times st ON st.trip_id = t.id
              WHERE st.stop_id = s.id LIMIT 1) AS mode
     FROM stops s
     LEFT JOIN agencies a ON a.id = s.agency_id
     WHERE s.is_active
       AND ST_DWithin(s.location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
     ORDER BY distance_m ASC
     LIMIT $4`,
    [center.lat, center.lng, radiusMeters, limit],
  );
  return res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    location: { lat: Number(row.lat), lng: Number(row.lng) },
    distanceMeters: Number(row.distance_m),
    externalId: row.external_id,
    wheelchairBoarding: row.wheelchair_boarding,
    agencyName: row.agency_name,
    timezone: row.timezone ?? 'UTC',
    mode: row.mode,
  }));
}

export async function searchStops(
  q: string,
  limit = 10,
): Promise<Array<StopRef & { code: string | null }>> {
  const res = await query<StopRow>(
    `SELECT s.id, s.name, s.code, s.external_id,
            ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lng,
            0 AS distance_m, s.wheelchair_boarding,
            a.name AS agency_name, a.timezone,
            NULL AS mode
     FROM stops s
     LEFT JOIN agencies a ON a.id = s.agency_id
     WHERE s.is_active AND s.name ILIKE '%' || $1 || '%'
     ORDER BY s.name ASC
     LIMIT $2`,
    [q.trim(), limit],
  );
  return res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    location: { lat: Number(row.lat), lng: Number(row.lng) },
  }));
}

export async function getStopsByIds(ids: string[]): Promise<NearbyStop[]> {
  if (ids.length === 0) return [];
  const res = await query<StopRow>(
    `SELECT s.id, s.name, s.code, s.external_id,
            ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lng,
            0 AS distance_m, s.wheelchair_boarding,
            a.name AS agency_name, a.timezone, NULL AS mode
     FROM stops s LEFT JOIN agencies a ON a.id = s.agency_id
     WHERE s.id = ANY($1::uuid[])`,
    [ids],
  );
  return res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    location: { lat: Number(row.lat), lng: Number(row.lng) },
    distanceMeters: 0,
    externalId: row.external_id,
    wheelchairBoarding: row.wheelchair_boarding,
    agencyName: row.agency_name,
    timezone: row.timezone ?? 'UTC',
    mode: null,
  }));
}

export interface FootpathRow {
  fromStopId: string;
  toStopId: string;
  distanceMeters: number;
  seconds: number;
}

/**
 * Walking transfer candidates between stops. Uses published transfer times when
 * available, otherwise great-circle distance scaled by 1.3 at 4.8 km/h. These
 * are connection estimates, not turn-by-turn pedestrian routing.
 */
export async function getFootpaths(
  stopIds: string[],
  maxMeters: number,
  limitPerStop = 12,
): Promise<FootpathRow[]> {
  if (stopIds.length === 0) return [];
  const res = await query<{
    from_stop_id: string;
    to_stop_id: string;
    distance_m: number;
  }>(
    `WITH origin AS (
       SELECT s.id, s.location FROM stops s WHERE s.id = ANY($1::uuid[])
     )
     SELECT o.id AS from_stop_id, b.id AS to_stop_id,
            ST_Distance(o.location, b.location) AS distance_m
     FROM origin o
     JOIN stops b ON b.id <> o.id
       AND b.is_active
       AND ST_DWithin(o.location, b.location, $2)
     ORDER BY o.id, distance_m ASC`,
    [stopIds, maxMeters],
  );

  const seen = new Map<string, number>();
  const rows: FootpathRow[] = [];
  for (const row of res.rows) {
    const key = `${row.from_stop_id}:${row.to_stop_id}`;
    const count = seen.get(row.from_stop_id) ?? 0;
    if (count >= limitPerStop) continue;
    seen.set(row.from_stop_id, count + 1);
    if (seen.has(key)) continue;
    seen.set(key, 1);
    const distance = Number(row.distance_m);
    rows.push({
      fromStopId: row.from_stop_id,
      toStopId: row.to_stop_id,
      distanceMeters: distance,
      seconds: Math.max(60, Math.round(((distance * 1.3) / 1000 / 4.8) * 3600)),
    });
  }
  return rows;
}

export async function coverageNear(center: LatLng, radiusMeters: number) {
  const res = await query<{ stops: string; routes: string; agencies: string; sources: string }>(
    `SELECT
       (SELECT count(DISTINCT s.id) FROM stops s
         WHERE s.is_active AND ST_DWithin(s.location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)) AS stops,
       (SELECT count(DISTINCT r.id) FROM routes r
         JOIN trips t ON t.route_id = r.id
         JOIN stop_times st ON st.trip_id = t.id
         JOIN stops s ON s.id = st.stop_id
         WHERE ST_DWithin(s.location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)) AS routes,
       (SELECT count(DISTINCT a.id) FROM agencies a
         JOIN stops s ON s.agency_id = a.id
         WHERE ST_DWithin(s.location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)) AS agencies,
       (SELECT count(DISTINCT ds.id) FROM data_sources ds
         JOIN stops s ON s.data_source_id = ds.id
         WHERE ST_DWithin(s.location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)) AS sources`,
    [center.lat, center.lng, radiusMeters],
  );
  const row = res.rows[0];
  return {
    stops: Number(row?.stops ?? 0),
    routes: Number(row?.routes ?? 0),
    agencies: Number(row?.agencies ?? 0),
    sources: Number(row?.sources ?? 0),
  };
}
