import type { UserPreferences } from '@routewise/shared';
import { query } from '../pool.js';

export async function getPreferences(profileHash: string): Promise<UserPreferences | null> {
  const res = await query<{
    preferred_language: string;
    preferred_currency: string | null;
    units: 'metric' | 'imperial';
    timezone: string | null;
    home_city_id: string | null;
    updated_at: Date;
  }>(
    `SELECT preferred_language, preferred_currency, units, timezone, home_city_id, updated_at
     FROM user_preferences WHERE profile_hash = $1`,
    [profileHash],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    preferredLanguage: row.preferred_language,
    preferredCurrency: row.preferred_currency,
    units: row.units,
    timezone: row.timezone,
    homeCityId: row.home_city_id,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function upsertPreferences(
  profileHash: string,
  prefs: Partial<UserPreferences>,
): Promise<UserPreferences> {
  const res = await query<{
    preferred_language: string;
    preferred_currency: string | null;
    units: 'metric' | 'imperial';
    timezone: string | null;
    home_city_id: string | null;
    updated_at: Date;
  }>(
    `INSERT INTO user_preferences
       (profile_hash, preferred_language, preferred_currency, units, timezone, home_city_id)
     VALUES ($1, COALESCE($2, 'en'), $3, COALESCE($4, 'metric'), $5, $6)
     ON CONFLICT (profile_hash) DO UPDATE SET
       preferred_language = COALESCE($2, user_preferences.preferred_language),
       preferred_currency = COALESCE($3, user_preferences.preferred_currency),
       units = COALESCE($4, user_preferences.units),
       timezone = COALESCE($5, user_preferences.timezone),
       home_city_id = COALESCE($6, user_preferences.home_city_id),
       updated_at = now()
     RETURNING preferred_language, preferred_currency, units, timezone, home_city_id, updated_at`,
    [
      profileHash,
      prefs.preferredLanguage ?? null,
      prefs.preferredCurrency ?? null,
      prefs.units ?? null,
      prefs.timezone ?? null,
      prefs.homeCityId ?? null,
    ],
  );
  const row = res.rows[0]!;
  return {
    preferredLanguage: row.preferred_language,
    preferredCurrency: row.preferred_currency,
    units: row.units,
    timezone: row.timezone,
    homeCityId: row.home_city_id,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
