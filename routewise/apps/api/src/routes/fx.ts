import type { FastifyInstance } from 'fastify';
import { fxService } from '../providers/fx/index.js';

export async function fxRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { base?: string; symbols?: string } }>('/api/v1/fx/rates', async (req, reply) => {
    const base = (req.query.base ?? 'EUR').toUpperCase();
    if (!/^[A-Z]{3}$/.test(base)) {
      return reply.status(400).send({ error: 'bad_request', message: 'base must be an ISO 4217 code' });
    }
    const symbols = (req.query.symbols ?? 'USD,EUR,GBP,NGN,KES,GHS,INR,BRL,SGD,JPY,ZAR,AED')
      .split(',')
      .map((symbol) => symbol.trim().toUpperCase())
      .filter((symbol) => /^[A-Z]{3}$/.test(symbol))
      .slice(0, 30);

    const rates: Record<string, { rate: number; asOf: string } | null> = {};
    await Promise.all(
      symbols.map(async (symbol) => {
        const rate = await fxService.getRate(base, symbol);
        rates[symbol] = rate ? { rate: rate.rate, asOf: rate.asOf } : null;
      }),
    );
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
