import type { DrizzleDb } from '../db/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DrizzleDb;
  }
}
