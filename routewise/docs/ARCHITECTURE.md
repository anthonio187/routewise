# Architecture

RouteWise is a two-service monorepo: a React client and a Fastify API sharing typed
contracts. Geography, currency, language and transport systems are all open sets — no
country-specific schemas or business rules exist in the route engine.

```
apps/web (React/Vite/Tailwind/MapLibre)
        │  typed JSON over HTTPS
apps/api (Fastify)
        ├── providers/geocoding   Nominatim (replaceable)
        ├── providers/transit     Transitous/MOTIS (replaceable) + local GTFS engine
        ├── providers/street      OSRM-compatible or distance estimates
        ├── providers/fx          open.er-api.com (replaceable, cached)
        ├── planner/              orchestration, normalisation, fares, ranking
        └── db/                   PostGIS repositories
packages/shared                  domain contracts + helpers (used by both)
db/migrations, db/seeds          schema and reference geography
```

## 1. Provider layer

Every external dependency implements a small interface in `apps/api/src/providers/*/types.ts`:

```ts
interface TransitProvider {
  name: string; configured: boolean; attribution: string; note?: string;
  plan(params: TransitPlanParams): Promise<TransitItinerary[]>;
}
```

Consequences:

- Geocoding can move from public Nominatim to a commercial provider or self-hosted instance
  without touching planning logic.
- Transit can be Transitous, a self-hosted MOTIS/OTP service, a city API, or locally ingested
  GTFS. The planner consumes a normalised `TransitItinerary` shape.
- Street routing can be estimates (always labelled), a foot-profile OSRM, or another engine
  exposing the same API.
- FX can be swapped or disabled; callers receive `null` instead of a guessed rate.
- Status, attribution and policy notes are returned in `GET /api/v1/meta` and every plan
  response so the UI can display them.

Providers are selected by environment variables, never by request input (prevents SSRF and
abuse).

## 2. Planning pipeline

`apps/api/src/planner/index.ts` performs:

1. **Validation** — request schemas enforce coordinate ranges and ISO 4217/8601 formats.
2. **Context** — nearest seeded city (if a DB exists), nearby ingested stops, data sources.
3. **Transit search** — the global provider and the local GTFS engine are queried
   independently and their itineraries merged. Either can fail without taking the other
   down; a failure is reported as a notice, never as "no transit here" (see §3).
4. **Fare lookup** — only stored observations (`fare_observations`), joined per route.
5. **Normalisation** — `planner/normalize.ts` produces public `Journey`/`JourneyLeg` objects:
   instructions, geometry, times, operators, accessibility, per-leg and total fares, warnings.
6. **Fallbacks** — no transit results → labelled walking/cycling journeys (street provider).
7. **Ranking** — `planner/rank.ts` applies the requested preference using only available data:
   `fastest`, `fewest_transfers`, `least_walking`, `accessible`, `cheapest`.
   Cheapest falls back to duration **and says so** when fares are missing.
8. **Notices** — machine-coded messages (`no_transit_itineraries`, `fares_unavailable`,
   `currency_unknown`, `step_free_unverified`, `transit_provider_error`, …) so the client can
   localise them and explain gaps rather than hide them.

Deduplication groups journeys by mode/line/stop signature within a ten-minute window.

## 3. Local GTFS engine (RAPTOR-style)

`planner/localTransit.ts` implements a bounded round-based earliest-arrival search:

- **Access/egress**: stops within `MAX_ACCESS_WALK_METERS`, walking time estimated at 4.8 km/h
  with a 1.3× detour factor (documented and labelled).
- **Rounds**: up to `maxTransfers + 1` (capped at 4). Each round boards candidate trips at
  frontier stops via `candidateTrips()` — a single indexed query over `stop_times`.
- **Trip scanning**: trips are scanned in stop order; boarding requires the label arrival plus a
  transfer penalty; every downstream stop is relaxed when it improves arrival time.
- **Transfers**: `getFootpaths()` adds nearby-stop walking connections (default 500 m) with a
  60-second buffer on top of walking time.
- **Service calendars**: `calendar.txt` + `calendar_dates.txt` exceptions are applied per
  service date; times beyond 24:00 (after-midnight trips) are supported.
- **Reconstruction**: predecessor labels (ride with board/alight indices, or walk) rebuild legs
  with intermediate stops, geometry, platforms where available, and wheelchair metadata.

