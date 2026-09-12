import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { agents, users } from '../src/db/schema.js';
import { agentCodeAvailabilityRoute } from '../src/routes/agent-code-availability.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// AGENT-V1 — the wizard's pre-check for the agent code (mirrors email/tax availability).
describe('POST /api/signup/agent-code-availability', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    await resetAuthTables();
    const [agentUser] = await db
      .insert(users)
      .values({ email: 'agent-sh@example.com', contactName: 'Agent', role: 'screenhost_agent' })
      .returning({ id: users.id });
    await db.insert(agents).values({ userId: agentUser?.id ?? '', code: 'SH123456' });
    app = Fastify({ logger: false });
    await app.register(agentCodeAvailabilityRoute);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });
  afterAll(async () => {
    await sql.end();
  });

  const probe = (body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/signup/agent-code-availability', payload: body });

  it('an existing screenhost agent is available for an owner', async () => {
    const res = await probe({ agent_code: 'sh 123456', profile_type: 'individual_owner' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: true, verdict: 'ok' });
  });

  it('the same code is NOT available for an advertiser (wrong agent type)', async () => {
    const res = await probe({ agent_code: 'SH123456', profile_type: 'advertiser' });
    expect(res.json()).toEqual({ available: false, verdict: 'incompatible' });
  });

  it('an unknown code is not available', async () => {
    const res = await probe({ agent_code: 'SH999999', profile_type: 'individual_owner' });
    expect(res.json()).toEqual({ available: false, verdict: 'unknown' });
  });

  it('malformed body → 400', async () => {
    expect((await probe({})).statusCode).toBe(400);
  });
});
