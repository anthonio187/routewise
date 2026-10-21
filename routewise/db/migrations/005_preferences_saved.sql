-- RouteWise — anonymous, token-scoped preferences and shareable saved journeys.
-- No personal data is required to use the app; the client holds a random token
-- and only its salted hash is stored.

CREATE TABLE IF NOT EXISTS user_preferences (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_hash       text NOT NULL UNIQUE,
  preferred_language text NOT NULL DEFAULT 'en',
  preferred_currency char(3) CHECK (preferred_currency IS NULL OR preferred_currency ~ '^[A-Z]{3}$'),
  units              text NOT NULL DEFAULT 'metric' CHECK (units IN ('metric', 'imperial')),
  timezone           text,
  home_city_id       uuid REFERENCES cities(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saved_journeys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_hash text,
  share_slug   text NOT NULL UNIQUE,
  title        text NOT NULL,
  plan         jsonb NOT NULL,
  journey_id   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz
);
CREATE INDEX IF NOT EXISTS saved_journeys_profile_idx ON saved_journeys (profile_hash, created_at DESC);
