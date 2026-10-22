import type { FastifyServerOptions } from 'fastify';
import { config } from '../config.js';

export const loggerOptions: FastifyServerOptions['logger'] = {
  level: config.LOG_LEVEL,
  ...(config.isProduction
    ? {}
    : {
        transport: undefined,
      }),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-moderation-token"]',
      'req.headers["x-profile-token"]',
      'req.headers["x-device-id"]',
    ],
    censor: '[redacted]',
  },
};
