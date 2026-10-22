-- Additional cross-cutting indexes and integrity helpers.

-- Route lookup by mode for coverage and filtering.
CREATE INDEX IF NOT EXISTS routes_mode_idx ON routes (mode);

-- Recently observed official fares per route (verified first handled in queries).
CREATE INDEX IF NOT EXISTS fares_verification_idx ON fare_observations (verification, observed_at DESC);

-- Ensure latitude/longitude validity is enforced by PostGIS on insert; explicit
-- checks give a clearer error than a generic geometry failure.
ALTER TABLE stops
  DROP CONSTRAINT IF EXISTS stops_location_srid_check;
ALTER TABLE stops
  ADD CONSTRAINT stops_location_srid_check CHECK (ST_SRID(location::geometry) = 4326);

ALTER TABLE cities
  DROP CONSTRAINT IF EXISTS cities_location_srid_check;
ALTER TABLE cities
  ADD CONSTRAINT cities_location_srid_check CHECK (ST_SRID(center::geometry) = 4326);
