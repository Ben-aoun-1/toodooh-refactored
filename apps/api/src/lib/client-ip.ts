import type { FastifyRequest } from 'fastify';

/**
 * The visitor's IP for per-visitor rate limits. The API has no trustProxy, so `request.ip` is
 * nginx's container address — keyed on it, every visitor would share ONE bucket. nginx sets
 * X-Real-IP to $remote_addr (proxy_common.conf), overwriting anything the client sent, so it is
 * the trustworthy source; direct (dev/test) calls fall back to the socket address.
 */
export const clientIp = (request: FastifyRequest): string => {
  const real = request.headers['x-real-ip'];
  return typeof real === 'string' && real.length > 0 ? real : request.ip;
};