Documented limits: one time zone per search (the nearest city's), approximately handled DST,
no GTFS-Realtime yet, and bounded trip/stop counts per round. The engine is deliberately not
unbounded because free-tier databases and memory are finite.

## 3a. Web client

`apps/web` is a single-page React application built with Vite:

- **Design system** — Tailwind with CSS-variable tokens (`canvas`, `surface`, `raised`,
  `line`, `ink-*`, `signal-*`). Light and dark themes switch through `data-theme` on
  `<html>`; the choice is stored locally and applied before first paint.
- **State** — no global store. Settings and saved plans live in small subscribable stores
  over `localStorage`; server state is fetched per screen with explicit loading/error/empty
  states. The last plan is cached so a reload does not lose results.
- **Map** — MapLibre GL with the keyless OpenFreeMap `liberty` style. Buildings are extruded
  from real OSM `render_height` data at z14+, with POIs, transit icons and labels. Journey
  geometry and stop markers are drawn from the plan response.
- **Offline and install** — `public/sw.js` caches the app shell and hashed assets
  (network-first for navigations, cache-first for `/assets/`, never for `/api/`). The manifest
  declares standalone display and shortcuts to plan, explore and reports.
- **Accessibility** — landmarks, labelled controls, visible focus rings, `aria-live` for
  async results and toasts, a keyboard command palette (⌘K / Ctrl-K), and a reduced-motion
  aware animation set.
- **Share links** — `/share/:slug` reads a stored snapshot when a database exists;
  `/share#p=…` embeds the plan in the URL fragment so a shared itinerary works with no
  backend at all.

## 4. Data model

| Area | Tables |
|---|---|
| Reference geography | `countries` (250 ISO entries), `regions`, `cities` (geography Point + GiST index; `geoname_id` + `ascii_name` from the GeoNames import) |
| Provenance | `data_sources` (kind, licence, attribution, freshness), `source_imports` |
| Network | `agencies`, `stops`, `routes`, `route_stops`, `transfers`, `service_calendars`, `service_exceptions`, `trips`, `stop_times`, `shape_points` |
| Fares & FX | `fare_observations` (amount + ISO 4217 currency + source + verification + observed_at), `fx_rates` |
| Alerts & community | `service_alerts`, `community_reports`, `report_votes` |
| Users (anonymous) | `user_preferences`, `saved_journeys` |

GTFS external IDs are namespaced per data source (`UNIQUE (data_source_id, external_id)`), so
two agencies can both have a stop called `1`. All locations are WGS84 geography with GiST
indexes. Reports and trips store UTC timestamps; display conversion happens client-side.

## 5. Money rules

A fare row is `(amount, currency, scope, source, verification, observed_at)`. The engine:

- never stores or displays a fare without its currency;
- sums only same-currency legs;
- for mixed currencies, converts **each** leg with a timestamped rate and records the rates in
  the journey note; if any rate is missing the total is `partial` and no number is shown;
- optionally converts to a requested display currency, keeping the original amount visible;
- labels every total as an observation, not an official quote.

## 6. Failure modes

| Failure | Behaviour |
|---|---|
| No database | `/readyz` reports `degraded`; planning still works via providers; reports/saved/fares return clear `503 storage_unavailable` |
| Transit provider down | Warning notice, walking/cycling fallback, HTTP 200 |
| Geocoder down | Empty suggestions with an explicit provider error; manual coordinates still work |
| FX provider down | Recent DB rates used; otherwise original currencies shown, never invented |
| Bad upstream geometry | Straight-line fallback between known endpoints, labelled estimated |
| Rate limits | Fastify rate limit (180/min global, 30/min planning, 10/hour reports) + provider-specific spacing |

## 7. Security and privacy

- No accounts, no raw IP storage, no browser fingerprinting. A random client token is hashed
  with `DEVICE_HASH_SALT` for preferences, saved journeys and report anti-spam.
- CORS is an explicit allow-list; `X-Profile-Token` and `X-Moderation-Token` are the only
  custom headers accepted.
- Moderation endpoints require `MODERATION_TOKEN`; when unset they are disabled.
- Secrets are environment-only; `.env*` files are git-ignored.

## 8. Extending

- **New transit source:** implement `TransitProvider`, return normalised itineraries, register
  it in `providers/transit/index.ts`. No planner changes needed.
- **New geocoder:** implement `GeocodingProvider` and select via `GEOCODING_PROVIDER`.
- **New language:** add one dictionary in `apps/web/src/i18n/index.tsx`. Numbers, dates and
  currency already use `Intl`.
- **New modes:** add to `TransportMode`, map provider-specific strings, and give the mode a
  colour in the UI.
- **Accounts:** put an auth layer in front of `preferences`/`saved` routes; the journey engine
  is unaffected.
