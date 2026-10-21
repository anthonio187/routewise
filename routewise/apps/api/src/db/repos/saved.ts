import type { PlanResponse, SavedJourney } from '@routewise/shared';
import { query } from '../pool.js';
import { randomToken } from '../../utils/hash.js';

export async function saveJourney(input: {
  profileHash: string | null;
  title: string;
  plan: PlanResponse;
  journeyId: string;
}): Promise<SavedJourney> {
  const slug = randomToken(9);
  const res = await query<{ id: string; created_at: Date }>(
    `INSERT INTO saved_journeys (profile_hash, share_slug, title, plan, journey_id)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id, created_at`,
    [input.profileHash, slug, input.title, JSON.stringify(input.plan), input.journeyId],
  );
  const row = res.rows[0]!;
  return {
    id: row.id,
    title: input.title,
    plan: input.plan,
    journeyId: input.journeyId,
    createdAt: new Date(row.created_at).toISOString(),
    shareSlug: slug,
  };
}

export async function getBySlug(slug: string): Promise<SavedJourney | null> {
  const res = await query<{
    id: string;
    title: string;
    plan: PlanResponse;
    journey_id: string;
    created_at: Date;
    share_slug: string;
  }>(
    `SELECT id, title, plan, journey_id, created_at, share_slug FROM saved_journeys WHERE share_slug = $1`,
    [slug],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    plan: row.plan,
    journeyId: row.journey_id,
    createdAt: new Date(row.created_at).toISOString(),
    shareSlug: row.share_slug,
  };
}

export async function listSaved(profileHash: string, limit = 50): Promise<SavedJourney[]> {
  const res = await query<{
    id: string;
    title: string;
    plan: PlanResponse;
    journey_id: string;
    created_at: Date;
    share_slug: string;
  }>(
    `SELECT id, title, plan, journey_id, created_at, share_slug
     FROM saved_journeys WHERE profile_hash = $1
     ORDER BY created_at DESC LIMIT $2`,
    [profileHash, limit],
  );
  return res.rows.map((row) => ({
    id: row.id,
    title: row.title,
    plan: row.plan,
    journeyId: row.journey_id,
    createdAt: new Date(row.created_at).toISOString(),
    shareSlug: row.share_slug,
  }));
}

export async function deleteSaved(id: string, profileHash: string): Promise<boolean> {
  const res = await query(
    'DELETE FROM saved_journeys WHERE id = $1 AND profile_hash = $2',
    [id, profileHash],
  );
  return (res.rowCount ?? 0) > 0;
}
