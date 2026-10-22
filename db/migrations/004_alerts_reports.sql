-- RouteWise — official-style service alerts (feed driven) and community reports
-- (user submitted, explicitly NOT official).

CREATE TABLE IF NOT EXISTS service_alerts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id uuid REFERENCES data_sources(id) ON DELETE CASCADE,
  external_id    text,
  effect         text,
  severity       text,
  header         text NOT NULL,
  description    text,
  url            text,
  starts_at      timestamptz,
  ends_at        timestamptz,
  city_id        uuid REFERENCES cities(id) ON DELETE SET NULL,
  route_id       uuid REFERENCES routes(id) ON DELETE SET NULL,
  stop_id        uuid REFERENCES stops(id) ON DELETE SET NULL,
  is_official    boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (data_source_id, external_id)
);
CREATE INDEX IF NOT EXISTS alerts_city_idx ON service_alerts (city_id, starts_at DESC);

CREATE TABLE IF NOT EXISTS community_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category         text NOT NULL CHECK (category IN ('disruption', 'fare_change', 'route_correction', 'service_availability', 'accessibility', 'safety', 'other')),
  title            text NOT NULL CHECK (char_length(title) BETWEEN 4 AND 160),
  body             text NOT NULL CHECK (char_length(body) BETWEEN 10 AND 4000),
  city_id          uuid REFERENCES cities(id) ON DELETE SET NULL,
  country_id       uuid REFERENCES countries(id) ON DELETE SET NULL,
  route_id         uuid REFERENCES routes(id) ON DELETE SET NULL,
  stop_id          uuid REFERENCES stops(id) ON DELETE SET NULL,
  agency_id        uuid REFERENCES agencies(id) ON DELETE SET NULL,
  location         geography(Point, 4326),
  currency         char(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  observed_at      timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'verified', 'rejected', 'expired')),
  verification     text NOT NULL DEFAULT 'unverified'
                   CHECK (verification IN ('unverified', 'community_confirmed', 'moderator_confirmed')),
  confirm_count    integer NOT NULL DEFAULT 0 CHECK (confirm_count >= 0),
  dispute_count    integer NOT NULL DEFAULT 0 CHECK (dispute_count >= 0),
  contributor_hash text,
  moderation_note  text,
  moderated_at     timestamptz
);
CREATE INDEX IF NOT EXISTS reports_city_idx ON community_reports (city_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_route_idx ON community_reports (route_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_expiry_idx ON community_reports (expires_at);
CREATE INDEX IF NOT EXISTS reports_location_gix ON community_reports USING gist (location);

CREATE TABLE IF NOT EXISTS report_votes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   uuid NOT NULL REFERENCES community_reports(id) ON DELETE CASCADE,
  vote        smallint NOT NULL CHECK (vote IN (-1, 1)),
  voter_hash  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, voter_hash)
);
CREATE INDEX IF NOT EXISTS report_votes_report_idx ON report_votes (report_id);
