# API reference

Base URL: `http://localhost:8787` in development. All endpoints are under `/api/v1` except the
health checks. JSON only. Requests from browsers must pass the `CORS_ORIGINS` allow-list.

Optional header: `X-Profile-Token` — a stable random token (≥16 chars) that scopes preferences
and saved journeys. Only its salted hash is stored.

## Health

```http
GET /healthz
GET /readyz
```

```json
{
  "status": "degraded",
  "uptimeSeconds": 42,
  "checks": {
    "database": { "ok": true, "detail": "PostGIS available" },
    "transit": { "ok": true, "detail": "transitous" },
    "geocoding": { "ok": true, "detail": "nominatim" },
    "fx": { "ok": true, "detail": "open_er_api" }
  }
}
```

## Metadata

```http
GET /api/v1/meta
GET /api/v1/cities?q=lagos&country=NG&hasTransit=1&limit=24&offset=0
GET /api/v1/stops?q=alexanderplatz&limit=10
```

`meta` lists versions, supported preferences/modes, provider status + attribution, ingested
data sources and reference counters (`stats.countries`, `stats.cities`, `stats.stops`,
`stats.routes`, `stats.citiesWithTransit`). `cities` searches the seeded reference cities
(name or ASCII name, optional ISO 3166-1 country, optional `hasTransit` filter) and returns
`{ cities, total }`; each city carries `stopCount`, `routeCount` and `hasTransitData`. `stops`
searches ingested stops by name and returns `{ stops }`.

## Places

```http
GET /api/v1/geocode?q=Alexanderplatz%20Berlin&lang=de&lat=52.52&lng=13.4&limit=6
GET /api/v1/places/reverse?lat=52.5219&lng=13.4132&lang=en
GET /api/v1/coverage?lat=6.5244&lng=3.3792&radius=1000
```

```json
{
  "places": [
    {
      "id": "osm:node:123456",
      "name": "Berlin Alexanderplatz",
      "displayName": "Berlin Alexanderplatz, Mitte, Berlin, Deutschland",
      "location": { "lat": 52.5219, "lng": 13.4132 },
      "kind": "station",
      "provider": "nominatim",
      "countryCode": "DE"
    }
  ],
  "attribution": "Geocoding © OpenStreetMap contributors (ODbL), via Nominatim",
  "provider": "nominatim"
}
```

## Journey planning

```http
POST /api/v1/plan
Content-Type: application/json
```

```json
{
  "origin": { "name": "Alexanderplatz", "location": { "lat": 52.5219, "lng": 13.4132 } },
  "destination": { "name": "BER Airport", "location": { "lat": 52.3667, "lng": 13.5033 } },
  "departureTime": "2026-10-19T07:30:00Z",
  "preference": "fastest",
  "currency": "EUR",
  "maxTransfers": 3,
  "requireStepFree": false,
  "locale": "en"
}
```

Optional fields: `arriveBy`, `departureTime` (defaults to now), `currency` (ISO 4217),
`maxTransfers` (0–6), `preference` (see below), `requireStepFree`.

Preferences: `fastest`, `cheapest`, `fewest_transfers`, `least_walking`, `accessible`.

Response (abridged):

```json
{
  "requestId": "…",
  "origin": { "name": "Alexanderplatz", "location": { "lat": 52.5219, "lng": 13.4132 } },
  "destination": { "name": "BER Airport", "location": { "lat": 52.3667, "lng": 13.5033 } },
  "departureTime": "2026-10-19T07:30:00.000Z",
  "currency": "EUR",
  "journeys": [
    {
      "id": "…",
      "durationSeconds": 2820,
      "transfers": 1,
      "walkingMeters": 1204,
      "departureTime": "2026-10-19T07:31:00.000Z",
      "arrivalTime": "2026-10-19T08:18:00.000Z",
      "dataQuality": "live",
      "warnings": ["Some departures use real-time data; arrival times can still change."],
      "fare": {
        "status": "unknown",
        "note": "No fare data is available for this journey. RouteWise does not estimate prices."
      },
      "legs": [
        {
          "mode": "metro",
          "instruction": "Take metro S7 towards … from S+U Alexanderplatz Bhf to S Ostkreuz Bhf (2 stops, 8 min)",
          "startTime": "2026-10-19T07:35:00.000Z",
          "endTime": "2026-10-19T07:43:00.000Z",
          "geometry": [[13.413, 52.521], [13.467, 52.503]],
          "route": { "shortName": "S7", "mode": "metro", "agencyName": "S-Bahn Berlin GmbH" },
          "dataQuality": "live",
          "accessibility": { "wheelchairAccessible": "yes" }
        }
      ]
    }
  ],
  "coverage": {
    "transitDataAvailable": false,
    "nearbyStops": 0,
    "cityName": "Berlin",
    "countryCode": "DE",
    "dataSources": []
  },
  "providers": { "transit": { "provider": "transitous", "attribution": "…" } },
  "notices": [
    { "code": "paths_only_transit_source", "severity": "info", "message": "…" }
  ],
  "generatedAt": "2026-10-19T07:00:00.000Z"
}
```

