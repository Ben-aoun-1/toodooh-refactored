import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db, sql } from '../src/db/client.js';
import { type NewUser, campaigns, engineEvents, users } from '../src/db/schema.js';
import { NOOP_TRACE, createEngineTrace } from '../src/lib/engine-journal/trace.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// LOG1 — the collector's own contract: buffer in memory, flush ONE batch AFTER the outcome
// (commit or rollback both write their trace), and NEVER throw into an engine path. The engine's
// behavior stays byte-unchanged: the default everywhere is NOOP_TRACE.

let seq = 0;
const seedCampaign = async (): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `log${seq}@example.com`,
      contactName: `User ${seq}`,
      status: 'approved',
      role: 'advertiser',
    } as Partial<NewUser> as NewUser)
    .returning();
  const [c] = await db
    .insert(campaigns)
    .values({ advertiserId: u?.id ?? '', name: 'LOG1', campaignType: 'standard', status: 'draft' })
    .returning();
  return c?.id ?? '';
};

const eventsFor = async (campaignId: string) =>
  db.select().from(engineEvents).where(eq(engineEvents.campaignId, campaignId));

describe('EngineTrace collector (real Postgres)', () => {
  beforeEach(async () => {
    await resetAuthTables();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('buffers events and flushes ONE batch on finish, with a run-summary row', async () => {
    const campaignId = await seedCampaign();
    const trace = createEngineTrace('dispatch', campaignId);
    trace.event('pool_assembled', { poolSize: 3 });
    trace.event('venue_excluded', { reason: 'hours_missing' }, null);
    await trace.finish('committed', { nRetenus: 3 });

    const rows = await eventsFor(campaignId);
    expect(rows).toHaveLength(3);
    const run = rows.find((r) => r.eventType === 'run');
    expect(run).toBeDefined();
    expect(run?.outcome).toBe('committed');
    expect(run?.phase).toBe('dispatch');
    expect(run?.payload).toMatchObject({ nRetenus: 3 });
    // Every event shares the run's id; non-summary rows carry NO outcome.
    expect(new Set(rows.map((r) => r.runId)).size).toBe(1);
    expect(rows.filter((r) => r.eventType !== 'run').every((r) => r.outcome === null)).toBe(true);
    // In-run ordering rides payload.seq (batch createdAt ties).
    const seqs = rows
      .filter((r) => r.eventType !== 'run')
      .map((r) => (r.payload as { seq: number }).seq);
    expect(seqs).toEqual([0, 1]);
  });

  it('flushes the trace on a ROLLED-BACK run too (the refusal keeps its reasons)', async () => {
    const campaignId = await seedCampaign();
    const trace = createEngineTrace('dispatch', campaignId);
    trace.event('venue_excluded', { reason: 'zone_mismatch' });
    await trace.finish('rolled_back', { reason: 'TOO_THIN' });

    const rows = await eventsFor(campaignId);
    expect(rows).toHaveLength(2);
    const run = rows.find((r) => r.eventType === 'run');
    expect(run?.outcome).toBe('rolled_back');
    expect(run?.payload).toMatchObject({ reason: 'TOO_THIN' });
  });

  it('NEVER throws into the engine path — a failed flush warns and swallows', async () => {
    // A campaign id that violates the FK: the batch insert fails; finish must not throw.
    const trace = createEngineTrace('dispatch', '00000000-0000-0000-0000-000000000000');
    trace.event('pool_assembled', { poolSize: 1 });
    await expect(trace.finish('committed')).resolves.toBeUndefined();
  });

  it('the no-op default accepts the full surface and touches nothing', async () => {
    const campaignId = await seedCampaign();
    NOOP_TRACE.event('anything', { x: 1 }, 'sh-1');
    await NOOP_TRACE.finish('committed');
    expect(await eventsFor(campaignId)).toHaveLength(0);
  });
});
