import Fastify, { type FastifyInstance } from 'fastify';

const PORT = 4000;
const HOST = '0.0.0.0';

const app: FastifyInstance = Fastify();

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, 'shutdown signal received');
  try {
    await app.close();
    process.exit(0);
  } catch {
    process.exit(1);
  }
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
