import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  type NewUser,
  businessSectors,
  campaignDispatchAllocation,
  campaignDispatchPlan,
  campaigns,
  notifications,
  screenhosts,
  users,
} from '../src/db/schema.js';
import { plusCalendarDays } from '../src/lib/campaign-dates.js';
import { adminHostDecisionRoutes } from '../src/routes/admin-host-decisions.js';

import { resetAuthTables } from './helpers/db-test-setup.js';
import { seedInstalledScreen } from './helpers/installed-screen.js';

// Mariem 13/11 point 1 — the Admin answers a Host's proposal on the Host's behalf: the owner's own
// transaction (definitive refusal), and the Host told in-app.

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;
const mockSession = (userId: string, role = 'superadmin'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status: 'approved' },
  } as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `ahd-${seq}@example.com`,
      contactName: `AHD ${seq}`,
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedProposal = async () => {
  const [sector] = await db
    .select({ id: businessSectors.id })
    .from(businessSectors)
    .where(eq(businessSectors.audience, 'owner'))
    .limit(1);
  const ownerId = await seedUser({ role: 'individual_owner', businessName: 'Café du Test' });
  const [sh] = await db
    .insert(screenhosts)
    .values({
      name: `AHD Venue ${seq}`,
      ownerId,
      businessSectorId: sector?.id ?? '',
      class: 'premium' as never,
      sps: '80',
      openingHour: 8,
      closingHour: 18,
      broadcastCapacity: 4,
    })
    .returning();
  await seedInstalledScreen(sh?.id ?? '');
  const day = plusCalendarDays(new Date().toISOString().slice(0, 10), 10);
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId: await seedUser({ role: 'advertiser' }),
      name: 'Campagne Admin',
      campaignType: 'standard',
      status: 'upcoming',
      startDate: day,
      endDate: day,
    })
    .returning();
  const [plan] = await db
    .insert(campaignDispatchPlan)
    .values({
      campaignId: c?.id ?? '',
      iCible: 10_000,
      cpm: '10',
      sSpotSeconds: 10,
      tTierCoef: '0.6',
      seuilDiffusable: 2000,
      sMin: '20',
      gJour: '3.3333',
      fMaxSeconds: 300,
      rMinEfficace: 2,
      couvert: 10_000,
      nMin: 1,
      nMax: 10,
      nRetenus: 1,
    })
    .returning();
  const [alloc] = await db
    .insert(campaignDispatchAllocation)
    .values({
      planId: plan?.id ?? '',
      screenhostId: sh?.id ?? '',
      iiPotentiel: 6000,
      rI: 10,
      revenuPrevisionnel: '60',
      creneaux: [{ date: day, hour: 10, reps: 10, impressions: 1000 }],
      statutAcceptation: 'EN_ATTENTE',
    })
    .returning();
  return { ownerId, campaignId: c?.id ?? '', allocationId: alloc?.id ?? '', venue: sh?.name };
};

describe('Admin — answer a proposal on behalf of the Host (real Postgres)', () => {
  const app = Fastify({ logger: false });
  beforeEach(async () => {
    await resetAuthTables();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await app.close();
    await sql.end();
  });

  it('lists the campaign’s Hosts, accepts for one, tells the Host; a refusal stays definitive', async () => {
    await app.register(adminHostDecisionRoutes);
    await app.ready();
    const p = await seedProposal();
    mockSession(await seedUser({ role: 'superadmin' }));

    const list = await app.inject({
      method: 'GET',
      url: `/api/admin/campaigns/${p.campaignId}/host-decisions`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      kind: 'campaign',
      hosts: [
        {
          kind: 'campaign',
          allocation_id: p.allocationId,
          screenhost_name: p.venue,
          owner_label: 'Café du Test',
          statut: 'EN_ATTENTE',
        },
      ],
    });

    const refused = await app.inject({
      method: 'POST',
      url: `/api/admin/host-decisions/campaign/${p.allocationId}/refuse`,
    });
    expect(refused.statusCode).toBe(200);
    expect(refused.json()).toMatchObject({ statut: 'REFUSE', changed: true });
    const [after] = await db
      .select()
      .from(campaignDispatchAllocation)
      .where(eq(campaignDispatchAllocation.id, p.allocationId));
    expect(after?.statutAcceptation).toBe('REFUSE');
    const notes = await db.select().from(notifications).where(eq(notifications.userId, p.ownerId));
    expect(notes).toEqual([
      expect.objectContaining({
        type: 'admin_decided_for_host',
        title: 'Campagne refusée pour vous',
        campaignId: p.campaignId,
      }),
    ]);

    // The Host's own rule: a refusal is definitive, even for the Admin.
    const again = await app.inject({
      method: 'POST',
      url: `/api/admin/host-decisions/campaign/${p.allocationId}/accept`,
    });
    expect(again.statusCode).toBe(409);
  });

  it('accepts for the Host; an unknown allocation is a 404; non-admins are refused', async () => {
    const p = await seedProposal();
    mockSession(await seedUser({ role: 'superadmin' }));
    const ok = await app.inject({
      method: 'POST',
      url: `/api/admin/host-decisions/campaign/${p.allocationId}/accept`,
    });
    expect(ok.json()).toMatchObject({ statut: 'ACCEPTE', changed: true });
    const missing = await app.inject({
      method: 'POST',
      url: `/api/admin/host-decisions/event/${p.allocationId}/accept`,
    });
    expect(missing.statusCode).toBe(404);
    vi.restoreAllMocks();
    mockSession(p.ownerId, 'individual_owner');
    const owner = await app.inject({
      method: 'POST',
      url: `/api/admin/host-decisions/campaign/${p.allocationId}/refuse`,
    });
    expect(owner.statusCode).toBe(403);
  });
});
