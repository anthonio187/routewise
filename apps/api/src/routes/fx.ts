import type { FastifyInstance } from 'fastify';
import { fxService } from '../providers/fx/index.js';

export async function fxRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { base?: string; symbols?: string } }>('/api/v1/fx/rates', async (req, reply) => {
    const base = (req.query.base ?? 'EUR').toUpperCase();
    if (!/^[A-Z]{3}$/.test(base)) {
      return reply.status(400).send({ error: 'bad_request', message: 'base must be an ISO 4217 code' });
    }
    // No hardcoded currency list: callers may ask for specific symbols, but by
    // default every currency the provider knows about is returned so that any
    // itinerary currency can be converted.
    const requested = (req.query.symbols ?? '')
      .split(',')
      .map((symbol) => symbol.trim().toUpperCase())
      .filter((symbol) => /^[A-Z]{3}$/.test(symbol))
      .slice(0, 60);

    const all = await fxService.allRates(base);
    const rates: Record<string, { rate: number; asOf: string } | null> = {};
    if (requested.length > 0) {
      for (const symbol of requested) {
        rates[symbol] = all[symbol] ?? null;
      }
    } else {
      Object.assign(rates, all);
    }
    return reply.send({
      base,
      provider: fxService.name,
      attribution: fxService.attribution,
      rates,
      notice:
        fxService.configured
          ? 'Indicative mid-market rates for display only. They are not fare quotes and may not match operator pricing.'
          : 'Currency conversion is disabled on this deployment.',
    });
  });
}
