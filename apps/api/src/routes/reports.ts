import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { dbEnabled } from '../db/pool.js';
import {
  createReport,
  expireReports,
  getReport,
  listReports,
  moderateReport,
  recentSubmissionCount,
  voteReport,
} from '../db/repos/reports.js';
import { hashDevice } from '../utils/hash.js';
import { ReportSchema, VoteSchema } from './schemas.js';

function deviceHash(req: FastifyRequest): string {
  const token = (req.headers['x-profile-token'] as string | undefined) ?? '';
  return hashDevice([req.ip, req.headers['user-agent'] ?? '', token]);
}

export async function reportRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: {
      cityId?: string;
      routeId?: string;
      category?: string;
      status?: string;
      bbox?: string;
      limit?: string;
    };
  }>('/api/v1/reports', async (req, reply) => {
    if (!dbEnabled) {
      return reply.status(200).send({
        reports: [],
        notice: 'Community reports require a database. This deployment does not have one configured.',
      });
    }
    await expireReports().catch(() => undefined);

    let bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number } | undefined;
    if (req.query.bbox) {
      const parts = req.query.bbox.split(',').map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        return reply.status(400).send({ error: 'bad_request', message: 'bbox must be minLng,minLat,maxLng,maxLat' });
      }
      const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
      bbox = { minLng, minLat, maxLng, maxLat };
    }

    const reports = await listReports({
      cityId: req.query.cityId,
      routeId: req.query.routeId,
      category: req.query.category,
      status: req.query.status,
      bbox,
      limit: Number(req.query.limit ?? 50),
    });
    return reply.send({
      reports,
      disclaimer:
        'Community reports are user submissions, not official operator announcements. Verify before relying on them.',
    });
  });

  app.get<{ Params: { id: string } }>('/api/v1/reports/:id', async (req, reply) => {
    if (!dbEnabled) return reply.status(503).send({ error: 'storage_unavailable' });
    const report = await getReport(req.params.id);
    if (!report) return reply.status(404).send({ error: 'not_found' });
    return reply.send({ report });
  });

  app.post('/api/v1/reports', {
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    handler: async (req, reply) => {
      if (!dbEnabled) {
        return reply.status(503).send({
          error: 'storage_unavailable',
          message:
            'Community reports need a database. This deployment runs without persistent storage, so nothing would be saved.',
        });
      }
      const parsed = ReportSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'bad_request',
          message: 'Invalid report',
          details: parsed.error.flatten(),
        });
      }
      const input = parsed.data;
      const observed = new Date(input.observedAt);
      const now = Date.now();
      if (observed.getTime() > now + 10 * 60_000) {
        return reply.status(400).send({
          error: 'bad_request',
          message: 'observedAt cannot be in the future.',
        });
      }
      if (observed.getTime() < now - 30 * 86_400_000) {
        return reply.status(400).send({
          error: 'bad_request',
          message: 'Reports older than 30 days are not accepted.',
        });
      }

      const contributorHash = deviceHash(req);
      const recent = await recentSubmissionCount(
        contributorHash,
        Math.max(1, Math.ceil(config.REPORT_MIN_INTERVAL_SECONDS / 60)),
      );
      if (recent > 0) {
        return reply.status(429).send({
          error: 'rate_limited',
          message: `Please wait at least ${config.REPORT_MIN_INTERVAL_SECONDS} seconds between reports.`,
        });
      }

      const report = await createReport({
        category: input.category,
        title: input.title,
        body: input.body,
        observedAt: input.observedAt,
        cityId: input.cityId ?? null,
        routeId: input.routeId ?? null,
        stopId: input.stopId ?? null,
        location: input.location ?? null,
        currency: input.currency ?? null,
        contributorHash,
        ttlHours: config.REPORT_TTL_HOURS,
      });
      return reply.status(201).send({ report });
    },
  });

  app.post<{ Params: { id: string } }>('/api/v1/reports/:id/vote', {
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    handler: async (req, reply) => {
      if (!dbEnabled) return reply.status(503).send({ error: 'storage_unavailable' });
      const parsed = VoteSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'bad_request', message: 'vote must be confirm or dispute' });
      }
      const existing = await getReport(req.params.id);
      if (!existing) return reply.status(404).send({ error: 'not_found' });
      if (existing.status === 'rejected' || existing.status === 'expired') {
        return reply.status(409).send({ error: 'closed', message: 'This report is no longer open for votes.' });
      }
      const result = await voteReport(
        req.params.id,
        parsed.data.vote,
        hashDevice(['vote', req.ip, req.headers['user-agent'] ?? '', String(req.headers['x-profile-token'] ?? '')]),
        config.REPORT_CONFIRMATIONS_TO_VERIFY,
      );
      return reply.send(result);
    },
  });

  app.post<{ Params: { id: string }; Body: { status?: string; note?: string } }>(
    '/api/v1/reports/:id/moderate',
    async (req, reply) => {
      if (!config.MODERATION_TOKEN) {
        return reply.status(403).send({
          error: 'moderation_disabled',
          message: 'MODERATION_TOKEN is not configured on this deployment.',
        });
      }
      const token = req.headers['x-moderation-token'];
      if (typeof token !== 'string' || token !== config.MODERATION_TOKEN) {
        return reply.status(401).send({ error: 'unauthorized' });
      }
      if (!dbEnabled) return reply.status(503).send({ error: 'storage_unavailable' });
      const status = req.body?.status;
      if (status !== 'verified' && status !== 'rejected' && status !== 'open') {
        return reply.status(400).send({ error: 'bad_request', message: 'status must be verified, rejected or open' });
      }
      const report = await moderateReport(req.params.id, status, req.body?.note);
      if (!report) return reply.status(404).send({ error: 'not_found' });
      return reply.send({ report });
    },
  );
}
