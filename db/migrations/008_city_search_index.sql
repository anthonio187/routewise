-- Fast place search.
--
-- The city table holds every GeoNames place above 500 people (236k rows). The
-- search box queries it on each keystroke with ILIKE '%term%', which cannot use
-- a B-tree index; a trigram GIN index turns that into an index lookup instead
-- of a full scan.
--
-- pg_trgm ships with PostgreSQL and is available on Render Postgres.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS cities_name_trgm_idx
  ON cities USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS cities_ascii_name_trgm_idx
  ON cities USING gin (ascii_name gin_trgm_ops);
