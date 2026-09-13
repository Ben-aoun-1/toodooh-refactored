import type { preHandlerHookHandler } from 'fastify';

// SIM-0 — the simulator is OFF unless SIMULATOR_ENABLED=true (the require-sync-key posture:
// factory form, the flag passed explicitly so tests need no env mutation; never silently open).
export const requireSimulator =
  (enabled: boolean): preHandlerHookHandler =>
  async (request, reply) => {
    if (!enabled) {
      return reply.status(503).send({
        error: 'SIMULATOR_DISABLED',
        message: 'Le simulateur est désactivé sur ce serveur.',
        statusCode: 503,
        requestId: request.id,
      });
    }
  };
