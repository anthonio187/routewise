import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

/**
 * The API can run in a degraded "no database" mode: real-time journey planning
 * and geocoding still work through external providers, while persistent
 * features (reports, saved journeys, GTFS, fare history) report that storage is
 * unavailable instead of silently pretending to save anything.
 */
export const dbEnabled = Boolean(config.DATABASE_URL);

export const pool = dbEnabled
  ? new Pool({
      connectionString: config.DATABASE_URL,
      max: Number(process.env.PGPOOL_MAX ?? 8),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ...(config.DATABASE_SSL ? { ssl: { rejectUnauthorized: false } } : {}),
    })
  : null;

pool?.on('error', (err) => {
  // Never crash the process on an idle client error.
  console.error('[db] idle client error:', err.message);
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  if (!pool) {
    throw new Error('DATABASE_NOT_CONFIGURED');
  }
  return pool.query<T>(text, values as never[]);
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  if (!pool) throw new Error('DATABASE_NOT_CONFIGURED');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export interface DbHealth {
  configured: boolean;
  reachable: boolean;
  postgis: boolean | null;
  error?: string;
}

export async function checkDatabase(): Promise<DbHealth> {
  if (!pool) return { configured: false, reachable: false, postgis: null };
  try {
    const res = await pool.query<{ postgis: string | null }>(
      "SELECT postgis_version() AS postgis",
    );
    return { configured: true, reachable: true, postgis: Boolean(res.rows[0]?.postgis) };
  } catch (err) {
    return {
      configured: true,
      reachable: false,
      postgis: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function closePool(): Promise<void> {
  await pool?.end();
}
