import type { FastifyServerOptions } from 'fastify';
import pino from 'pino';

import { env } from './env.js';
import type { Env } from './env.js';

export const buildLoggerConfig = (env: Env): FastifyServerOptions['logger'] => {
  if (env.NODE_ENV === 'production') {
    return { level: env.LOG_LEVEL };
  }
  return {
    level: env.LOG_LEVEL,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    },
  };
};

// Standalone logger for non-request contexts (better-auth hooks, the
// email-verification stub) where there is no Fastify request logger.
export const logger = pino({ level: env.LOG_LEVEL });
