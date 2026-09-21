import { sum } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  campaignReconciliation,
  campaigns,
  reversementLines,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { adminPlatformStatsRoutes } from '../src/routes/admin-platform-stats.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// DASH-1 — « Revenu Toodooh », R2 AMENDED (operator, 2026-09-21, day log §5 decision 4): the
// unsplit amount IS Toodooh revenue once the campaign is settled.
//
//   Revenu Toodooh = Σ reversement_lines.toodooh_amount_tnd
//                  + for every settled campaign that HAS reversement lines:
//                      campaign_reconciliation.spend_tnd − Σ its lines' base_value_tnd
//
// The second term is the sub-S_min undelivered value a RÉUSSIE debits but never splits (a PARTIAL
// refunds its gap, so its remainder is 0; an event's base IS its delivered value, remainder 0).
// Monthly: the lines by settled_at, the remainder by reconciled_at, in the Tunis month. Pre-E7
// settlements (no lines) stay OUT of Toodooh; the 3 % agent lines — with or without an agent —
// are never added. Post-E7, the ledger closes: Toodooh + Σ SH + Σ agent lines = Revenu total.
//
// Every amount is a 4-decimal string (the numeric(14,4) columns); every instant is NAMED (UTC `Z`)
// with its Tunis reading. The route's clock: Thu 15 Oct 2026, 10:00 Tunis → the Tunis month is
// October 2026 = [2026-09-30T23:00:00Z, 2026-10-31T23:00:00Z).
const NOW = new Date('2026-10-15T09:00:00Z');

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

interface RevenueBody {
  revenue: {
    total_tnd: number;
    toodooh_tnd: number;
    monthly: { month: string; total_tnd: number; toodooh_tnd: number };
  };
}

interface LineFixture {
  base: string;
  sh: string;
  toodooh: string;
  agentSh: string;
  agentSc: string;
  /** Defaults to the settlement's reconciled_at (the classic path stamps both from one instant). */
  settledAt?: Date;
  /** An assigned referral agent on both agent lines (default: none — the NULL-agent case). */
  agentId?: string;
}

interface SettlementFixture {
  name: string;
  campaignType: 'standard' | 'event';
  spend: string;
  refund?: string;
  reconciledAt: Date;
  lines: LineFixture[];
}

/** Exact comparison on the columns' own precision — 4 decimals, as integers. */
const tenThousandths = (tnd: number): number => Math.round(tnd * 1e4);

