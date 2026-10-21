import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dbEnabled } from '../db/pool.js';
import { coverageNear } from '../db/repos/stops.js';
import { findNearestCity } from '../db/repos/cities.js';
import { geocodingService } from '../providers/geocoding/index.js';

const SearchQuery = z.object({
  q: z.string().trim().min(2).max(200),
  lang: z.string().max(35).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

export async function geocodeRoutes(app: FastifyInstance) {
  app.get('/api/v1/geocode', async (req, reply) => {
    const parsed = SearchQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'bad_request', details: parsed.error.flatten() });
    }
    const { q, lang, lat, lng, limit } = parsed.data;
    const places = await geocodingService.search(q, {
      language: lang,
      limit,
      near: lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
    });
    return {
      places,
      attribution: geocodingService.attribution,
      provider: geocodingService.name,
    };
  });

  app.get<{ Querystring: { lat?: string; lng?: string; lang?: string } }>(
    '/api/v1/places/reverse',
    async (req, reply) => {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return reply.status(400).send({ error: 'bad_request', message: 'lat and lng are required' });
      }
      const place = await geocodingService.reverse({ lat, lng }, req.query.lang ?? 'en');
      return { place, attribution: geocodingService.attribution };
    },
  );

  app.get<{ Querystring: { lat?: string; lng?: string; radius?: string } }>(
    '/api/v1/coverage',
    async (req, reply) => {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const radius = Math.min(Number(req.query.radius ?? 1000) || 1000, 5000);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return reply.status(400).send({ error: 'bad_request', message: 'lat and lng are required' });
      }
      if (!dbEnabled) {
        return {
          transitDataAvailable: false,
          nearbyStops: 0,
          radiusMeters: radius,
          notice:
            'No database is configured on this deployment, so locally ingested transit coverage cannot be checked. Global planning via the transit provider is still attempted.',
        };
      }
      const [near, city] = await Promise.all([
        coverageNear({ lat, lng }, radius),
        findNearestCity(lat, lng, 80),
      ]);
      return {
        transitDataAvailable: near.stops > 0,
        nearbyStops: near.stops,
        nearbyRoutes: near.routes,
        agencies: near.agencies,
        radiusMeters: radius,
        city,
        notice:
          near.stops === 0
            ? 'No locally ingested transit stops near this point. Global transit planning may still find services where the provider has coverage.'
            : null,
      };
    },
  );
}
