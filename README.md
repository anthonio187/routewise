# RouteWise

**A global, community-powered transport and mobility platform.** Plan multimodal journeys,
compare fares across currencies, navigate transfers, share itineraries and report what you
actually see on the ground — wherever real data exists.

**Live:** <https://routewise-1sml.onrender.com> — one Render web service (Frankfurt) plus Postgres 16
with PostGIS. Free instances sleep after 15 minutes idle, so the first visit can take up to a minute
to wake.

The map has two modes: the drawn OpenStreetMap basemap (with extruded buildings in 3D) and
**Satellite**, real aerial imagery from Esri World Imagery with street labels on top. Place search
is local-first — the 236k-city gazetteer and any ingested stops answer instantly, and results are
ranked by real distance, so searching "market" in Maiduguri finds the city's markets rather than
one on another continent.

> **Real data only.** RouteWise does not invent routes, schedules or fares. When an area has
> no transit coverage it says so, still offers walking/cycling options where possible, and
> lets travellers contribute information. A seeded city is *not* a coverage claim.

---

## Contents

- [What works today](#what-works-today)
- [What this is not](#what-this-is-not)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Quick start](#quick-start)
- [Environment configuration](#environment-configuration)
- [Transit data: global provider + local GTFS](#transit-data-global-provider--local-gtfs)
- [Data coverage and honesty](#data-coverage-and-honesty)
- [Internationalisation, currencies and units](#internationalisation-currencies-and-units)
- [API](#api)
- [Tests](#tests)
- [Deployment](#deployment)
- [Licences and attribution](#licences-and-attribution)
- [Known limitations and roadmap](#known-limitations-and-roadmap)

---

## What works today

| Capability | Status |
|---|---|
| Global place search (addresses, stations, landmarks) | ✅ Nominatim/OSM, replaceable provider interface |
| Real multimodal journey planning | ✅ Transitous (MOTIS) global transit + walking/cycling connections |
| Live vs scheduled vs estimated labelling | ✅ per leg and per journey, including operator cancellations |
| Alternative journeys with duration, transfers, walking, departure/arrival | ✅ |
| Local scheduled transit from authoritative feeds | ✅ GTFS importer + PostGIS-backed RAPTOR-style engine |
| Fare observations with explicit ISO 4217 currency | ✅ schema, API and UI; never converts without a documented rate |
| Preferred display currency | ✅ open.er-api.com rates, cached; degrades to original currency |
| Community reports with moderation, confirmation and expiry | ✅ Postgres-backed, rate-limited, UTC storage |
| Saved journeys and shareable itineraries | ✅ server slugs when a database exists, offline links otherwise |
| MapLibre map with keyless global tiles | ✅ OpenFreeMap `liberty` style: real OSM buildings (3D extrusions), POIs, street/place labels, transit icons |
| Mobile-first responsive UI, four languages, metric/imperial, local time zones | ✅ |
| Accessibility preferences | ✅ ranking + warnings, only where accessibility data exists |
| Offline access to saved journey information | ✅ localStorage snapshots of saved/shared plans |
| Installable app (PWA) | ✅ manifest, icons and a service worker that caches the shell and never caches `/api/` |
| City explorer with real coverage counts | ✅ searchable, pageable list of every seeded city, filter by "has transit data" |
| One design system across every screen | ✅ tokens, light/dark themes, keyboard-navigable, screen-reader labels, loading/empty/error states |
| Departure countdown and recent places | ✅ "departs in N min" updates live; recent searches are one tap away |
| Impact estimate per journey | ✅ CO₂ avoided vs an average petrol car, with the factor stated in the tooltip |
| Keyboard shortcut sheet | ✅ `?` anywhere; command palette on ⌘K / Ctrl-K or `/` |

## Screens

| Route | Purpose |
|---|---|
| `/` | Planner: origin/destination search, now/depart-at/arrive-by, preferences, step-free filter, live results list, map, save and share |
| `/explore` | Every seeded city with stop counts and a "has transit data" filter; one tap to plan from a city |
| `/reports` | Community reports: map + list, category filters, sorting, confirmation/dispute voting, submission form |
| `/saved` | Saved journeys from this device and from the server, with share links and delete |
| `/settings` | Appearance (light/dark/system), language, currency, units, time zone, accessibility, data and privacy, provider status |
| `/share/:slug` and `/share#p=…` | Read-only shared itinerary: works from a server slug or a self-contained link with no backend |

Every screen has explicit loading, empty and error states, works from the keyboard, and is
translated into English, French, Spanish and Portuguese.

## What this is not

- **Not a claim of complete worldwide coverage.** Transit data depends on which operators
  publish open feeds and which regions the transit provider ingests.
- **Not an official operator service.** Community reports are never presented as official
  announcements.
- **Not a fare oracle.** Fares are observations with provenance; totals appear only when
  currencies can be combined legitimately.

## Architecture

```
┌────────────────────────────┐        HTTPS/JSON        ┌─────────────────────────────┐
│ React + TS + Vite +        │  ───────────────────────▶ │ Fastify + TypeScript        │
│ Tailwind + MapLibre        │  ◀─────────────────────── │ (provider-agnostic planner) │
│ (mobile-first, i18n)       │                           └───────────┬─────────────────┘
└────────────────────────────┘                                       │
                                                        ┌────────────┼───────────────┐
                                                        ▼            ▼               ▼
                                              ┌──────────────┐ ┌─────────────┐ ┌──────────────┐
                                              │ PostgreSQL   │ │ Transitous  │ │ Nominatim /  │
                                              │ + PostGIS    │ │ (MOTIS)     │ │ OSRM / FX    │
                                              │ GTFS, fares, │ │ real global │ │ replaceable  │
                                              │ reports, etc.│ │ transit     │ │ providers    │
                                              └──────────────┘ └─────────────┘ └──────────────┘
```

Detailed design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository layout

```
apps/
  api/                 Fastify API, provider layer, planner, GTFS importer
    src/providers/     geocoding • transit • street routing • FX (all modular)
    src/planner/       orchestration, normalization, fares, ranking, local RAPTOR engine
    src/db/            connection pool, migrations runner, repositories
    scripts/           seed + GTFS ingestion
    tests/             unit tests (vitest)
  web/                 React/Vite/Tailwind/MapLibre client
    src/i18n/          English, French, Spanish, Portuguese + additive architecture
packages/shared/       domain contracts shared by API and web
db/migrations/         PostGIS schema (reference, network, fares, reports, prefs)
db/seeds/              all 250 countries + 236k cities (GeoNames, CC BY 4.0); no transit networks
docs/                  architecture, data sources, deployment, API
render.yaml            Render blueprint (API + static site + PostGIS database)
```

## Quick start

Requirements: Node.js 20+, npm 10+, PostgreSQL 14+ with PostGIS (optional for live planning —
the API still plans through external providers without a database, but reports/saved items/
GTFS need it).

```bash
# 1) Install
npm install

# 2) Database (local example)
createdb routewise
psql routewise -c "CREATE EXTENSION IF NOT EXISTS postgis;"
cp .env.example .env            # set DATABASE_URL + a real contact in NOMINATIM_USER_AGENT

# 3) Schema + reference geography
npm run db:migrate
npm run db:seed

# 4) Run API + web together
npm run dev
# API:  http://localhost:8787/readyz
# Web:  http://localhost:5173
```

`npm run db:seed` inserts **every ISO 3166-1 country and territory (250)** plus **236,353
cities** from GeoNames — about 20 seconds on Postgres, a little longer through a socket. It
inserts **zero stops**: a city is a discovery anchor, not a claim of transit coverage. Transit
appears only after you ingest a GTFS feed or when the configured global provider covers that
area.

```bash
npm run db:seed -- --countries-only          # countries only, fast
npm run seed:cities                          # re-import the bundled city set
npm run seed:cities -- --dataset cities1000  # optional: ~150k places, downloaded from GeoNames
npm run seed:cities -- --dataset cities5000  # optional: ~53k places
```

Every city carries a real IANA time zone, population and coordinates, and its country's
default currency is inherited (never assumed). Four territories — Antarctica, Bouvet Island,
Heard/McDonald Islands and the US Minor Outlying Islands — have no civilian city in GeoNames,
so they legitimately have none here.

### Map detail

The web client defaults to OpenFreeMap's `liberty` style, which renders OpenMapTiles vector
data derived from OpenStreetMap: **real building footprints with 3D extrusions and heights**,
shops/POIs, street and place labels, transit station icons, water and land use. Two overlay
toggles let travellers turn 3D buildings or POIs off; clicking a building shows its OSM name
(when present), height and level count. Data-level check on 2026-10-19: a single Berlin
zoom-14 tile contained **195 building footprints, 193 of them with real heights (median 22 m,
max 374 m), 5,678 POIs and 661 street/rail features** — the map is showing the real city, not
a schematic. Set `VITE_MAP_STYLE_URL` to any MapLibre style
(Protomaps, MapTiler, self-hosted) to replace it.

## Environment configuration

Copy [`.env.example`](.env.example) and adjust. Key switches:

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `DATABASE_SSL` | PostgreSQL/PostGIS. Omitting it runs the API in degraded mode |
| `GEOCODING_PROVIDER` | `nominatim` (default) or `disabled` |
| `NOMINATIM_USER_AGENT` | **Required to be identifying** under the OSM usage policy |
| `TRANSIT_PROVIDER` | `transitous` (default), `local_gtfs`, or `disabled` |
| `TRANSITOUS_USER_AGENT` | Must include app name, version and contact |
| `STREET_ROUTING_PROVIDER` | `haversine` (labelled estimate), `osrm`, `disabled` |
| `FX_PROVIDER` | `open_er_api` (default) or `disabled` |
| `REPORT_*`, `MODERATION_TOKEN` | Community-report anti-spam and moderation |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to call the API |

Never commit `.env`; deployment platforms should hold secrets in their environment settings.

## Transit data: global provider + local GTFS

**Global real-time planning (default).** `TRANSIT_PROVIDER=transitous` uses the community-run
MOTIS instance at `api.transitous.org`, which plans over published feeds from many operators
and returns real-time adjustments where available.

Transitous's usage policy (verified October 2026) requires:

- free/open-source or non-profit use (commercial use is not allowed);
- a descriptive `User-Agent` with app name, version and contact;
- caching and avoidance of heavy or repetitive requests;
- visible attribution linking to <https://transitous.org/sources/> and OpenStreetMap.

RouteWise therefore ships a polite client (request timeouts, descriptive UA, UI attribution)
and documents how to swap in your own MOTIS/OpenTripPlanner instance for commercial traffic.
See [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).

**Authoritative local feeds.** Ingest any GTFS zip (your own licence obligations apply):

```bash
npm run ingest:gtfs -- \
  --zip ./feeds/london.zip \
  --code tfl-example \
  --name "Example operator feed" \
  --url https://example.org/feed.zip \
  --license "Open Government Licence v3.0" \
  --attribution "Example Transport Authority" \
  --official \
  --city london
```

This populates agencies, stops, routes, ordered stop sequences, calendars, trips, stop times,
transfers and shapes, all tagged with a `data_sources` row (licence, attribution, freshness).
`--city` accepts a city slug (`london-2643743`), a GeoNames id, or a city name. Stops are
attributed to the nearest seeded city within 35 km from their own coordinates, so a feed that
crosses municipal borders is not stamped with a single city; routes and agencies inherit the
predominant city of the stops they serve.

Ingested feeds are used by the built-in scheduled engine (bounded RAPTOR search over the
timetable graph). With `TRANSIT_PROVIDER=transitous` (the default) the planner queries the
global provider **and** the local engine, then merges and de-duplicates the itineraries, so an
operator feed you import takes effect immediately without disabling global coverage. Set
`TRANSIT_PROVIDER=local_gtfs` to run offline from imported data only.

## Data coverage and honesty

**Reference geography** is complete: 250 ISO 3166-1 countries/territories and 236,353 cities
(GeoNames `cities500`, i.e. every settlement with population ≥ 500 or a capital function).
That is complete *geography*, not complete *transit*: a seeded city has 0 stops until a feed
is ingested.

Transit coverage was **measured, not assumed**, on 2026-10-19 using the production Transitous endpoint:

| Corridor | Result |
|---|---|
| Berlin Alexanderplatz → BER airport | 5 itineraries (walk, metro/S-Bahn, regional rail) |
| London centre → Heathrow | 3 itineraries (subway + bus) |
| Tokyo Station → Roppongi | 11 itineraries (regional rail) |
| Lagos (Ikeja → Marina) | 0 itineraries |
| Abuja (Central Area → Wuse) | 0 itineraries |
| Nairobi (CBD → Westlands, two times) | 0 itineraries |
| Singapore (centre → Marina Bay) | 0 itineraries |

The app responds to gaps the right way: it shows a clearly-labelled notice, still offers
walking/cycling options, and links to the community-report flow so travellers can contribute.
This is a data-availability result at a point in time, not a permanent verdict — ingest a GTFS
feed and the same deployment covers that city.

## Internationalisation, currencies and units

- All UI strings live in `apps/web/src/i18n/index.tsx`; English, French, Spanish and
  Portuguese ship today. Adding a language means adding one dictionary object.
- Money always carries an ISO 4217 code. A fare is stored as `(amount, currency, source,
  verification, observed_at, region/operator)`. Totals are only produced by summing one
  currency, or by converting **every** leg with a documented rate and timestamp.
- Display currency is optional. If no rate is available, the original currency is shown.
- Distances follow a metric/imperial preference; dates and times use `Intl` with the user's
  or chosen IANA time zone. Reports are stored in UTC and rendered locally.
- API notices carry machine codes so the client can localise known cases.

## API

Base path `/api/v1`. Full reference with examples: [docs/API.md](docs/API.md).

```
GET  /healthz                      liveness
GET  /readyz                       readiness (DB + provider status)
GET  /api/v1/meta                  versions, providers, data sources
GET  /api/v1/cities?q=             seeded reference cities
GET  /api/v1/geocode?q=&lang=      global place search (+ local stops)
GET  /api/v1/places/reverse        reverse geocoding
GET  /api/v1/coverage?lat=&lng=    locally ingested coverage near a point
POST /api/v1/plan                  journey planning
GET  /api/v1/reports               community reports (city/route/bbox/category)
POST /api/v1/reports               submit a report (rate-limited, validated)
POST /api/v1/reports/:id/vote      confirm/dispute
POST /api/v1/reports/:id/moderate  staff moderation (X-Moderation-Token)
GET  /api/v1/fx/rates?base=&symbols=
GET/PUT /api/v1/preferences        anonymous, token-scoped
POST/GET/DELETE /api/v1/saved      saved journeys + public share slugs
```

Journeys always carry `dataQuality` (`live` | `scheduled` | `estimated` | `community`),
`warnings`, fare status and ranking explanations.

## Tests

```bash
npm run typecheck      # shared, API and web
npm test               # API unit tests + web render smoke tests
npm run test -w @routewise/web   # only the jsdom UI tests
```

API tests cover polyline decoding against a real captured MOTIS geometry, time-zone
conversion, walking estimates, journey ranking (including "no price ranking without fares"),
fare normalisation and request validation. They never call the network.

Web tests mount the real application in jsdom with the API and map mocked, and assert the
planner hero and quick starts, the explorer, the settings sections, a shared-plan fragment
(`#p=`), the 404 route, and the reports and saved screens. They run in about two seconds and
catch broken imports, missing translation keys and routing regressions.

**Database layer verified against a real PostGIS server** (PostgreSQL with PostGIS 3.6, run
locally through PGlite for this build): all six migrations and the reference seed apply
cleanly with the repo's own scripts, a real GTFS feed can be imported end to end, and the
local routing engine then returns scheduled bus journeys with stop names, times and a stored
fare observation. Community reports (including duplicate-spam rejection and confirmation
votes), preferences and saved-journey share links were exercised against the same database.

Resulting checks on the delivered tree:

```text
npm test                     26 passed (6 files: 20 API + 6 web)
npm run typecheck            shared, API, web — clean
npm run build               API and web production builds succeed
                            web: 1,155 kB JS (323 kB gzip), 112 kB CSS (17.6 kB gzip)
```

## Deployment

**One service, one database, push to deploy.** `render.yaml` describes a single Node service
that serves both the API (`/api/*`) and the built React app, plus a PostgreSQL database. The
service migrates and seeds itself on first boot, so the whole flow is:

1. Push this repository to GitHub.
2. Render → **New → Blueprint** → pick the repo → fill the two `USER_AGENT` prompts → **Apply**.
3. Open the service URL.

No pre-deploy step, no CORS setup, no second static site. Full walkthrough, the two-service
alternative, free-tier caveats and troubleshooting: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Local rehearsal of exactly what Render runs:

```bash
npm ci && npm run build:render
SERVE_WEB=true AUTO_MIGRATE=true AUTO_SETUP=true DATABASE_URL=… npm run start
```

Set at minimum:

```
DATABASE_URL=...                  # Render Postgres connection string
CORS_ORIGINS=https://your-web.onrender.com
NOMINATIM_USER_AGENT=RouteWise/0.1 (you@example.org)
TRANSITOUS_USER_AGENT=RouteWise/0.1 (you@example.org; https://your-app.example)
VITE_API_BASE_URL=https://your-api.onrender.com
DEVICE_HASH_SALT=<random>
MODERATION_TOKEN=<random>
```

## Licences and attribution

- Application code: MIT (see [LICENSE](LICENSE)).
- Map data © OpenStreetMap contributors (ODbL); map tiles via OpenFreeMap.
- Geocoding via Nominatim (OSM data, ODbL) — usage policy applies.
- Transit data via Transitous/MOTIS and individual operators; source list at
  <https://transitous.org/sources/>. Transitous is non-commercial, best-effort.
- Ingested GTFS feeds keep their own licences and attribution, recorded per `data_source`.
- Exchange rates by <https://open.er-api.com> (indicative, display only).

## Known limitations and roadmap

- GTFS-Realtime alerts/vehicle positions are modelled in the schema (`service_alerts`) but only
  the imports required for planning are wired up today.
- The local engine assumes one time zone per search area and approximate DST handling.
- Walking transfers use distance-based estimates unless an OSRM-compatible foot router is
  configured; the public OSRM demo ignores walking profiles, which is why estimates are the
  safe default and are always labelled.
- Taxi/ride-hailing integrations are modelled as modes but no commercial provider is wired in.
- Accounts are deliberately absent: anonymous salted profile tokens scope preferences and
  saved journeys. A hosted identity provider can be added without changing the journey engine.
