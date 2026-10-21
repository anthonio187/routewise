import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment-driven configuration. Every external provider is optional and
 * replaceable; the API must boot even when a provider is disabled or down.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().optional(),
  /** Set DATABASE_SSL=true for hosted Postgres with public TLS (Render, Neon…). */
  DATABASE_SSL: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /** Apply pending migrations on boot (free plans have no pre-deploy step). */
  AUTO_MIGRATE: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  /** Create schema + seed reference geography and cities on a fresh database. */
  AUTO_SETUP: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  /** Serve the built web app from the API so one service can host both. */
  SERVE_WEB: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  WEB_DIST_DIR: z.string().default('apps/web/dist'),

  GEOCODING_PROVIDER: z.enum(['nominatim', 'maptiler', 'disabled']).default('nominatim'),
  NOMINATIM_BASE_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
  NOMINATIM_USER_AGENT: z.string().default('RouteWise/0.1 (development)'),
  NOMINATIM_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(1100),
  MAPTILER_KEY: z.string().optional(),

  STREET_ROUTING_PROVIDER: z.enum(['osrm', 'haversine', 'disabled']).default('haversine'),
  OSRM_BASE_URL: z.string().url().default('https://router.project-osrm.org'),
  OSRM_PROFILE: z.string().default('foot'),

  TRANSIT_PROVIDER: z.enum(['transitous', 'local_gtfs', 'disabled']).default('transitous'),
  TRANSITOUS_BASE_URL: z.string().url().default('https://api.transitous.org'),
  TRANSITOUS_USER_AGENT: z
    .string()
    .default('RouteWise/0.1.0 (development; +https://github.com/anthonio187/routewise)'),
  TRANSIT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  // Real, keyless exchange rates (includes NGN, KES, GHS, INR, BRL, …).
  FX_PROVIDER: z.enum(['open_er_api', 'disabled']).default('open_er_api'),
  FX_BASE_URL: z.string().url().default('https://open.er-api.com'),
  FX_CACHE_TTL_MINUTES: z.coerce.number().int().positive().default(360),

  MAX_ACCESS_WALK_METERS: z.coerce.number().int().positive().default(1200),
  MAX_TRANSFER_WALK_METERS: z.coerce.number().int().positive().default(500),
  MAX_TRANSFERS: z.coerce.number().int().min(0).max(6).default(3),
  MAX_DEPARTURES_PER_STOP: z.coerce.number().int().positive().default(80),
  PLANNING_WINDOW_MINUTES: z.coerce.number().int().positive().default(180),

  REPORT_TTL_HOURS: z.coerce.number().int().positive().default(72),
  REPORT_MIN_INTERVAL_SECONDS: z.coerce.number().int().nonnegative().default(120),
  REPORT_CONFIRMATIONS_TO_VERIFY: z.coerce.number().int().positive().default(3),
  DEVICE_HASH_SALT: z.string().default('routewise-dev-salt'),
  MODERATION_TOKEN: z.string().default(''),

  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  isProduction: boolean;
  corsOrigins: string[];
};

function loadConfig(): AppConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${details}`);
  }
  const env = parsed.data;
  return {
    ...env,
    isProduction: env.NODE_ENV === 'production',
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export const config: AppConfig = loadConfig();

export const APP_VERSION = '0.1.0';
export const API_VERSION = 'v1';
