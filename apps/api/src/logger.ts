import type { FastifyServerOptions } from 'fastify';

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
