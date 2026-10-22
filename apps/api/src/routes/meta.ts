import type { FastifyInstance } from 'fastify';
import { dbEnabled, query } from '../db/pool.js';
import { searchCities } from '../db/repos/cities.js';
import { searchStops } from '../db/repos/stops.js';
import { listSourcesWithCoverage } from '../db/repos/sources.js';
import { buildMeta } from '../planner/index.js';

interface StatsRow {
  countries: string;
  cities: string;
  stops: string;
  routes: string;
  cities_with_transit: string;
}

async function loadStats(meta: ReturnType<typeof buildMeta>) {
  try {
    const res = await query<StatsRow>(
      `SELECT (SELECT count(*) FROM countries) AS countries,
              (SELECT count(*) FROM cities) AS cities,
              (SELECT count(*) FROM stops WHERE is_active) AS stops,
              (SELECT count(*) FROM routes) AS routes,
              (SELECT count(DISTINCT city_id) FROM stops WHERE is_active AND city_id IS NOT NULL) AS cities_with_transit`,
    );
    const row = res.rows[0];
    if (row) {
      meta.stats = {
        countries: Number(row.countries),
        cities: Number(row.cities),
        stops: Number(row.stops),
        routes: Number(row.routes),
        citiesWithTransit: Number(row.cities_with_transit),
      };
    }
  } catch {
    meta.stats = null;
  }
}

export async function metaRoutes(app: FastifyInstance) {
  app.get('/api/v1/meta', async () => {
    const meta = buildMeta();
    if (dbEnabled) {
      await loadStats(meta);
      try {
        const sources = await listSourcesWithCoverage();
        meta.dataSources = sources
          .filter((source) => source.stopCount > 0)
          .map(({ stopCount: _stopCount, ...summary }) => summary);
      } catch {
        meta.notices.push({
          code: 'data_sources_unavailable',
          severity: 'info',
          message: 'Data source metadata could not be loaded from the database.',
        });
      }
    }
    return meta;
  });

  app.get<{
    Querystring: { q?: string; country?: string; hasTransit?: string; limit?: string; offset?: string };
  }>('/api/v1/cities', async (req) => {
    if (!dbEnabled) return { cities: [], total: 0, notice: 'DATABASE_URL is not configured.' };
    const limit = Math.min(Number(req.query.limit ?? 60) || 60, 200);
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);

    // Always paginate: the caller shows `total` next to the results, so it has
    // to be the size of the whole (filtered) city set, not the page size.
    const result = await searchCities({
      q: req.query.q,
      country: req.query.country,
      hasTransit: req.query.hasTransit === '1' || req.query.hasTransit === 'true',
      limit,
      offset,
    });
    return { cities: result.cities, total: result.total };
  });

  /**
   * Stop-level search. Only returns stops from feeds this deployment actually
   * ingested — a stop row is real transit data, never a placeholder.
   */
  app.get<{ Querystring: { q?: string; limit?: string } }>('/api/v1/stops', async (req) => {
    if (!dbEnabled) return { stops: [], notice: 'DATABASE_URL is not configured.' };
    const q = req.query.q?.trim() ?? '';
    if (q.length < 2) return { stops: [] };
    const limit = Math.min(Number(req.query.limit ?? 15) || 15, 50);
    const stops = await searchStops(q, limit);
    return { stops };
  });
}