describe('GET /api/admin/platform-stats — « Revenu Toodooh » (R2 amended)', () => {
  let app: ReturnType<typeof Fastify>;
  let seq = 0;
  let advertiserId = '';
  let venueA = '';
  let venueB = '';

  const seedUser = async (values: Partial<NewUser>): Promise<string> => {
    seq += 1;
    const [u] = await db
      .insert(users)
      .values({ email: `toodooh${seq}@example.com`, contactName: `User ${seq}`, ...values })
      .returning();
    return u?.id ?? '';
  };

  const seedSettlement = async (s: SettlementFixture): Promise<void> => {
    const [c] = await db
      .insert(campaigns)
      .values({
        advertiserId,
        name: s.name,
        campaignType: s.campaignType,
        status: 'completed',
        requestedBudget: '9999.00', // never read by any revenue figure
      })
      .returning();
    const campaignId = c?.id ?? '';
    const refund = s.refund ?? '0.0000';
    await db.insert(campaignReconciliation).values({
      campaignId,
      expectedImp: 1000,
      deliveredImp: 900,
      manquementImp: 100,
      pPerteTnd: refund,
      refundTnd: refund,
      spendTnd: s.spend,
      status: refund === '0.0000' ? 'reussie' : 'partial',
      reconciledAt: s.reconciledAt,
    });
    if (s.lines.length === 0) return; // a pre-E7 settlement: no split was ever written
    await db.insert(reversementLines).values(
      s.lines.map((l, i) => ({
        source: s.campaignType === 'event' ? 'event' : 'campaign',
        campaignId,
        screenhostId: i % 2 === 0 ? venueA : venueB,
        baseValueTnd: l.base,
        shAmountTnd: l.sh,
        toodoohAmountTnd: l.toodooh,
        agentShAmountTnd: l.agentSh,
        agentScAmountTnd: l.agentSc,
        agentShId: l.agentId ?? null,
        agentScId: l.agentId ?? null,
        settledAt: l.settledAt ?? s.reconciledAt,
      })),
    );
  };

  /** Σ of the non-Toodooh lines, straight from the ledger (the invariant's right-hand side). */
  const payeeSums = async (): Promise<number> => {
    const [row] = await db
      .select({
        sh: sum(reversementLines.shAmountTnd),
        agentSh: sum(reversementLines.agentShAmountTnd),
        agentSc: sum(reversementLines.agentScAmountTnd),
      })
      .from(reversementLines);
    return Number(row?.sh ?? 0) + Number(row?.agentSh ?? 0) + Number(row?.agentSc ?? 0);
  };

  const getRevenue = async (): Promise<RevenueBody['revenue']> => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/platform-stats' });
    expect(res.statusCode).toBe(200);
    return (res.json() as RevenueBody).revenue;
  };

  beforeEach(async () => {
    await resetAuthTables();
    app = Fastify({ logger: false });
    await app.register(adminPlatformStatsRoutes, { now: () => NOW });
    await app.ready();
    const adminId = await seedUser({ role: 'admin', status: 'approved' });
    vi.spyOn(auth.api, 'getSession').mockResolvedValue({
      session: {},
      user: { id: adminId, role: 'admin', status: 'approved' },
    } as unknown as GetSessionResult);
    advertiserId = await seedUser({ role: 'advertiser', status: 'approved' });
    const ownerId = await seedUser({ role: 'fleet_owner', status: 'approved' });
    const [a] = await db.insert(screenhosts).values({ name: 'Venue A', ownerId }).returning();
    const [b] = await db.insert(screenhosts).values({ name: 'Venue B', ownerId }).returning();
    venueA = a?.id ?? '';
    venueB = b?.id ?? '';
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await sql.end();
  });

  // Every fixture below is a 50/44/3/3 split in exact millimes (the E7 rail's shape).
  const SUB_SMIN_CLASSIC: SettlementFixture = {
    // A RÉUSSIE: 100 debited, 95 delivered across two venues, the 5 TND gap under S_min — never
    // refunded, never split. That 5 is Toodooh's.
    name: 'classic-sub-smin',
    campaignType: 'standard',
    spend: '100.0000',
    reconciledAt: new Date('2026-10-05T10:00:00Z'), // Mon 5 Oct 11:00 Tunis
    lines: [
      { base: '60.0000', sh: '30.0000', toodooh: '26.4000', agentSh: '1.8000', agentSc: '1.8000' },
      { base: '35.0000', sh: '17.5000', toodooh: '15.4000', agentSh: '1.0500', agentSc: '1.0500' },
    ],
  };
  const PARTIAL_CLASSIC: SettlementFixture = {
    // A PARTIAL: the gap reached S_min and was refunded, so spend = Σ base — remainder 0.
    name: 'classic-partial',
    campaignType: 'standard',
    spend: '30.0000',
    refund: '70.0000',
    reconciledAt: new Date('2026-10-06T10:00:00Z'), // Tue 6 Oct 11:00 Tunis
    lines: [
      { base: '30.0000', sh: '15.0000', toodooh: '13.2000', agentSh: '0.9000', agentSc: '0.9000' },
    ],
  };
  const EVENT: SettlementFixture = {
    // An event settlement: the base IS the delivered value (spend) — remainder 0.
    name: 'event',
    campaignType: 'event',
    spend: '25.5000',
    refund: '4.5000',
    reconciledAt: new Date('2026-10-10T12:00:00Z'), // Sat 10 Oct 13:00 Tunis
    lines: [
      { base: '25.5000', sh: '12.7500', toodooh: '11.2200', agentSh: '0.7650', agentSc: '0.7650' },
    ],
  };

  it('a sub-S_min classic settlement: the undebited-but-unsplit remainder lands in Revenu Toodooh', async () => {
    await seedSettlement(SUB_SMIN_CLASSIC);

    const revenue = await getRevenue();
    expect(revenue.total_tnd).toBe(100);
    // 26.4 + 15.4 (the 44 % lines) + 5 (100 − (60 + 35), the unsplit sub-S_min gap)
    expect(revenue.toodooh_tnd).toBe(46.8);
    expect(revenue.monthly).toEqual({ month: '2026-10', total_tnd: 100, toodooh_tnd: 46.8 });
  });

  it('a partial settlement: the gap was refunded, so the remainder is 0', async () => {
    await seedSettlement(PARTIAL_CLASSIC);

    const revenue = await getRevenue();
    expect(revenue.total_tnd).toBe(30);
    expect(revenue.toodooh_tnd).toBe(13.2); // the 44 % line alone
    expect(revenue.monthly).toEqual({ month: '2026-10', total_tnd: 30, toodooh_tnd: 13.2 });
  });

  it('an event settlement: the base is the delivered value, so the remainder is 0', async () => {
    await seedSettlement(EVENT);

    const revenue = await getRevenue();
    expect(revenue.total_tnd).toBe(25.5);
    expect(revenue.toodooh_tnd).toBe(11.22);
    expect(revenue.monthly).toEqual({ month: '2026-10', total_tnd: 25.5, toodooh_tnd: 11.22 });
  });

  it('post-E7 the ledger closes: Toodooh + Σ SH + Σ agent lines = Revenu total', async () => {
    // One settlement with an ASSIGNED agent on its lines: whoever holds the 3 %, it is not Toodooh's.
    const agentId = await seedUser({ role: 'screenhost_agent', status: 'approved' });
    await seedSettlement(SUB_SMIN_CLASSIC);
    await seedSettlement({
      ...PARTIAL_CLASSIC,
      lines: PARTIAL_CLASSIC.lines.map((l) => ({ ...l, agentId })),
    });
    await seedSettlement(EVENT);

    const revenue = await getRevenue();
    expect(revenue.total_tnd).toBe(155.5); // 100 + 30 + 25.5
    expect(revenue.toodooh_tnd).toBe(71.22); // 46.8 + 13.2 + 11.22
    const payees = await payeeSums(); // SH 75.25 + agent SH 4.515 + agent SC 4.515
    expect(tenThousandths(payees)).toBe(tenThousandths(84.28));
    expect(tenThousandths(revenue.toodooh_tnd + payees)).toBe(tenThousandths(revenue.total_tnd));
  });

  it('a pre-E7 settlement (no lines) counts in Revenu total only — never in Revenu Toodooh', async () => {
    await seedSettlement(SUB_SMIN_CLASSIC);
    await seedSettlement({
      name: 'pre-e7',
      campaignType: 'standard',
      spend: '50.0000',
      reconciledAt: new Date('2026-10-07T10:00:00Z'), // Wed 7 Oct 11:00 Tunis
      lines: [],
    });

    const revenue = await getRevenue();
    expect(revenue.total_tnd).toBe(150);
    // Its 50 is neither split nor a remainder: no line exists to say what was delivered.
    expect(revenue.toodooh_tnd).toBe(46.8);
    expect(revenue.monthly).toEqual({ month: '2026-10', total_tnd: 150, toodooh_tnd: 46.8 });
  });

  it('the month: lines follow settled_at, the remainder follows reconciled_at (Tunis time)', async () => {
    // F — reconciled AND settled Thu 1 Oct 00:30 Tunis (= Wed 30 Sep 23:30 UTC): all IN October,
    //     although the UTC date still reads September. Remainder 20 − 18 = 2.
    await seedSettlement({
      name: 'F-1-oct-0030',
      campaignType: 'standard',
      spend: '20.0000',
      reconciledAt: new Date('2026-09-30T23:30:00Z'),
      lines: [
        { base: '18.0000', sh: '9.0000', toodooh: '7.9200', agentSh: '0.5400', agentSc: '0.5400' },
      ],
    });
    // G — reconciled Wed 30 Sep 23:59:59 Tunis (OUT), its line settled Thu 1 Oct 00:00:01 Tunis
    //     (IN): the 3.96 line counts in October, the remainder 10 − 9 = 1 in September.
    await seedSettlement({
      name: 'G-straddles-into-october',
      campaignType: 'event',
      spend: '10.0000',
      reconciledAt: new Date('2026-09-30T22:59:59Z'),
      lines: [
        {
          base: '9.0000',
          sh: '4.5000',
          toodooh: '3.9600',
          agentSh: '0.2700',
          agentSc: '0.2700',
          settledAt: new Date('2026-09-30T23:00:01Z'),
        },
      ],
    });
    // H — reconciled Sat 31 Oct 23:59:59 Tunis (IN), its line settled Sun 1 Nov 00:00:01 Tunis
    //     (OUT): the remainder 10 − 8 = 2 counts in October, the 3.52 line in November.
    await seedSettlement({
      name: 'H-straddles-out-of-october',
      campaignType: 'event',
      spend: '10.0000',
      reconciledAt: new Date('2026-10-31T22:59:59Z'),
      lines: [
        {
          base: '8.0000',
          sh: '4.0000',
          toodooh: '3.5200',
          agentSh: '0.2400',
          agentSc: '0.2400',
          settledAt: new Date('2026-10-31T23:00:01Z'),
        },
      ],
    });

    const revenue = await getRevenue();
    expect(revenue).toEqual({
      total_tnd: 40, // F 20 + G 10 + H 10
      toodooh_tnd: 20.4, // lines 7.92 + 3.96 + 3.52 + remainders 2 + 1 + 2
      monthly: {
        month: '2026-10',
        total_tnd: 30, // F 20 + H 10 (by reconciled_at)
        toodooh_tnd: 15.88, // F 7.92 + 2 · G's line 3.96 · H's remainder 2
      },
    });
    // The all-time ledger still closes, whatever month each part fell in.
    const payees = await payeeSums();
    expect(tenThousandths(revenue.toodooh_tnd + payees)).toBe(tenThousandths(revenue.total_tnd));
  });
});
