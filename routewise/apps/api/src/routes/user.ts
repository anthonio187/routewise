import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PlanResponse } from '@routewise/shared';
import { dbEnabled } from '../db/pool.js';
import { getPreferences, upsertPreferences } from '../db/repos/preferences.js';
import { deleteSaved, getBySlug, listSaved, saveJourney } from '../db/repos/saved.js';
import { hashDevice } from '../utils/hash.js';
import { PreferencesSchema, SavedJourneySchema } from './schemas.js';

function profileHash(req: FastifyRequest): string | null {
  const token = req.headers['x-profile-token'];
  if (typeof token !== 'string' || token.length < 16) return null;
  return hashDevice(['profile', token]);
}

export async function userRoutes(app: FastifyInstance) {
  app.get('/api/v1/preferences', async (req, reply) => {
    const hash = profileHash(req);
    if (!hash) {
      return reply.status(401).send({
        error: 'profile_token_required',
        message: 'Send a stable X-Profile-Token header (at least 16 characters) to store preferences.',
      });
    }
    if (!dbEnabled) return reply.status(503).send({ error: 'storage_unavailable' });
    const preferences = await getPreferences(hash);
    return reply.send({
      preferences: preferences ?? {
        preferredLanguage: 'en',
        preferredCurrency: null,
        units: 'metric',
        timezone: null,
        homeCityId: null,
      },
    });
  });

  app.put('/api/v1/preferences', async (req, reply) => {
    const hash = profileHash(req);
    if (!hash) {
      return reply.status(401).send({ error: 'profile_token_required' });
    }
    if (!dbEnabled) return reply.status(503).send({ error: 'storage_unavailable' });
    const parsed = PreferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'bad_request', details: parsed.error.flatten() });
    }
    const preferences = await upsertPreferences(hash, parsed.data);
    return reply.send({ preferences });
  });

  app.post('/api/v1/saved', async (req, reply) => {
    if (!dbEnabled) {
      return reply.status(503).send({
        error: 'storage_unavailable',
        message: 'Saving journeys requires a database. You can still share plans using the URL-encoded snapshot share link from the client.',
      });
    }
    const parsed = SavedJourneySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'bad_request', details: parsed.error.flatten() });
    }
    const plan = parsed.data.plan as PlanResponse;
    if (!plan || !Array.isArray(plan.journeys)) {
      return reply.status(400).send({ error: 'bad_request', message: 'plan must be a RouteWise plan response' });
    }
    const journeyExists = plan.journeys.some((journey) => journey.id === parsed.data.journeyId);
    if (!journeyExists) {
      return reply.status(400).send({ error: 'bad_request', message: 'journeyId is not part of that plan' });
    }
    const saved = await saveJourney({
      profileHash: profileHash(req),
      title: parsed.data.title,
      plan,
      journeyId: parsed.data.journeyId,
    });
    return reply.status(201).send({ saved });
  });

  app.get('/api/v1/saved', async (req, reply) => {
    const hash = profileHash(req);
    if (!hash) return reply.status(401).send({ error: 'profile_token_required' });
    if (!dbEnabled) return reply.status(503).send({ error: 'storage_unavailable' });
    const saved = await listSaved(hash);
    return reply.send({ saved });
  });

  app.get<{ Params: { slug: string } }>('/api/v1/saved/:slug', async (req, reply) => {
    if (!dbEnabled) return reply.status(503).send({ error: 'storage_unavailable' });
    const saved = await getBySlug(req.params.slug);
    if (!saved) return reply.status(404).send({ error: 'not_found' });
    return reply.send({ saved });
  });

  app.delete<{ Params: { id: string } }>('/api/v1/saved/:id', async (req, reply) => {
    const hash = profileHash(req);
    if (!hash) return reply.status(401).send({ error: 'profile_token_required' });
    if (!dbEnabled) return reply.status(503).send({ error: 'storage_unavailable' });
    const deleted = await deleteSaved(req.params.id, hash);
    return deleted ? reply.status(204).send() : reply.status(404).send({ error: 'not_found' });
  });
}
