import { query } from '../pool.js';

export interface StoredRate {
  base: string;
  quote: string;
  rate: number;
  asOf: string;
  provider: string;
}

/** Read the latest cached rate for a currency pair from the database. */
export async function latestStoredRate(base: string, quote: string): Promise<StoredRate | null> {
  const res = await query<{
    base: string;
    quote: string;
    rate: string;
    as_of: string;
    provider: string;
  }>(
    `SELECT base, quote, rate, as_of, provider FROM fx_rates
     WHERE base = $1 AND quote = $2
     ORDER BY as_of DESC LIMIT 1`,
    [base, quote],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    base: row.base,
    quote: row.quote,
    rate: Number(row.rate),
    asOf: row.as_of,
    provider: row.provider,
  };
}

export async function upsertRates(rates: StoredRate[]): Promise<void> {
  for (const rate of rates) {
    await query(
      `INSERT INTO fx_rates (base, quote, rate, as_of, provider)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (base, quote, as_of) DO UPDATE SET rate = EXCLUDED.rate, fetched_at = now()`,
      [rate.base, rate.quote, rate.rate, rate.asOf, rate.provider],
    );
  }
}
