import type { CommunityReport, LatLng, ReportCategory } from '@routewise/shared';
import { query } from '../pool.js';

export const REPORT_DISCLAIMER =
  'Community report — submitted by a RouteWise user. Not an official announcement from any transport operator.';

interface ReportRow {
  id: string;
  category: ReportCategory;
  title: string;
  body: string;
  city_id: string | null;
  city_name: string | null;
  country_code: string | null;
  route_id: string | null;
  route_name: string | null;
  stop_id: string | null;
  stop_name: string | null;
  agency_id: string | null;
  lat: number | null;
  lng: number | null;
  currency: string | null;
  observed_at: Date;
  created_at: Date;
  expires_at: Date | null;
  status: CommunityReport['status'];
  verification: CommunityReport['verification'];
  confirm_count: number;
  dispute_count: number;
}

const SELECT_REPORT = `
  SELECT r.id, r.category, r.title, r.body, r.city_id, c.name AS city_name,
         co.iso2 AS country_code,
         r.route_id, rt.long_name AS route_name,
         r.stop_id, s.name AS stop_name, r.agency_id,
         ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng,
         r.currency, r.observed_at, r.created_at, r.expires_at, r.status, r.verification,
         r.confirm_count, r.dispute_count
  FROM community_reports r
  LEFT JOIN cities c ON c.id = r.city_id
  LEFT JOIN countries co ON co.id = r.country_id
  LEFT JOIN routes rt ON rt.id = r.route_id
  LEFT JOIN stops s ON s.id = r.stop_id
`;

export interface CreateReportInput {
  category: ReportCategory;
  title: string;
  body: string;
  observedAt: string;
  cityId?: string | null;
  routeId?: string | null;
  stopId?: string | null;
  location?: LatLng | null;
  currency?: string | null;
  contributorHash: string | null;
  ttlHours: number;
}

export async function createReport(input: CreateReportInput): Promise<CommunityReport> {
  // Derive city/country from an explicit city, the route/stop context, or the
  // nearest seeded city to the submitted location (80 km radius).
  const res = await query<{ id: string }>(
    `WITH input AS (
       SELECT NULLIF($4, '')::uuid AS city_param,
              NULLIF($5, '')::uuid AS route_param,
              NULLIF($6, '')::uuid AS stop_param,
              $7::float8 AS lat,
              $8::float8 AS lng
     ),
     ctx AS (
       SELECT COALESCE(i.city_param, r.city_id, s.city_id, nearest.id) AS city_id,
              COALESCE(r.agency_id, s.agency_id) AS agency_id
       FROM input i
       LEFT JOIN routes r ON r.id = i.route_param
       LEFT JOIN stops s ON s.id = i.stop_param
       LEFT JOIN LATERAL (
         SELECT c.id
         FROM cities c
         WHERE i.lat IS NOT NULL AND i.lng IS NOT NULL
           AND ST_DWithin(c.center, ST_SetSRID(ST_MakePoint(i.lng, i.lat), 4326)::geography, 80000)
         ORDER BY ST_Distance(c.center, ST_SetSRID(ST_MakePoint(i.lng, i.lat), 4326)::geography)
         LIMIT 1
       ) nearest ON true
     )
     INSERT INTO community_reports
       (category, title, body, city_id, country_id, route_id, stop_id, agency_id,
        location, currency, observed_at, expires_at, contributor_hash)
     SELECT $1, $2, $3,
            ctx.city_id, ctry.id,
            NULLIF($5, '')::uuid, NULLIF($6, '')::uuid, ctx.agency_id,
            CASE WHEN $7::float8 IS NULL OR $8::float8 IS NULL THEN NULL
                 ELSE ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography END,
            $9,
            $10::timestamptz,
            now() + ($11 || ' hours')::interval,
            $12
     FROM ctx
     LEFT JOIN cities c2 ON c2.id = ctx.city_id
     LEFT JOIN countries ctry ON ctry.id = c2.country_id
     RETURNING id`,
    [
      input.category,
      input.title,
      input.body,
      input.cityId ?? '',
      input.routeId ?? '',
      input.stopId ?? '',
      input.location?.lat ?? null,
      input.location?.lng ?? null,
      input.currency?.toUpperCase() ?? null,
      input.observedAt,
      String(input.ttlHours),
      input.contributorHash,
    ],
  );
  const id = res.rows[0]!.id;
  const created = await getReport(id);
  if (!created) throw new Error('Failed to load created report');
  return created;
}

export async function getReport(id: string): Promise<CommunityReport | null> {
  const res = await query<ReportRow>(`${SELECT_REPORT} WHERE r.id = $1`, [id]);
  const row = res.rows[0];
  return row ? mapReport(row) : null;
}

