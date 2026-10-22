-- RouteWise — multi-network transit model (GTFS-shaped, provider agnostic).
-- External IDs are scoped per data source so two agencies can both use "1".

CREATE TABLE IF NOT EXISTS agencies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id uuid REFERENCES data_sources(id) ON DELETE CASCADE,
  external_id    text,
  name           text NOT NULL,
  url            text,
  timezone       text NOT NULL,
  language       text,
  phone          text,
  country_id     uuid REFERENCES countries(id) ON DELETE SET NULL,
  city_id        uuid REFERENCES cities(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (data_source_id, external_id)
);
CREATE INDEX IF NOT EXISTS agencies_city_idx ON agencies (city_id);

CREATE TABLE IF NOT EXISTS stops (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id           uuid REFERENCES agencies(id) ON DELETE SET NULL,
  city_id             uuid REFERENCES cities(id) ON DELETE SET NULL,
  data_source_id      uuid REFERENCES data_sources(id) ON DELETE CASCADE,
  external_id         text,
  name                text NOT NULL,
  code                text,
  description         text,
  location            geography(Point, 4326) NOT NULL,
  parent_stop_id      uuid REFERENCES stops(id) ON DELETE SET NULL,
  wheelchair_boarding smallint NOT NULL DEFAULT 0 CHECK (wheelchair_boarding IN (0, 1, 2)),
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (data_source_id, external_id)
);
CREATE INDEX IF NOT EXISTS stops_location_gix ON stops USING gist (location);
CREATE INDEX IF NOT EXISTS stops_city_idx ON stops (city_id);
CREATE INDEX IF NOT EXISTS stops_name_idx ON stops (lower(name));

CREATE TABLE IF NOT EXISTS routes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id              uuid REFERENCES agencies(id) ON DELETE CASCADE,
  city_id                uuid REFERENCES cities(id) ON DELETE SET NULL,
  data_source_id         uuid REFERENCES data_sources(id) ON DELETE CASCADE,
  external_id            text,
  short_name             text,
  long_name              text,
  description            text,
  mode                   text NOT NULL DEFAULT 'bus',
  route_type             smallint,
  color                  text CHECK (color IS NULL OR color ~ '^[0-9A-Fa-f]{6}$'),
  text_color             text CHECK (text_color IS NULL OR text_color ~ '^[0-9A-Fa-f]{6}$'),
  wheelchair_accessible  smallint NOT NULL DEFAULT 0 CHECK (wheelchair_accessible IN (0, 1, 2)),
  sort_order             integer,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (data_source_id, external_id)
);
CREATE INDEX IF NOT EXISTS routes_city_idx ON routes (city_id);
CREATE INDEX IF NOT EXISTS routes_agency_idx ON routes (agency_id);

CREATE TABLE IF NOT EXISTS route_stops (
  route_id                uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  direction_id            smallint NOT NULL CHECK (direction_id IN (0, 1)),
  stop_sequence           integer NOT NULL CHECK (stop_sequence >= 0),
  stop_id                 uuid NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
  headsign                text,
  shape_distance_traveled numeric(12, 2),
  PRIMARY KEY (route_id, direction_id, stop_sequence)
);
CREATE INDEX IF NOT EXISTS route_stops_stop_idx ON route_stops (stop_id);

CREATE TABLE IF NOT EXISTS transfers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id      uuid REFERENCES data_sources(id) ON DELETE CASCADE,
  from_stop_id        uuid NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
  to_stop_id          uuid NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
  transfer_type       smallint,
  min_transfer_seconds integer CHECK (min_transfer_seconds IS NULL OR min_transfer_seconds >= 0),
  walk_seconds        integer CHECK (walk_seconds IS NULL OR walk_seconds >= 0),
  distance_meters     numeric(10, 1),
  is_timed            boolean NOT NULL DEFAULT false,
  UNIQUE (data_source_id, from_stop_id, to_stop_id)
);
CREATE INDEX IF NOT EXISTS transfers_from_idx ON transfers (from_stop_id);

