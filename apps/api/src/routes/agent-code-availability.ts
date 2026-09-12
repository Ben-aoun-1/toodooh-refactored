import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { agentCodeVerdict } from '../lib/agent-lookup.js';
import { PROFILE_TYPES } from '../lib/profile-type.js';

// AGENT-V1 — the wizard's agent-code pre-check, the same shape as email-availability and
// tax-availability (ruling 2026-06-10: format first, availability second; rate-limited so the
// codes cannot be harvested in bulk). `available: true` means « an agent with this code exists
// AND can refer this profile type »; the signup route re-checks and 409s regardless.

const MAX_PER_MINUTE = 10;

const bodySchema = z.object({
  agent_code: z.string().min(1).max(32),
  profile_type: z.enum(PROFILE_TYPES).optional(),
});

export const agentCodeAvailabilityRoute: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: MAX_PER_MINUTE,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Trop de tentatives. Réessayez dans une minute.',
    }),
  });

  app.post('/api/signup/agent-code-availability', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: 'Validation failed',
        fields: parsed.error.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
      });
    }
    const verdict = await agentCodeVerdict(parsed.data.agent_code, parsed.data.profile_type);
    return reply.status(200).send({ available: verdict === 'ok', verdict });
  });
};
