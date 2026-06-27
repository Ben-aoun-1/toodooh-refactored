import type { FastifyRequest, FastifyServerOptions } from 'fastify';
import pino from 'pino';

import { env } from './env.js';
import type { Env } from './env.js';
import { redactTokenInUrl } from './lib/playout/redact.js';

// Request serializer that strips a `token` query param from the logged URL (the /ws/screen device
// token rides the query string). Keeps the standard request fields otherwise.
const serializers = {
  req: (request: FastifyRequest) => ({
    method: request.method,
    url: redactTokenInUrl(request.url),
    host: request.headers.host,
    remoteAddress: request.ip,
    remotePort: request.socket.remotePort,
  }),
};

export const buildLoggerConfig = (env: Env): FastifyServerOptions['logger'] => {
  if (env.NODE_ENV === 'production') {
    return { level: env.LOG_LEVEL, serializers };
  }
  return {
    level: env.LOG_LEVEL,
    serializers,
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