### Data-quality semantics

| Value | Meaning |
|---|---|
| `live` | operator real-time feed affected this leg |
| `scheduled` | published timetable only |
| `estimated` | derived (walking estimates, unverified geometry); never imply real-time |
| `community` | contributed by users, not official |
| `unknown` | source provided nothing usable |

Notices carry stable `code` values so clients can localise them; unknown codes should fall back
to `message`.

## Community reports

```http
GET  /api/v1/reports?cityId=<uuid>&category=disruption&limit=20
GET  /api/v1/reports?bbox=minLng,minLat,maxLng,maxLat
POST /api/v1/reports
POST /api/v1/reports/:id/vote        { "vote": "confirm" | "dispute" }
POST /api/v1/reports/:id/moderate    { "status": "verified" | "rejected" | "open", "note": "…" }
```

```bash
curl -X POST http://localhost:8787/api/v1/reports \
  -H 'Content-Type: application/json' -H 'X-Profile-Token: 0123456789abcdef0123456789abcdef' \
  -d '{
    "category": "disruption",
    "title": "Signal failure near Central",
    "body": "Trains are being held outside the city centre since 07:40.",
    "observedAt": "2026-10-19T07:40:00Z",
    "cityId": "<uuid>",
    "location": { "lat": 52.52, "lng": 13.405 }
  }'
```

Rules enforced server-side:

- `observedAt` must be ISO-8601 with offset, not more than 10 minutes in the future and not
  older than 30 days;
- one report per device every `REPORT_MIN_INTERVAL_SECONDS` (default 120 s), plus an hourly cap;
- reports expire after `REPORT_TTL_HOURS` (default 72) and stop accepting votes;
- one vote per hashed device per report; confirmation threshold configurable;
- moderation requires `X-Moderation-Token` matching `MODERATION_TOKEN`, otherwise `403`;
- every report includes a `disclaimer` stating it is not an official announcement.

Missing database → `503 { "error": "storage_unavailable" }` with an explanation. Nothing is
silently discarded.

## Currency

```http
GET /api/v1/fx/rates?base=EUR&symbols=NGN,GBP,JPY
```

```json
{
  "base": "EUR",
  "provider": "open_er_api",
  "rates": { "NGN": { "rate": 1496.56, "asOf": "2026-10-19T00:02:32.000Z" } },
  "notice": "Indicative mid-market rates for display only. They are not fare quotes…"
}
```

A `null` rate means no conversion is available; clients must show the original currency.

## Preferences and saved journeys

```http
GET /api/v1/preferences                       (X-Profile-Token)
PUT /api/v1/preferences                       { preferredLanguage, preferredCurrency, units, timezone, homeCityId }
POST /api/v1/saved                            { title, journeyId, plan }
GET /api/v1/saved
GET /api/v1/saved/:slug                       public share link, no auth
DELETE /api/v1/saved/:id
```

A saved journey stores the complete plan snapshot, so shared links keep working offline and do
not re-query providers.

## Errors

```json
{ "error": "bad_request", "message": "Invalid journey request", "details": { … } }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `bad_request` | validation failed (coordinates, currency, dates, body) |
| 401 | `profile_token_required` | missing `X-Profile-Token` on a personal endpoint |
| 403 | `moderation_disabled` | moderation attempted without `MODERATION_TOKEN` configured |
| 404 | `not_found` | unknown report/journey/share slug |
| 409 | `closed` | voting on an expired/rejected report |
| 429 | `rate_limited` | too many requests or reports too frequently |
| 503 | `storage_unavailable` | database required but not configured/reachable |

## Rate limits

Global 180 requests/minute per IP; `POST /plan` 30/minute; report creation 10/hour; votes
30/hour. Tune in `apps/api/src/routes/*.ts` and the provider notes in `.env.example`.
