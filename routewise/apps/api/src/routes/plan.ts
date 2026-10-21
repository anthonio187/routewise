import type { FastifyInstance } from 'fastify';
import { planJourney } from '../planner/index.js';
import { PlanRequestSchema } from './schemas.js';

export async function planRoutes(app: FastifyInstance) {
  app.post('/api/v1/plan', {
    config: {
      rateLimit: { max: 30, timeWindow: '1 minute' },
    },
    handler: async (req, reply) => {
      const parsed = PlanRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'bad_request',
          message: 'Invalid journey request',
          details: parsed.error.flatten(),
        });
      }
      const response = await planJourney(parsed.data);
      return reply.send(response);
    },
  });
}
