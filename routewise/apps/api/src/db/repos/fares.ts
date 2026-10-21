import { query } from '../pool.js';

export interface FareObservation {
  id: string;
  amount: number;
  currency: string;
  source: string;
  verification: string;
  observedAt: string;
  pricedAs: string;
  note: string | null;
  routeId: string | null;
  mode: string | null;
}

const MAX_OBSERVATION_AGE_DAYS = 400;

/**
 * Retrieve the most recent fare observation for any of the given routes.
 * Fares are ALWAYS returned with their own currency — never converted at rest.
 */
export async function faresForRoutes(routeIds: string[]): Promise<FareObservation[]> {
  if (routeIds.length === 0) return [];
  const res = await query<{
    id: string;
    amount: string;
    currency: string;
    source: string;
    verification: string;
    observed_at: Date;
    priced_as: string;
    note: string | null;
    route_id: string | null;
    mode: string | null;
  }>(
    `SELECT DISTINCT ON (route_id)
            id, amount, currency, source, verification, observed_at, priced_as, note, route_id, mode
     FROM fare_observations
     WHERE route_id = ANY($1::uuid[])
       AND observed_at > now() - ($2 || ' days')::interval
     ORDER BY route_id,
              CASE verification WHEN 'official' THEN 0 WHEN 'moderator_confirmed' THEN 1
                   WHEN 'community_confirmed' THEN 2 ELSE 3 END,
              observed_at DESC`,
    [routeIds, String(MAX_OBSERVATION_AGE_DAYS)],
  );
  return res.rows.map((row) => ({
    id: row.id,
    amount: Number(row.amount),
    currency: row.currency,
    source: row.source,
    verification: row.verification,
    observedAt: new Date(row.observed_at).toISOString(),
    pricedAs: row.priced_as,
    note: row.note,
    routeId: row.route_id,
    mode: row.mode,
  }));
}

/** Mode-level or city-level flat fares when no route-specific fare exists. */
export async function fallbackFare(input: {
  cityId?: string | null;
  countryId?: string | null;
  mode?: string | null;
}): Promise<FareObservation | null> {
  const res = await query<{
    id: string;
    amount: string;
    currency: string;
    source: string;
    verification: string;
    observed_at: Date;
    priced_as: string;
    note: string | null;
    mode: string | null;
  }>(
    `SELECT id, amount, currency, source, verification, observed_at, priced_as, note, mode
     FROM fare_observations
     WHERE route_id IS NULL
       AND ($1::uuid IS NULL OR city_id = $1::uuid)
       AND ($2::uuid IS NULL OR country_id = $2::uuid OR country_id IS NULL)
       AND ($3::text IS NULL OR mode = $3::text OR mode IS NULL)
       AND observed_at > now() - ($4 || ' days')::interval
     ORDER BY
       CASE WHEN route_id IS NOT NULL THEN 0 ELSE 1 END,
       CASE verification WHEN 'official' THEN 0 WHEN 'moderator_confirmed' THEN 1
            WHEN 'community_confirmed' THEN 2 ELSE 3 END,
       observed_at DESC
     LIMIT 1`,
    [input.cityId ?? null, input.countryId ?? null, input.mode ?? null, String(MAX_OBSERVATION_AGE_DAYS)],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    amount: Number(row.amount),
    currency: row.currency,
    source: row.source,
    verification: row.verification,
    observedAt: new Date(row.observed_at).toISOString(),
    pricedAs: row.priced_as,
    note: row.note,
    routeId: null,
    mode: row.mode,
  };
}

export async function insertFare(input: {
  cityId?: string | null;
  countryId?: string | null;
  amount: number;
  currency: string;
  source: string;
  verification: string;
  observedAt: string;
  note?: string | null;
  contributorHash?: string | null;
}): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO fare_observations
       (city_id, country_id, amount, currency, source, verification, observed_at, note, contributor_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      input.cityId ?? null,
      input.countryId ?? null,
      input.amount,
      input.currency.toUpperCase(),
      input.source,
      input.verification,
      input.observedAt,
      input.note ?? null,
      input.contributorHash ?? null,
    ],
  );
  return res.rows[0]!.id;
}
