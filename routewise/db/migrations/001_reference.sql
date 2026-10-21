-- RouteWise — reference geography, places and provenance.
-- Requires PostgreSQL 14+ with PostGIS. No country-specific tables: every
-- country, currency and transport network lives in the same global schema.

CREATE EXTENSION IF NOT EXISTS postgis;
-- gen_random_uuid() is built into PostgreSQL 13+, so pgcrypto is not required.

CREATE TABLE IF NOT EXISTS countries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iso2             char(2) NOT NULL UNIQUE CHECK (iso2 ~ '^[A-Z]{2}$'),
  iso3             char(3) UNIQUE CHECK (iso3 ~ '^[A-Z]{3}$'),
  name             text NOT NULL,
  default_currency char(3) CHECK (default_currency ~ '^[A-Z]{3}$'),
  default_locale   text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE countries IS 'ISO 3166 countries. Currency is a default hint, never an assumption.';

CREATE TABLE IF NOT EXISTS regions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  code       text NOT NULL,
  name       text NOT NULL,
  kind       text NOT NULL DEFAULT 'region',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_id, code)
);

CREATE TABLE IF NOT EXISTS cities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id       uuid NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
  region_id        uuid REFERENCES regions(id) ON DELETE SET NULL,
  name             text NOT NULL,
  slug             text NOT NULL UNIQUE,
  timezone         text NOT NULL,
  center           geography(Point, 4326) NOT NULL,
  default_currency char(3) CHECK (default_currency ~ '^[A-Z]{3}$'),
  population       integer CHECK (population IS NULL OR population >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cities_center_gix ON cities USING gist (center);
CREATE INDEX IF NOT EXISTS cities_country_idx ON cities (country_id);

-- Data provenance is a first-class citizen. Every imported network and every
-- provider integration can be traced to a source, licence and freshness value.
CREATE TABLE IF NOT EXISTS data_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('gtfs', 'gtfs_rt', 'api', 'open_dataset', 'community', 'fx', 'geocoding', 'routing')),
  url             text,
  license_name    text,
  license_url     text,
  attribution     text,
  coverage_note   text,
  is_official     boolean NOT NULL DEFAULT false,
  last_imported_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS places (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text,
  external_id  text,
  name         text NOT NULL,
  display_name text NOT NULL,
  kind         text NOT NULL DEFAULT 'other',
  location     geography(Point, 4326) NOT NULL,
  country_id   uuid REFERENCES countries(id) ON DELETE SET NULL,
  city_id      uuid REFERENCES cities(id) ON DELETE SET NULL,
  properties   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS places_location_gix ON places USING gist (location);
CREATE INDEX IF NOT EXISTS places_name_idx ON places (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS places_provider_external_uidx
  ON places (provider, external_id)
  WHERE provider IS NOT NULL AND external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS source_imports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  status         text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  stats          jsonb NOT NULL DEFAULT '{}'::jsonb,
  error          text
);
CREATE INDEX IF NOT EXISTS source_imports_source_idx ON source_imports (data_source_id, started_at DESC);
