import { config } from '../../config.js';
import { TtlCache } from '../../utils/cache.js';
import { fetchWithTimeout } from '../../utils/limiter.js';

export interface FxRate {
  base: string;
  quote: string;
  rate: number;
  asOf: string;
  provider: string;
}

export interface FxProvider {
  readonly name: string;
  readonly configured: boolean;
  readonly attribution: string;
  rates(base: string): Promise<Record<string, { rate: number; asOf: string }>>;
}

interface OpenErApiResponse {
  result?: string;
  base_code?: string;
  time_last_update_unix?: number;
  time_last_update_utc?: string;
  rates?: Record<string, number>;
  'error-type'?: string;
}

/** open.er-api.com — keyless, broad currency coverage (incl. NGN, KES, GHS, INR, BRL). */
class OpenErApiProvider implements FxProvider {
  readonly name = 'open_er_api';
  readonly configured = true;
  readonly attribution = 'Exchange rates by open.er-api.com (indicative mid-market rates).';

  async rates(base: string) {
    const url = `${config.FX_BASE_URL.replace(/\/$/, '')}/v6/latest/${encodeURIComponent(base)}`;
    const res = await fetchWithTimeout(
      url,
      { headers: { Accept: 'application/json', 'User-Agent': 'RouteWise/0.1' } },
      config.PROVIDER_TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`FX provider HTTP ${res.status}`);
    const data = (await res.json()) as OpenErApiResponse;
    if (data.result !== 'success' || !data.rates) {
      throw new Error(`FX provider error: ${data['error-type'] ?? 'unknown'}`);
    }
    const asOf = data.time_last_update_unix
      ? new Date(data.time_last_update_unix * 1000).toISOString()
      : new Date(data.time_last_update_utc ?? Date.now()).toISOString();
    const out: Record<string, { rate: number; asOf: string }> = {};
    for (const [quote, rate] of Object.entries(data.rates)) {
      if (typeof rate === 'number' && rate > 0) out[quote.toUpperCase()] = { rate, asOf };
    }
    return out;
  }
}

class DisabledFxProvider implements FxProvider {
  readonly name = 'disabled';
  readonly configured = false;
  readonly attribution = 'Currency conversion disabled';
  async rates(): Promise<Record<string, { rate: number; asOf: string }>> {
    return {};
  }
}

/**
 * Currency conversion service.
 * - Caches upstream rates (memory + optional Postgres persistence).
 * - NEVER invents a rate: if a pair cannot be fetched, callers receive null and
 *   the UI keeps showing the original currency.
 */
class FxService {
  private cache = new TtlCache<Record<string, { rate: number; asOf: string }>>(
    config.FX_CACHE_TTL_MINUTES * 60_000,
    32,
  );

  constructor(private readonly provider: FxProvider) {}

  get name() {
    return this.provider.name;
  }
  get configured() {
    return this.provider.configured;
  }
  get attribution() {
    return this.provider.attribution;
  }

  private async ratesFor(base: string) {
    const upper = base.toUpperCase();
    const cached = this.cache.get(upper);
    if (cached) return cached;

    let rates: Record<string, { rate: number; asOf: string }> = {};
    try {
      rates = await this.provider.rates(upper);
      this.cache.set(upper, rates);
    } catch (err) {
      console.warn(`[fx:${this.provider.name}] ${String(err)}`);
    }

    // Database fallback: reuse a recent stored rate when the provider is down.
    try {
      const { latestStoredRate } = await import('../../db/repos/fx.js');
      const symbols = new Set([...Object.keys(rates), 'USD', 'EUR', 'GBP']);
      for (const quote of symbols) {
        if (rates[quote]) continue;
        const stored = await latestStoredRate(upper, quote);
        if (stored && Date.now() - new Date(stored.asOf).getTime() < 7 * 86_400_000) {
          rates[quote] = { rate: stored.rate, asOf: stored.asOf };
        }
      }
      if (Object.keys(rates).length > 0) this.cache.set(upper, rates);
    } catch {
      // No database configured — memory cache only.
    }
    return rates;
  }

  async getRate(base: string, quote: string): Promise<FxRate | null> {
    const baseUpper = base.toUpperCase();
    const quoteUpper = quote.toUpperCase();
    if (baseUpper === quoteUpper) {
      return {
        base: baseUpper,
        quote: quoteUpper,
        rate: 1,
        asOf: new Date().toISOString(),
        provider: 'identity',
      };
    }
    const rates = await this.ratesFor(baseUpper);
    const hit = rates[quoteUpper];
    if (!hit) return null;
    return {
      base: baseUpper,
      quote: quoteUpper,
      rate: hit.rate,
      asOf: hit.asOf,
      provider: this.provider.name,
    };
  }

  /** Every rate available for `base`, with the identity rate for the base itself. */
  async allRates(base: string): Promise<Record<string, { rate: number; asOf: string }>> {
    const baseUpper = base.toUpperCase();
    const rates = await this.ratesFor(baseUpper);
    if (!rates[baseUpper]) {
      rates[baseUpper] = { rate: 1, asOf: new Date().toISOString() };
    }
    return rates;
  }

  /** Convert a fare for display. Returns null rather than guessing when no rate exists. */
  async convert(
    amount: number,
    from: string,
    to: string,
  ): Promise<{ amount: number; currency: string; rate: number; asOf: string; provider: string } | null> {
    const rate = await this.getRate(from, to);
    if (!rate) return null;
    return {
      amount: Math.round(amount * rate.rate * 100) / 100,
      currency: rate.quote,
      rate: rate.rate,
      asOf: rate.asOf,
      provider: rate.provider,
    };
  }
}

export const fxService = new FxService(
  config.FX_PROVIDER === 'open_er_api' ? new OpenErApiProvider() : new DisabledFxProvider(),
);
