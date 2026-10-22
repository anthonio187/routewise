/**
 * Scheduled transit repository.
 *
 * Forward search of the timetable graph (RAPTOR/RoundBased style): given stops
 * reachable on foot from the origin, it finds the earliest arrival at every stop
 * for each "round" (number of vehicles boarded). This is the local-GTFS engine;
 * when a global transit provider such as Transitous is configured, the planner
 * prefers that provider and this module powers offline/authoritative datasets.
 */
import { query } from '../pool.js';

export interface DepartureRow {
  trip_id: string;
  route_id: string;
  stop_id: string;
  stop_sequence: number;
  departure_seconds: number;
  arrival_seconds: number;
  route_short_name: string | null;
  route_long_name: string | null;
  mode: string;
  route_color: string | null;
  route_text_color: string | null;
  agency_name: string | null;
  agency_timezone: string;
  headsign: string | null;
  wheelchair_accessible: number;
  stop_wheelchair_boarding: number;
}

/** Trips that depart each stop between two seconds-since-service-day values. */
export async function departuresFromStops(
  stopIds: string[],
  serviceDate: string,
  minSeconds: number,
  maxSeconds: number,
  limitPerStop = 80,
): Promise<DepartureRow[]> {
  if (stopIds.length === 0) return [];
  const res = await query<DepartureRow>(
    `WITH active AS (
       SELECT t.id AS trip_id
       FROM trips t
       JOIN service_calendars c ON c.id = t.calendar_id
       WHERE $2::date BETWEEN c.start_date AND c.end_date
         AND (
           (EXTRACT(ISODOW FROM $2::date) = 1 AND c.monday)
        OR (EXTRACT(ISODOW FROM $2::date) = 2 AND c.tuesday)
        OR (EXTRACT(ISODOW FROM $2::date) = 3 AND c.wednesday)
        OR (EXTRACT(ISODOW FROM $2::date) = 4 AND c.thursday)
        OR (EXTRACT(ISODOW FROM $2::date) = 5 AND c.friday)
        OR (EXTRACT(ISODOW FROM $2::date) = 6 AND c.saturday)
        OR (EXTRACT(ISODOW FROM $2::date) = 7 AND c.sunday)
         )
       EXCEPT
       SELECT c.id FROM trips t JOIN service_calendars c ON c.id = t.calendar_id
       JOIN service_exceptions e ON e.calendar_id = c.id
       WHERE e.exception_date = $2::date AND e.exception_type = 2
       UNION
       SELECT c.id FROM trips t JOIN service_calendars c ON c.id = t.calendar_id
       JOIN service_exceptions e ON e.calendar_id = c.id
       WHERE e.exception_date = $2::date AND e.exception_type = 1
     ),
     ranked AS (
       SELECT st.trip_id, st.stop_id, st.stop_sequence, st.departure_seconds, st.arrival_seconds,
              t.route_id, t.headsign, t.wheelchair_accessible,
              s.wheelchair_boarding AS stop_wheelchair_boarding,
              ROW_NUMBER() OVER (PARTITION BY st.stop_id ORDER BY st.departure_seconds ASC) AS rn
       FROM stop_times st
       JOIN active a ON a.trip_id = st.trip_id
       JOIN trips t ON t.id = st.trip_id
       JOIN stops s ON s.id = st.stop_id
       WHERE st.stop_id = ANY($1::uuid[])
         AND st.departure_seconds >= $3
         AND st.departure_seconds <= $4
     )
     SELECT r.trip_id, r.route_id, r.stop_id, r.stop_sequence, r.departure_seconds, r.arrival_seconds,
            rt.short_name AS route_short_name, rt.long_name AS route_long_name, rt.mode,
            rt.color AS route_color, rt.text_color AS route_text_color,
            ag.name AS agency_name, ag.timezone AS agency_timezone,
            r.headsign, r.wheelchair_accessible, r.stop_wheelchair_boarding
     FROM ranked r
     JOIN routes rt ON rt.id = r.route_id
     LEFT JOIN agencies ag ON ag.id = rt.agency_id
     WHERE r.rn <= $5
     ORDER BY r.stop_id, r.departure_seconds`,
    [stopIds, serviceDate, minSeconds, maxSeconds, limitPerStop],
  );
  return res.rows;
}

/** Downstream stops for a set of trips (used to extend a ride). */
export async function rideOptions(
  tripIds: string[],
  fromSequences: Array<{ tripId: string; stopSequence: number }>,
): Promise<
  Array<{
    tripId: string;
    stopId: string;
    stopSequence: number;
    arrivalSeconds: number;
    stopName: string;
    lat: number;
    lng: number;
  }>
> {
  if (tripIds.length === 0) return [];
  const res = await query<{
    trip_id: string;
    stop_id: string;
    stop_sequence: number;
    arrival_seconds: number;
    name: string;
    lat: number;
    lng: number;
  }>(
    `WITH board AS (
       SELECT * FROM unnest($1::uuid[], $2::int[]) AS b(trip_id, stop_sequence)
     )
     SELECT st.trip_id, st.stop_id, st.stop_sequence, st.arrival_seconds,
            s.name, ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lng
     FROM stop_times st
     JOIN board b ON b.trip_id = st.trip_id AND st.stop_sequence > b.stop_sequence
     JOIN stops s ON s.id = st.stop_id
     ORDER BY st.trip_id, st.stop_sequence`,
    [tripIds, fromSequences.map((f) => f.stopSequence)],
  );
  return res.rows.map((r) => ({
    tripId: r.trip_id,
    stopId: r.stop_id,
    stopSequence: r.stop_sequence,
    arrivalSeconds: r.arrival_seconds,
    stopName: r.name,
    lat: Number(r.lat),
    lng: Number(r.lng),
  }));
}

