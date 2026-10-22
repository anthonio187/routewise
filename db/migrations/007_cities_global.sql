-- Global city coverage: stable GeoNames identity + search helpers.
--
-- The reference seed creates every ISO 3166 country. Cities are imported from
-- GeoNames (see db/seeds/README.md) so the same schema serves every country
-- without a per-country table or a curated shortlist.

ALTER TABLE cities ADD COLUMN IF NOT EXISTS geoname_id bigint;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS ascii_name text;

-- One row per GeoNames place. Plain UNIQUE (not partial): PostgreSQL treats
-- NULLs as distinct, so manually created cities without a GeoNames id remain
-- valid, while ON CONFLICT (geoname_id) can use this index directly.
CREATE UNIQUE INDEX IF NOT EXISTS cities_geoname_id_key
  ON cities (geoname_id);

CREATE INDEX IF NOT EXISTS cities_population_idx
  ON cities (population DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS cities_ascii_name_idx
  ON cities (lower(ascii_name));

COMMENT ON COLUMN cities.geoname_id IS
  'GeoNames geonameid when the city came from the GeoNames dump; NULL for operator-created rows.';
COMMENT ON COLUMN cities.ascii_name IS
  'ASCII/transliterated name used for search in Latin script.';
