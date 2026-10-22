import { access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import { config, APP_VERSION } from './config.js';
import { loggerOptions } from './utils/logger.js';
import { AppError } from './utils/errors.js';
import { dbEnabled } from './db/pool.js';
import { expireReports } from './db/repos/reports.js';
import { runAutoSetup } from './db/bootstrap.js';
import { healthRoutes } from './routes/health.js';
import { metaRoutes } from './routes/meta.js';
import { geocodeRoutes } from './routes/geocode.js';
import { planRoutes } from './routes/plan.js';
import { reportRoutes } from './routes/reports.js';
import { userRoutes } from './routes/user.js';
import { fxRoutes } from './routes/fx.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Locate the built web app.
 *
 * `WEB_DIST_DIR` is relative to the repository root, but the process working
 * directory is not always the root: `npm run start -w @routewise/api` (what
 * Render runs) sets cwd to apps/api. Try the repository root derived from this
 * file's location as well, and only accept a directory that has an index.html.
 */
function resolveWebRoot(): string | null {
  const configured = config.WEB_DIST_DIR;
  const candidates = path.isAbsolute(configured)
    ? [configured]
    : [
        path.resolve(process.cwd(), configured),
        path.resolve(here, '../../..', configured), // built: apps/api/dist -> repo root
        path.resolve(here, '../../../..', configured), // tsx: apps/api/src -> repo root
      ];
  return candidates.find((candidate) => existsSync(path.join(candidate, 'index.html'))) ?? null;
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    trustProxy: true,
    bodyLimit: 1 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // native apps / server-to-server
      if (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Profile-Token', 'X-Moderation-Token'],
    maxAge: 86_400,
  });

  await app.register(rateLimit, {
    max: 180,
    timeWindow: '1 minute',
    allowList: [],
  });

  // Compress JSON/HTML/JS above 1 kB; big win on mobile connections.
  await app.register(compress, { global: true, threshold: 1024 });

  // API banner. When the web app is served from this process, `/` belongs to
  // the app and the banner lives at `/api`.
  app.get(config.SERVE_WEB ? '/api' : '/', async () => ({
    name: 'RouteWise API',
    version: APP_VERSION,
    docs: '/api/v1/meta',
    health: '/healthz',
    ready: '/readyz',
  }));

  await app.register(healthRoutes);
  await app.register(metaRoutes);
  await app.register(geocodeRoutes);
  await app.register(planRoutes);
  await app.register(reportRoutes);
  await app.register(userRoutes);
  await app.register(fxRoutes);

  // Single-service deployment: serve the built web app from this process.
  // /api/* is registered above and therefore wins; everything else falls back
  // to index.html for client-side routing.
  let servingWeb = false;
  if (config.SERVE_WEB) {
    const root = resolveWebRoot();
    try {
      if (!root) throw new Error(`no index.html for WEB_DIST_DIR=${config.WEB_DIST_DIR}`);
      await access(path.join(root, 'index.html'));
      await app.register(fastifyStatic, {
        root,
        // Hashed assets are immutable; the shell and the service worker must
        // always be revalidated or deploys would never reach returning users.
        cacheControl: false,
        setHeaders: (res, filePath) => {
          const revalidate =
            filePath.endsWith('.html') ||
            filePath.endsWith('sw.js') ||
            filePath.endsWith('.webmanifest');
          res.setHeader(
            'Cache-Control',
            revalidate ? 'no-cache' : 'public, max-age=31536000, immutable',
          );
        },
      });
      servingWeb = true;
      app.log.info({ root }, 'serving built web app');
    } catch {
      app.log.warn(
        { configured: config.WEB_DIST_DIR, cwd: process.cwd(), candidates: [process.cwd()] },
        'web build not found — run `npm run build` or set WEB_DIST_DIR; serving API only',
      );
    }
  }

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
        details: error.details,
      });
    }
    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({
        error: 'rate_limited',
        message: 'Too many requests. Please slow down and try again shortly.',
      });
    }
    req.log.error({ err: error }, 'unhandled request error');
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : String(error);
    return reply.status(status).send({
      error: 'internal_error',
      message:
        config.isProduction && status === 500 ? 'An unexpected error occurred.' : message,
    });
  });

  app.setNotFoundHandler((req, reply) => {
    const wantsHtml =
      servingWeb &&
      (req.method === 'GET' || req.method === 'HEAD') &&
      !req.url.startsWith('/api/') &&
      (req.headers.accept ?? '').includes('text/html');
    if (wantsHtml) {
      return reply
        .header('Cache-Control', 'no-cache')
        .sendFile('index.html');
    }
    reply.status(404).send({ error: 'not_found', path: req.url });
  });

  return app;
}

async function start() {
  const app = await buildServer();

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
    app.log.info(
      `RouteWise API listening on ${config.HOST}:${config.PORT} (database: ${dbEnabled ? 'configured' : 'not configured'})`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Setup runs *after* the port is open so a platform health check never waits
  // for a 236k-row city import. Requests that arrive before the schema exists
  // already degrade gracefully; migrations are idempotent.
  if ((config.AUTO_SETUP || config.AUTO_MIGRATE) && dbEnabled) {
    app.log.info('automatic database setup starting in the background');
    void runAutoSetup(app.log).then((result) => {
      app.log.info(result, 'automatic database setup finished');
    });
  }

  // Housekeeping: expire stale community reports every 15 minutes.
  let timer: NodeJS.Timeout | undefined;
  if (dbEnabled) {
    timer = setInterval(() => {
      expireReports()
        .then((count) => {
          if (count > 0) app.log.info(`expired ${count} community report(s)`);
        })
        .catch((err) => app.log.warn({ err }, 'report expiry failed'));
    }, 15 * 60_000);
    timer.unref?.();
  }

  const shutdown = async (signal: string) => {
    app.log.info(`received ${signal}, shutting down`);
    if (timer) clearInterval(timer);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun || process.env.ROUTEWISE_START === '1') {
  void start();
}
