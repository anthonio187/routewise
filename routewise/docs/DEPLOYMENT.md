# Deployment

RouteWise deploys as **one Render web service plus one Postgres database**. The API serves the
built React app from the same origin, so there is no CORS setup, no second service, and no
build-time API URL to configure.

```
https://routewise-xxxx.onrender.com
├── /                 React app (built static files)
├── /explore, /reports, /share/:slug   client-side routes (SPA fallback)
├── /api/v1/*         Fastify API
├── /healthz          liveness
└── /readyz           readiness (db + providers)
```

## 1. Push and deploy (the short version)

1. Push this repository to GitHub (branch `main`).
2. In Render: **New → Blueprint**, choose the repository. Render reads `render.yaml`.
3. When Render asks for the two prompted values, use a real contact:

   | Prompt | Example |
   |---|---|
   | `NOMINATIM_USER_AGENT` | `RouteWise/0.1 (you@example.org)` |
   | `TRANSITOUS_USER_AGENT` | `RouteWise/0.1 (you@example.org; https://routewise.onrender.com)` |

4. Click **Apply**. On the first boot the service:
   - applies `db/migrations/*.sql` (`AUTO_MIGRATE=true`),
   - seeds 250 countries/territories and 236,353 GeoNames cities when the database is empty
     (`AUTO_SETUP=true`).
5. Open the service URL. `/readyz` should report `"status": "ok"`.

Nothing else needs to be run by hand. A cold first boot takes a couple of minutes (install,
build, then the city import); later deploys skip the seeding because it is idempotent.

> Free web services sleep after 15 minutes without traffic and take ~1 minute to wake.
> Free Postgres instances have a limited lifetime on Render — export or upgrade before you
> depend on the data. See §6.

## 2. What the blueprint sets

| Variable | Value | Why |
|---|---|---|
| `SERVE_WEB` | `true` | Fastify serves `apps/web/dist` and falls back to `index.html` |
| `WEB_DIST_DIR` | `apps/web/dist` | build output location |
| `AUTO_MIGRATE` | `true` | free plans have no pre-deploy command |
| `AUTO_SETUP` | `true` | seeds geography on a brand-new database |
| `DATABASE_SSL` | `true` | Render Postgres requires TLS from a web service |
| `CORS_ORIGINS` | `*` | single origin; no browser CORS needed. Tighten if you split services |
| `NODE_VERSION` | `22` | matches `engines` in `package.json` |

`buildCommand` is `npm ci --include=dev && npm run build:render`, which builds shared → API →
web with an **empty** `VITE_API_BASE_URL` so the browser calls `/api` on its own origin.
`startCommand` is `npm run start`.

## 3. Local production rehearsal

```bash
npm ci
npm run build:render
DATABASE_URL=postgres://… \
DATABASE_SSL=false \
SERVE_WEB=true \
AUTO_MIGRATE=true \
AUTO_SETUP=true \
PORT=8080 npm run start
# open http://localhost:8080
```

`AUTO_SETUP` imports the bundled GeoNames extract, so the first run spends ~20 s seeding and
subsequent runs skip it.

## 4. Using a separate API and static site

The two-service layout still works if you prefer it:

- API service: `npm ci --include=dev && npm run build -w @routewise/api`, start
  `npm run start -w @routewise/api`, health check `/readyz`.
- Static site: `npm ci && VITE_API_BASE_URL=https://<api-host> npm run build -w @routewise/web`,
  publish `apps/web/dist`, SPA rewrite `/* → /index.html`.
- Set `CORS_ORIGINS` on the API to the static site origin.

Either way the application code is unchanged.

## 5. Environment reference

Full list in [`.env.example`](../.env.example). Production minimum for a single service:

```env
NODE_ENV=production
DATABASE_URL=postgres://…
DATABASE_SSL=true
SERVE_WEB=true
WEB_DIST_DIR=apps/web/dist
AUTO_MIGRATE=true
AUTO_SETUP=true
CORS_ORIGINS=*
GEOCODING_PROVIDER=nominatim
NOMINATIM_USER_AGENT=RouteWise/0.1 (you@example.org)
TRANSIT_PROVIDER=transitous
TRANSITOUS_USER_AGENT=RouteWise/0.1 (you@example.org; https://your-app.example)
FX_PROVIDER=open_er_api
DEVICE_HASH_SALT=<generated>
MODERATION_TOKEN=<generated>
```

Optional web build variables:

```env
VITE_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
```

## 6. Free-tier reality check

- **Postgres:** Render free databases are time-limited. Treat the deployment as a demo and
  move to a paid database (or another managed Postgres) before storing community reports you
  care about.
- **Web service:** sleeps after 15 minutes idle; the first request afterwards is slow.
- **Report expiry:** the in-process job pauses while the service sleeps and runs again on wake.
- RouteWise degrades gracefully without a database: planning continues through live providers
  and stored features return an explicit `storage_unavailable` response.

## 7. Health checks and operations

| Endpoint | Purpose |
|---|---|
| `GET /healthz` | process is alive; no dependencies |
| `GET /readyz` | database + provider status; still HTTP 200 when degraded |

`/healthz` is the blueprint health check, so a slow provider never causes a restart loop.

Manual migrations or a full re-seed can still be run from any machine with `DATABASE_URL`:

```bash
npm run db:migrate
npm run db:seed              # countries + bundled cities (idempotent)
npm run ingest:gtfs -- --zip ./feed.zip --code my-city --name "My City GTFS" \
  --license "ODbL" --attribution "Transit authority" --official --city "My City"
```

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Cannot find module @routewise/shared` | The shared package must be built first; use `npm run build:render`, not a bare `tsc` |
| App loads but `/api` calls fail | `SERVE_WEB` off, or the web bundle was built with a stale `VITE_API_BASE_URL` |
| Deep link returns JSON `not_found` | SPA fallback only triggers for `Accept: text/html`; check the request headers |
| `/readyz` reports PostGIS missing | The database user cannot create extensions, or the plan lacks PostGIS |
| Cities list is empty | First boot still seeding, or `AUTO_SETUP` disabled — run `npm run db:seed` |
| Plans return only walking | Transit provider has no coverage there, or `TRANSIT_PROVIDER=disabled`; read the notices |
| Fares show in original currency only | No FX rate for that pair — expected, never guessed |
| Reports return `storage_unavailable` | `DATABASE_URL` unset or the database is suspended |

## 9. Scaling notes

- Planning is stateless; add instances behind a load balancer.
- The rate limit is in-process. For multiple instances, move counters to Redis or the edge.
- GTFS ingestion is the heavy write path — run it as a one-off job, not on the web service.
- Hashed asset URLs are served `immutable`; `index.html`, `sw.js` and the manifest are
  `no-cache`, so a deploy propagates without stale shells.