CREATE TABLE IF NOT EXISTS service_calendars (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id uuid REFERENCES data_sources(id) ON DELETE CASCADE,
  external_id    text NOT NULL,
  name           text,
  monday         boolean NOT NULL DEFAULT false,
  tuesday        boolean NOT NULL DEFAULT false,
  wednesday      boolean NOT NULL DEFAULT false,
  thursday       boolean NOT NULL DEFAULT false,
  friday         boolean NOT NULL DEFAULT false,
  saturday       boolean NOT NULL DEFAULT false,
  sunday         boolean NOT NULL DEFAULT false,
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  UNIQUE (data_source_id, external_id)
);
CREATE INDEX IF NOT EXISTS service_calendars_dates_idx ON service_calendars (start_date, end_date);

CREATE TABLE IF NOT EXISTS service_exceptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id    uuid NOT NULL REFERENCES service_calendars(id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  exception_type smallint NOT NULL CHECK (exception_type IN (1, 2)),
  UNIQUE (calendar_id, exception_date)
);

CREATE TABLE IF NOT EXISTS trips (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id              uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  calendar_id           uuid REFERENCES service_calendars(id) ON DELETE CASCADE,
  data_source_id        uuid REFERENCES data_sources(id) ON DELETE CASCADE,
  external_id           text,
  direction_id          smallint NOT NULL DEFAULT 0 CHECK (direction_id IN (0, 1)),
  headsign              text,
  short_name            text,
  wheelchair_accessible smallint NOT NULL DEFAULT 0 CHECK (wheelchair_accessible IN (0, 1, 2)),
  bikes_allowed         smallint NOT NULL DEFAULT 0 CHECK (bikes_allowed IN (0, 1, 2)),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (data_source_id, external_id)
);
CREATE INDEX IF NOT EXISTS trips_route_idx ON trips (route_id, direction_id);
CREATE INDEX IF NOT EXISTS trips_calendar_idx ON trips (calendar_id);

CREATE TABLE IF NOT EXISTS stop_times (
  trip_id          uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  stop_sequence    integer NOT NULL CHECK (stop_sequence >= 0),
  stop_id          uuid NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
  arrival_seconds  integer NOT NULL CHECK (arrival_seconds >= 0),
  departure_seconds integer NOT NULL CHECK (departure_seconds >= 0),
  stop_headsign    text,
  pickup_type      smallint NOT NULL DEFAULT 0,
  drop_off_type    smallint NOT NULL DEFAULT 0,
  timepoint        boolean NOT NULL DEFAULT true,
  PRIMARY KEY (trip_id, stop_sequence)
);
-- Boarding queries filter by stop and departure window.
CREATE INDEX IF NOT EXISTS stop_times_stop_departure_idx ON stop_times (stop_id, departure_seconds);

-- Optional GTFS shapes, stored as ordered points for map display.
CREATE TABLE IF NOT EXISTS shape_points (
  data_source_id uuid REFERENCES data_sources(id) ON DELETE CASCADE,
  shape_id       text NOT NULL,
  seq            integer NOT NULL,
  location       geography(Point, 4326) NOT NULL,
  PRIMARY KEY (data_source_id, shape_id, seq)
);

-- Convenience: which stops are near a point (used by coverage statistics only;
-- journey planning queries stop_times through these same indexes).
CREATE OR REPLACE VIEW city_coverage AS
SELECT
  c.id   AS city_id,
  c.name AS city_name,
  c.country_id,
  (SELECT count(*) FROM stops s WHERE s.city_id = c.id AND s.is_active) AS stop_count,
  (SELECT count(*) FROM routes r WHERE r.city_id = c.id)              AS route_count,
  (SELECT count(*) FROM agencies a WHERE a.city_id = c.id)            AS agency_count
FROM cities c;
