# Reference geography seed

RouteWise ships **real reference geography only**. There is no demo transit network, no
invented city, and no fabricated fare anywhere in this directory.

## What is in here

| File | Rows | Contents |
|---|---|---|
| `reference.sql` | 250 | Every ISO 3166-1 country and territory: ISO-2/ISO-3 code, English name, default currency, BCP-47 locale hint |
| `cities.csv.gz` | 236,353 | Every GeoNames place with population ≥ 500 or a capital function: GeoNames id, name, ASCII name, country, coordinates, population, IANA time zone |

`npm run db:seed` applies both. `npm run db:seed -- --countries-only` applies only the
countries; `npm run seed:cities` re-imports cities.

## Sources and licences

| Source | Used for | Licence | Attribution |
|---|---|---|---|
| [mledoze/countries](https://github.com/mledoze/countries) | ISO codes, English names | ODbL 1.0 | © mledoze/countries contributors |
| [countries-states-cities-database](https://github.com/dr5hn/countries-states-cities-database) | Default currency, including recent changes (ZWG, XCG) | ODbL 1.0 | © dr5hn and contributors |
| [Unicode CLDR](https://cldr.unicode.org/) `territoryInfo.json` | Default locale hint (most widely used official language) | Unicode License V3 | © Unicode, Inc. |
| [GeoNames](https://www.geonames.org/) `cities500` | Cities, coordinates, population, time zone | CC BY 4.0 | "Contains data from GeoNames.org (CC BY 4.0)" |

Attribution must remain visible wherever the city data is displayed or redistributed. The
repository README, the API `/api/v1/meta` response and this file satisfy that requirement for
the application; if you redistribute the raw files, keep this notice.

GeoNames is a global, community-maintained gazetteer. Population figures are estimates and
time zones are the IANA zone of the place, not of an administrative capital.

## How the files were produced

`reference.sql`:

1. Take `countries.json` from mledoze/countries (250 entries, includes Kosovo and territories).
2. Default currency: `countries-states-cities-database` currency, accepted if it is a
   three-letter code and not the non-ISO "AAD"; otherwise the first mledoze currency.
   Antarctica has no currency and is stored as `NULL`.
3. Default locale: from CLDR `territoryInfo.json`, the official language with the largest
   population share, formatted as `<language>-<ISO2>`. Falls back to mledoze's first language
   when CLDR has no entry. `und` is never stored.

`cities.csv.gz`:

1. Download <https://download.geonames.org/export/dump/cities500.zip>.
2. Keep `geonameid`, `name`, `asciiname`, `country code`, `latitude`, `longitude`,
   `population`, `timezone`; drop rows missing a name, coordinates or time zone.
3. CSV, gzip level 9. The importer adds the slug (`<slugified-name>-<geonameid>`) and joins the
   country for the default currency.

To refresh from GeoNames yourself:

```bash
curl -O https://download.geonames.org/export/dump/cities500.zip
unzip cities500.zip
npm run seed:cities -- --file ./cities500.txt
```

The importer is idempotent: rows are keyed by `geoname_id`, so re-running updates coordinates,
population and time zone instead of duplicating cities.

**Upgrading from the early 20-city seed.** Those rows had no `geoname_id` and used short slugs
(for example `berlin`). They are not touched by the importer, so a database that was seeded by
an older revision may show a duplicate next to the GeoNames row. Either start from a fresh
database or delete the 20 legacy rows (`DELETE FROM cities WHERE geoname_id IS NULL AND slug
IN (...)`); no transit data or saved journey is affected.

## What this deliberately does not contain

- **No transit stops, routes, trips or fares.** Those come from ingested GTFS feeds
  (`npm run ingest:gtfs`) or from the live transit provider.
- **No administrative regions.** GeoNames `admin1` codes are not names; a future region import
  should use an authoritative boundary dataset rather than inventing names.
- **No capital flag.** Capitals are already included in the city set; the schema does not
  claim which city is a capital.
- **No coverage claim.** A city row means "this place exists", not "RouteWise has transit data
  here". The API reports stop counts separately and the UI shows coverage honestly.
