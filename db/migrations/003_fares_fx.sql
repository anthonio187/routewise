-- RouteWise — fares are first-class observations with explicit currency.
-- A fare is never stored without an ISO 4217 code, and never converted at rest.

CREATE TABLE IF NOT EXISTS fare_observations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id       uuid REFERENCES countries(id) ON DELETE SET NULL,
  city_id          uuid REFERENCES cities(id) ON DELETE SET NULL,
  agency_id        uuid REFERENCES agencies(id) ON DELETE SET NULL,
  route_id         uuid REFERENCES routes(id) ON DELETE SET NULL,
  data_source_id   uuid REFERENCES data_sources(id) ON DELETE SET NULL,
  mode             text,
  segment_label    text,
  amount           numeric(12, 2) NOT NULL CHECK (amount >= 0),
  currency         char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  priced_as        text NOT NULL DEFAULT 'flat' CHECK (priced_as IN ('flat', 'zone', 'distance', 'day_pass', 'other')),
  source           text NOT NULL CHECK (source IN ('official', 'community', 'estimated')),
  verification     text NOT NULL DEFAULT 'unverified'
                   CHECK (verification IN ('unverified', 'community_confirmed', 'moderator_confirmed', 'official')),
  observed_at      timestamptz NOT NULL,
  expires_at       timestamptz,
  note             text,
  contributor_hash text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fares_route_idx ON fare_observations (route_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS fares_city_idx ON fare_observations (city_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS fares_currency_idx ON fare_observations (currency);

CREATE TABLE IF NOT EXISTS fx_rates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base       char(3) NOT NULL CHECK (base ~ '^[A-Z]{3}$'),
  quote      char(3) NOT NULL CHECK (quote ~ '^[A-Z]{3}$'),
  rate       numeric(18, 8) NOT NULL CHECK (rate > 0),
  as_of      date NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  provider   text NOT NULL,
  UNIQUE (base, quote, as_of)
);
CREATE INDEX IF NOT EXISTS fx_rates_pair_idx ON fx_rates (base, quote, as_of DESC);