export async function listReports(filters: {
  cityId?: string;
  routeId?: string;
  category?: string;
  status?: string;
  bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  limit?: number;
}): Promise<CommunityReport[]> {
  const res = await query<ReportRow>(
    `${SELECT_REPORT}
     WHERE ($1::uuid IS NULL OR r.city_id = $1::uuid)
       AND ($2::uuid IS NULL OR r.route_id = $2::uuid)
       AND ($3::text IS NULL OR r.category = $3)
       AND ($4::text IS NULL OR r.status = $4)
       AND r.expires_at > now()
       AND ($5::float8 IS NULL OR ST_Intersects(
             r.location::geometry,
             ST_MakeEnvelope($6::float8, $5::float8, $8::float8, $7::float8, 4326)))
     ORDER BY r.created_at DESC
     LIMIT $9`,
    [
      filters.cityId ?? null,
      filters.routeId ?? null,
      filters.category ?? null,
      filters.status ?? null,
      filters.bbox?.minLat ?? null,
      filters.bbox?.minLng ?? null,
      filters.bbox?.maxLat ?? null,
      filters.bbox?.maxLng ?? null,
      Math.min(filters.limit ?? 50, 200),
    ],
  );
  return res.rows.map(mapReport);
}

export async function voteReport(
  reportId: string,
  vote: 'confirm' | 'dispute',
  voterHash: string,
  confirmationsToVerify: number,
): Promise<{ report: CommunityReport; alreadyVoted: boolean }> {
  const value = vote === 'confirm' ? 1 : -1;
  const inserted = await query(
    `INSERT INTO report_votes (report_id, vote, voter_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (report_id, voter_hash) DO NOTHING
     RETURNING id`,
    [reportId, value, voterHash],
  );
  const alreadyVoted = inserted.rowCount === 0;

  if (!alreadyVoted) {
    await query(
      `UPDATE community_reports r
       SET confirm_count = v.confirms,
           dispute_count = v.disputes,
           verification = CASE
             WHEN r.verification = 'moderator_confirmed' THEN 'moderator_confirmed'
             WHEN v.confirms >= $2 AND v.confirms > v.disputes THEN 'community_confirmed'
             ELSE 'unverified' END
       FROM (SELECT
               count(*) FILTER (WHERE vote = 1) AS confirms,
               count(*) FILTER (WHERE vote = -1) AS disputes
             FROM report_votes WHERE report_id = $1) v
       WHERE r.id = $1`,
      [reportId, confirmationsToVerify],
    );
  }

  const report = await getReport(reportId);
  if (!report) throw new Error('Report not found');
  return { report, alreadyVoted };
}

export async function moderateReport(
  id: string,
  status: 'verified' | 'rejected' | 'open',
  note?: string,
): Promise<CommunityReport | null> {
  await query(
    `UPDATE community_reports
       SET status = $2,
           verification = CASE WHEN $2 = 'verified' THEN 'moderator_confirmed'
                               WHEN $2 = 'rejected' THEN 'unverified'
                               ELSE verification END,
           moderation_note = $3,
           moderated_at = now()
     WHERE id = $1`,
    [id, status, note ?? null],
  );
  return getReport(id);
}

/** Expire stale reports. Safe to call frequently; also runs on a schedule. */
export async function expireReports(): Promise<number> {
  const res = await query(
    `UPDATE community_reports SET status = 'expired'
     WHERE status IN ('open', 'verified') AND expires_at IS NOT NULL AND expires_at <= now()`,
  );
  return res.rowCount ?? 0;
}

export async function recentSubmissionCount(contributorHash: string, minutes: number): Promise<number> {
  const res = await query<{ n: string }>(
    `SELECT count(*) AS n FROM community_reports
     WHERE contributor_hash = $1 AND created_at > now() - ($2 || ' minutes')::interval`,
    [contributorHash, String(minutes)],
  );
  return Number(res.rows[0]?.n ?? 0);
}

function mapReport(row: ReportRow): CommunityReport {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    cityId: row.city_id,
    cityName: row.city_name,
    countryCode: row.country_code,
    routeId: row.route_id,
    routeName: row.route_name,
    stopId: row.stop_id,
    stopName: row.stop_name,
    agencyId: row.agency_id,
    location:
      row.lat != null && row.lng != null
        ? { lat: Number(row.lat), lng: Number(row.lng) }
        : null,
    currency: row.currency,
    observedAt: new Date(row.observed_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    status: row.status,
    verification: row.verification,
    confirmCount: row.confirm_count,
    disputeCount: row.dispute_count,
    disclaimer: REPORT_DISCLAIMER,
  };
}
