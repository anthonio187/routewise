# Data sources, licences and coverage

RouteWise only displays what a real source provides. This document records what is used, what
it costs, what the rules are, and what was actually verified.

## Providers in use

| Layer | Default | Alternative(s) | Terms / attribution |
|---|---|---|---|
| Map tiles | OpenFreeMap (`tiles.openfreemap.org`) | MapTiler Cloud, Protomaps, self-hosted | Free public service, no key. Attribution: OpenMapTiles + OpenStreetMap |
| Geocoding | Nominatim (`nominatim.openstreetmap.org`) | MapTiler, self-hosted Nominatim | OSM data © contributors (ODbL). Usage policy: max ~1 req/s, identifying User-Agent, no bulk use |
| Transit | Transitous (`api.transitous.org`, MOTIS 2) | local GTFS engine, self-hosted MOTIS/OTP | FOSS/non-profit, best-effort. Descriptive UA with contact; cache; visible link to <https://transitous.org/sources/> |
| Street routing | Distance estimate (`haversine`) | OSRM-compatible foot router | Estimates are labelled; OSRM uses OSM data |
| Exchange rates | open.er-api.com | none bundled | Keyless indicative rates for display only |

## Reference geography (seeded, not live)

| Dataset | Rows | Licence | Used for |
|---|---|---|---|
| mledoze/countries | 250 | ODbL 1.0 | ISO 3166-1 codes and English names |
| countries-states-cities-database | 250 | ODbL 1.0 | Default currency (includes ZWG, XCG) |
| Unicode CLDR `territoryInfo` | 250 | Unicode License V3 | Default BCP-47 locale hint |
| GeoNames `cities500` | 236,353 | CC BY 4.0 | City name, coordinates, population, IANA time zone |

The seed is applied by `npm run db:seed` (countries + cities) or
`npm run db:seed -- --countries-only`. Details, regeneration steps and the exact filtering
rules are in [`db/seeds/README.md`](../db/seeds/README.md).

**Attribution requirements.** GeoNames data is CC BY 4.0: any deployment that shows the city
dataset must credit "GeoNames.org (CC BY 4.0)". The README, this document and the map
attribution line do that. ODbL datasets require attribution and share-alike for derived
databases; keep the notices if you redistribute.

**Completeness versus coverage.** All 250 ISO territories are present; 246 have at least one
GeoNames city. Antarctica, Bouvet Island, Heard/McDonald Islands and the US Minor Outlying
Islands have no civilian settlement in the dataset, so they have none in the database. Cities
are discovery anchors — the API reports `stopCount` separately and never implies transit
coverage from a city row.

### Transitous policy (verified 2026-10)

From <https://transitous.org/api/>:

- The service is run by volunteers for free/open-source applications and non-profit activities,
  on a best-effort basis, and may be withdrawn from any consumer at any time.
- **Commercial use is not allowed** because of data-source licences and resource prioritisation.
- Publish your source code under an open licence; contact the maintainers before heavy use.
- Every request needs a `User-Agent` containing application name, version and contact.
- Cache responses and avoid expensive/repetitive requests.
- Attribution to Transitous sources and OpenStreetMap must remain visible.

RouteWise therefore:

- sends `TRANSITOUS_USER_AGENT` (configure it with your contact details);
- uses a short request timeout and per-plan caching at the client;
- shows provider attribution in the results panel and settings page;
- documents self-hosting MOTIS/OTP for commercial deployments;
- never calls staging or internal MOTIS endpoints.

**If you deploy commercially, switch off Transitous** (`TRANSIT_PROVIDER=local_gtfs` or point
`TRANSITOUS_BASE_URL` at your own MOTIS instance). Do not ship a commercial product on the
public instance.

## Measured coverage (2026-10-19)

Probed against the production endpoint with a descriptive User-Agent:

| Corridor | Itineraries | Notes |
|---|---|---|
| Berlin Alexanderplatz → BER | 5 | walk + S-Bahn/metro + regional rail; `realTime` observed |
| London centre → Heathrow | 3 | subway + bus |
| Tokyo Station → Roppongi | 11 | regional rail |
| Lagos Ikeja → Marina | 0 | no transit data returned |
| Abuja Central → Wuse | 0 | no transit data returned |
| Nairobi CBD → Westlands (morning/afternoon) | 0 | no transit data returned |
| Singapore centre → Marina Bay | 0 | no transit data returned |

These are point-in-time facts, not permanent claims. Coverage changes as operators publish
feeds and as the provider ingests them. The UI always states which case applies instead of
implying global completeness.

## Ingesting your own GTFS

```bash
npm run ingest:gtfs -- \
  --zip ./feeds/feed.zip \
  --code operator-slug \
  --name "Operator (city)" \
  --url https://operator.example/gtfs.zip \
  --license "Licence name" \
  --license-url https://operator.example/licence \
  --attribution "Operator name" \
  --official \
  --city lagos
```

Then set `TRANSIT_PROVIDER=local_gtfs` (or run a second deployment) to plan from that data.

Checklist before ingesting:

1. Confirm the licence permits database storage, derivative works and public display.
2. Record licence name/URL and attribution in the import flags — they surface in the UI.
3. Check the feed's freshness and time zone. Re-run the importer on the operator's schedule.
4. Keep the zip out of git (`feeds/` and `*.gtfs.zip` are ignored).

`--append` preserves existing rows; the default replaces that data source's network atomically
in one transaction. `--dry-run` reports statistics and rolls back.

## Freshness and provenance

- Every stop/route/trip links to a `data_sources` row with licence, attribution, kind and
  `last_imported_at`. The meta endpoint marks sources `fresh` (≤45 days) or `stale`.
- The UI shows this alongside results; stale data is not silently presented as current.
- Community reports expire (`REPORT_TTL_HOURS`, default 72) and are never labelled official.

## Adding a provider

```ts
// apps/api/src/providers/transit/my-operator.ts
export class MyOperatorProvider implements TransitProvider {
  readonly name = 'my-operator';
  readonly configured = true;
  readonly attribution = 'Data © My Operator, used under <licence>';
  async plan(params: TransitPlanParams): Promise<TransitItinerary[]> {
    // Call the operator API, map to transit legs with ISO timestamps,
    // LngLat geometry and dataQuality: 'live' | 'scheduled'.
  }
}
```

Register it in `providers/transit/index.ts` and add the enum value in `config.ts`. The planner,
fares, ranking and UI need no changes.

## Community contributions

- Reports are user submissions with category, location, route/stop context, UTC observation
  time, and a 72-hour default expiry.
- Confirmation/dispute voting (one vote per hashed device) promotes a report to
  `community_confirmed` at the configured threshold (`REPORT_CONFIRMATIONS_TO_VERIFY`).
- Staff can verify or reject with `X-Moderation-Token`. Verified community reports still show
  a "community" badge — they are never relabelled as operator announcements.
- Machine-level anti-spam: per-device minimum interval, per-IP hourly cap, length validation,
  future/old timestamp rejection.
