import type { FastifyInstance } from 'fastify';
import { checkDatabase } from '../db/pool.js';
import { buildProviderStatuses } from '../planner/index.js';
import { config } from '../config.js';

const startedAt = Date.now();

export async function healthRoutes(app: FastifyInstance) {
  app.get('/healthz', async () => ({
    status: 'ok',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    version: '0.1.0',
  }));

  app.get('/readyz', async (_req, reply) => {
    const db = await checkDatabase();
    const providers = buildProviderStatuses();
    const degraded = !db.configured || !db.reachable;
    const checks = {
      database: {
        ok: db.reachable,
        detail: db.configured
          ? db.reachable
            ? `PostGIS ${db.postgis ? 'available' : 'missing'}`
            : db.error ?? 'unreachable'
          : 'DATABASE_URL not set (degraded mode)',
      },
      transit: {
        ok: providers.transit?.configured ?? false,
        detail: providers.transit?.provider ?? 'none',
      },
      geocoding: {
        ok: providers.geocoding?.configured ?? false,
        detail: providers.geocoding?.provider ?? 'none',
      },
      fx: { ok: providers.fx?.configured ?? false, detail: providers.fx?.provider ?? 'none' },
    };
    // Return 200 even when degraded so a hosting platform does not kill a
    // service that can still plan journeys over live providers.
    return reply.status(200).send({
      status: degraded ? 'degraded' : 'ok',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      version: '0.1.0',
      environment: config.NODE_ENV,
      checks,
    });
  });
}