export async function stopNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const res = await query<{ id: string; name: string }>(
    'SELECT id, name FROM stops WHERE id = ANY($1::uuid[]) AND is_active',
    [ids],
  );
  return new Map(res.rows.map((r) => [r.id, r.name]));
}

export interface CandidateTrip {
  tripId: string;
  routeId: string;
  routeShortName: string | null;
  routeLongName: string | null;
  mode: string;
  agencyName: string | null;
  agencyTimezone: string;
  headsign: string | null;
  wheelchairAccessible: number;
  stops: Array<{
    stopId: string;
    stopSequence: number;
    arrivalSeconds: number;
    departureSeconds: number;
    name: string;
    lat: number;
    lng: number;
    wheelchairBoarding: number;
  }>;
}

/**
 * Candidate trips: trips that call at any frontier stop within the boarding
 * window. Follow-up query loads each trip's ordered stop list so the planner can
 * scan it (classic round-based RAPTOR). Bounded by `limit` to protect memory.
 */
export async function candidateTrips(
  stopIds: string[],
  serviceDates: string[],
  minSeconds: number,
  maxSeconds: number,
  limit = 250,
): Promise<CandidateTrip[]> {
  if (stopIds.length === 0) return [];
  const tripRes = await query<{ trip_id: string }>(
    `WITH active AS (
       SELECT t.id AS trip_id
       FROM trips t
       JOIN service_calendars c ON c.id = t.calendar_id
       WHERE EXISTS (
           SELECT 1 FROM unnest($2::date[]) d
           WHERE d BETWEEN c.start_date AND c.end_date
             AND (
               (EXTRACT(ISODOW FROM d) = 1 AND c.monday)
            OR (EXTRACT(ISODOW FROM d) = 2 AND c.tuesday)
            OR (EXTRACT(ISODOW FROM d) = 3 AND c.wednesday)
            OR (EXTRACT(ISODOW FROM d) = 4 AND c.thursday)
            OR (EXTRACT(ISODOW FROM d) = 5 AND c.friday)
            OR (EXTRACT(ISODOW FROM d) = 6 AND c.saturday)
            OR (EXTRACT(ISODOW FROM d) = 7 AND c.sunday)
             )
             AND NOT EXISTS (
               SELECT 1 FROM service_exceptions e
               WHERE e.calendar_id = c.id AND e.exception_date = d AND e.exception_type = 2
             )
         )
       UNION
       SELECT t.id FROM trips t
       JOIN service_calendars c ON c.id = t.calendar_id
       JOIN service_exceptions e ON e.calendar_id = c.id
       WHERE e.exception_type = 1 AND e.exception_date = ANY($2::date[])
     )
     SELECT DISTINCT st.trip_id
     FROM stop_times st
     JOIN active a ON a.trip_id = st.trip_id
     WHERE st.stop_id = ANY($1::uuid[])
       AND st.departure_seconds >= $3
       AND st.departure_seconds <= $4
     LIMIT $5`,
    [stopIds, serviceDates, minSeconds, maxSeconds, limit],
  );
  const tripIds = tripRes.rows.map((r) => r.trip_id);
  if (tripIds.length === 0) return [];

  const res = await query<{
    trip_id: string;
    route_id: string;
    route_short_name: string | null;
    route_long_name: string | null;
    mode: string;
    agency_name: string | null;
    agency_timezone: string;
    headsign: string | null;
    wheelchair_accessible: number;
    stop_id: string;
    stop_sequence: number;
    arrival_seconds: number;
    departure_seconds: number;
    name: string;
    lat: number;
    lng: number;
    wheelchair_boarding: number;
  }>(
    `SELECT t.id AS trip_id, rt.id AS route_id, rt.short_name AS route_short_name,
            rt.long_name AS route_long_name, rt.mode,
            ag.name AS agency_name, COALESCE(ag.timezone, 'UTC') AS agency_timezone,
            COALESCE(t.headsign, rt.long_name) AS headsign,
            t.wheelchair_accessible,
            st.stop_id, st.stop_sequence, st.arrival_seconds, st.departure_seconds,
            s.name, ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lng,
            s.wheelchair_boarding
     FROM trips t
     JOIN routes rt ON rt.id = t.route_id
     LEFT JOIN agencies ag ON ag.id = rt.agency_id
     JOIN stop_times st ON st.trip_id = t.id
     JOIN stops s ON s.id = st.stop_id
     WHERE t.id = ANY($1::uuid[])
     ORDER BY t.id, st.stop_sequence`,
    [tripIds],
  );

  const map = new Map<string, CandidateTrip>();
  for (const row of res.rows) {
    let trip = map.get(row.trip_id);
    if (!trip) {
      trip = {
        tripId: row.trip_id,
        routeId: row.route_id,
        routeShortName: row.route_short_name,
        routeLongName: row.route_long_name,
        mode: row.mode,
        agencyName: row.agency_name,
        agencyTimezone: row.agency_timezone,
        headsign: row.headsign,
        wheelchairAccessible: row.wheelchair_accessible,
        stops: [],
      };
      map.set(row.trip_id, trip);
    }
    trip.stops.push({
      stopId: row.stop_id,
      stopSequence: row.stop_sequence,
      arrivalSeconds: row.arrival_seconds,
      departureSeconds: row.departure_seconds,
      name: row.name,
      lat: Number(row.lat),
      lng: Number(row.lng),
      wheelchairBoarding: row.wheelchair_boarding,
    });
  }
  return [...map.values()];
}
