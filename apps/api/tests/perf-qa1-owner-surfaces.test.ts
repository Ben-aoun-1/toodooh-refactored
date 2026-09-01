import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '../src/auth/auth.js';
import { db, sql } from '../src/db/client.js';
import {
  campaigns,
  creatives,
  dispatchConfig,
  eventAttestations,
  events,
  type NewUser,
  proofOfPlay,
  screenhostMonthlyReports,
  screenhosts,
  screens,
  users,
} from '../src/db/schema.js';
import {
  PISTE_01_NO_EVENTS_BODY,
  PISTE_01_TITLE,
  PISTE_02_WAIT_BODY,
  PISTE_02_TITLE,
  PISTE_03_TITLE,
  PISTE_03_WAIT_BODY,
} from '../src/lib/report/pistes.js';
import { venueSlug } from '../src/lib/slug.js';
import { screenhostsRoutes } from '../src/routes/screenhosts.js';

import { resetAuthTables } from './helpers/db-test-setup.js';

// PERF-QA1 commit 1 — the owner surfaces the Mejri GTM batch adds: the reports LISTING (R1), the
// owner SPS read (R6), the owner pistes read (R5, same generator+cache as the period report), the
// playout summary (R11) and the venue slug (R3). Real Postgres; the AI pistes seam is mocked at
// the module boundary exactly like report-endpoint.test.ts.
const pistesCachedSpy = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/report/recommendations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/report/recommendations.js')>();
  return { ...actual, pistesForReportCached: pistesCachedSpy };
});

type GetSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

const buildApp = () => Fastify({ logger: false });

const mockSession = (userId: string, role = 'individual_owner', status = 'approved'): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue({
    session: {},
    user: { id: userId, role, status },
  } as unknown as GetSessionResult);
};

const mockNoSession = (): void => {
  vi.spyOn(auth.api, 'getSession').mockResolvedValue(null as unknown as GetSessionResult);
};

let seq = 0;
const seedUser = async (values: Partial<NewUser> = {}): Promise<string> => {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `pq1-${seq}@example.com`,
      contactName: `User ${seq}`,
      role: 'individual_owner',
      status: 'approved',
      ...values,
    })
    .returning();
  return u?.id ?? '';
};

const seedScreenhost = async (ownerId: string, name = 'Café Période'): Promise<string> => {
  const [s] = await db.insert(screenhosts).values({ name, ownerId }).returning();
  return s?.id ?? '';
};

/** Minimal campaign + creative pair so proof_of_play rows can exist (FKs are RESTRICT). */
/**
 * MEJ-14b — give a venue ONE real observation so its SPS is computable at all.
 *
 * An inspection is the lightest genuine history (event + attestation, no dispatch machinery), and
 * `respecte: true` leaves every variable's VALUE exactly where the empty set left it — respect was
 * already 100 by the EVENT_RESPECT_DEFAULT rule. So the score these tests assert is unchanged;
 * what changes is that it is now a MEASURED 90 rather than a 90 made of defaults.
 */
const seedInspection = async (screenhostId: string, authorId: string): Promise<void> => {
  seq += 1;
  const [ev] = await db
    .insert(events)
    .values({
      name: `PQ1 inspection ${seq}`,
      // LONG past: a recent event would surface in Piste 01's upcoming-events teaser and change
      // a copy assertion that has nothing to do with the SPS. The 90 d respect window reads the
      // ATTESTATION's created_at (fresh, below), not the event date, so this stays observable.
      kickoffAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
    })
    .returning();
  await db
    .insert(eventAttestations)
    .values({ eventId: ev?.id ?? '', screenhostId, authorId, respecte: true });
};

const seedProofChain = async (): Promise<{ campaignId: string; creativeId: string }> => {
  const advertiserId = await seedUser({ role: 'advertiser' });
  const [creative] = await db
    .insert(creatives)
    .values({
      advertiserId,
      creativeType: 'video',
      storageKey: `creatives/pq1/${seq}`,
      durationSeconds: 10,
      validationStatus: 'approved',
    })
    .returning();
  const [c] = await db
    .insert(campaigns)
    .values({
      advertiserId,
      name: `PQ1 campagne ${seq}`,
      campaignType: 'standard',
      status: 'active',
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      requestedBudget: '300',
      creativeId: creative?.id ?? null,
    })
    .returning();
  return { campaignId: c?.id ?? '', creativeId: creative?.id ?? '' };
};

const seedProof = async (
  shId: string,
  chain: { campaignId: string; creativeId: string },
  playedDurationMs: number | null,
  eventType: 'VIDEO_STARTED' | 'VIDEO_ENDED' = 'VIDEO_ENDED',
): Promise<void> => {
  const [screen] = await db
    .select({ id: screens.id })
    .from(screens)
    .where(eq(screens.screenhostId, shId))
    .limit(1);
  let screenId = screen?.id;
  if (!screenId) {
    const [s] = await db.insert(screens).values({ screenhostId: shId, name: 'PQ1 TV' }).returning();
    screenId = s?.id;
  }
  await db.insert(proofOfPlay).values({
    screenId: screenId ?? '',
    screenhostId: shId,
    campaignId: chain.campaignId,
    creativeId: chain.creativeId,
    videoIdAsSent: chain.creativeId,
    eventType,
    playedDurationMs,
  });
};

afterAll(async () => {
  // Same fixture repair as e7-reversement-settlement.test.ts: this suite runs config-less on
  // purpose (the SPS read must degrade to the code defaults), but LEAVING the singleton deleted
  // makes every later file read the fallback instead of the migration-seeded row — an invisible
  // coupling that campaigns.test.ts's lead-0 flip exposes the moment file order shifts. Put the
  // seeded row back before handing the DB on.
  await db.delete(dispatchConfig);
  await db.insert(dispatchConfig).values({
    seuilDiffusable: 1000,
    gMois: '100',
    joursActifs: 30,
    rMinEfficace: 2,
  });
  await sql.end();
});

describe('venueSlug (R3)', () => {
  it('folds diacritics and collapses separators', () => {
    expect(venueSlug('Café Période N°3')).toBe('cafe-periode-n-3');
    expect(venueSlug('  ÉTÉ à Sousse!! ')).toBe('ete-a-sousse');
  });

  it('never returns an empty segment', () => {
    expect(venueSlug('مقهى')).toBe('etablissement');
    expect(venueSlug('---')).toBe('etablissement');
  });
});

describe('PERF-QA1 owner surfaces (real Postgres)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await resetAuthTables();
    await db.delete(dispatchConfig);
    // PERF-QA2 — Piste 01 reads the NETWORK-wide event catalogue, which the auth truncate does
    // not touch: a leftover event from another suite would flip the teaser branch here.
    await db.delete(events);
    pistesCachedSpy.mockReset();
    pistesCachedSpy.mockResolvedValue(null);
    app = buildApp();
    await app.register(screenhostsRoutes);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const get = (url: string) => app.inject({ method: 'GET', url });

  describe('GET /api/screenhosts/:id/reports (R1 — the month authority listing)', () => {
    it('requires authentication (401)', async () => {
      mockNoSession();
      expect(
        (await get('/api/screenhosts/11111111-1111-4111-8111-111111111111/reports')).statusCode,
      ).toBe(401);
    });

    it("404 on a FOREIGN screenhost (someone else's venue is indistinguishable from a missing one)", async () => {
      const me = await seedUser();
      const other = await seedUser();
      const foreign = await seedScreenhost(other);
      mockSession(me);
      expect((await get(`/api/screenhosts/${foreign}/reports`)).statusCode).toBe(404);
    });

    it('lists stored reports newest-first with the REAL generated_at (never a derived date)', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      mockSession(me);
      await db.insert(screenhostMonthlyReports).values([
        {
          screenhostId: sh,
          month: '2026-05',
          storageKey: `reports/${sh}/2026-05.pdf`,
          generatedAt: new Date('2026-06-01T05:00:00Z'),
        },
        {
          screenhostId: sh,
          month: '2026-07',
          storageKey: `reports/${sh}/2026-07.pdf`,
          generatedAt: new Date('2026-08-01T06:30:00Z'),
        },
        {
          screenhostId: sh,
          month: '2026-06',
          storageKey: `reports/${sh}/2026-06.pdf`,
          generatedAt: new Date('2026-07-02T09:15:00Z'),
        },
      ]);
      const res = await get(`/api/screenhosts/${sh}/reports`);
      expect(res.statusCode).toBe(200);
      expect(res.json<{ reports: { month: string; generated_at: string }[] }>()).toEqual({
        reports: [
          { month: '2026-07', generated_at: '2026-08-01T06:30:00.000Z' },
          { month: '2026-06', generated_at: '2026-07-02T09:15:00.000Z' },
          { month: '2026-05', generated_at: '2026-06-01T05:00:00.000Z' },
        ],
      });
    });

    it('a venue with no stored reports lists empty (the honest empty state)', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      mockSession(me);
      const res = await get(`/api/screenhosts/${sh}/reports`);
      expect(res.statusCode).toBe(200);
      expect(res.json<{ reports: unknown[] }>().reports).toEqual([]);
    });
  });

  describe('GET /api/screenhosts/:id/sps (R6 — owner SPS, weights from config)', () => {
    interface SpsVariableWire {
      value: number;
      weight: number;
    }
    interface SpsBody {
      sps: number | null;
      variables: {
        acceptation: SpsVariableWire;
        respect_evenements: SpsVariableWire;
        activite: SpsVariableWire;
        remplissage: SpsVariableWire;
      } | null;
    }

    it('requires authentication (401) and owner scope (404 on foreign)', async () => {
      mockNoSession();
      expect(
        (await get('/api/screenhosts/11111111-1111-4111-8111-111111111111/sps')).statusCode,
      ).toBe(401);
      const me = await seedUser();
      const other = await seedUser();
      const foreign = await seedScreenhost(other);
      mockSession(me);
      expect((await get(`/api/screenhosts/${foreign}/sps`)).statusCode).toBe(404);
    });

    it('PERF-R1: carries as_of (Tunis today) so the page can label the live score « au <date> »', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      await seedInspection(sh, me); // MEJ-14b — as_of is about the DATE, so keep the score shown
      mockSession(me);
      const body = (await get(`/api/screenhosts/${sh}/sps`)).json<SpsBody & { as_of?: string }>();
      const tunisToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(
        new Date(),
      );
      expect(body.as_of).toBe(tunisToday);
    });

    it('serves the live score with the DEFAULT config weights 40/30/20/10 when no config row exists', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      await seedInspection(sh, me); // MEJ-14b — weights only reach the wire when a score is shown
      mockSession(me);
      const res = await get(`/api/screenhosts/${sh}/sps`);
      expect(res.statusCode).toBe(200);
      const body = res.json<SpsBody>();
      expect(typeof body.sps).toBe('number');
      expect(body.variables?.acceptation.weight).toBe(40);
      expect(body.variables?.respect_evenements.weight).toBe(30);
      expect(body.variables?.activite.weight).toBe(20);
      expect(body.variables?.remplissage.weight).toBe(10);
      expect(typeof body.variables?.acceptation.value).toBe('number');
      expect(typeof body.variables?.respect_evenements.value).toBe('number');
      expect(typeof body.variables?.activite.value).toBe('number');
      expect(typeof body.variables?.remplissage.value).toBe('number');
    });

    // MEJ-14b / SPS-D1 (Mejri, ruled through the operator 2026-09-01) — a never-connected venue
    // scored 90/100 and outranked venues live for months: three of the four variables answer 100
    // to an empty set (no decisions is not a refusal, no inspection is not a breach, nothing
    // scheduled is not a failure) and only remplissage falls to 0. Show « À venir » instead —
    // never 0, which would read as a verdict.
    it('MEJ-14b: a venue with NO history serves nulls so the page reads « À venir », never 90', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      mockSession(me);
      const res = await get(`/api/screenhosts/${sh}/sps`);
      expect(res.statusCode).toBe(200);
      const body = res.json<SpsBody & { as_of?: string }>();
      expect(body.sps).toBeNull();
      expect(body.variables).toBeNull();
      // as_of still answers: the page labels its wait-state, it does not fail.
      expect(typeof body.as_of).toBe('string');
    });

    it('MEJ-14b: ONE real observation is enough — the score comes back, unchanged at 90', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      mockSession(me);
      expect((await get(`/api/screenhosts/${sh}/sps`)).json<SpsBody>().sps).toBeNull();

      // A single inspection is history on ONE variable, which is the whole predicate.
      await seedInspection(sh, me);
      const body = (await get(`/api/screenhosts/${sh}/sps`)).json<SpsBody>();
      // The SCORE ITSELF is untouched by this lane — 90 is still 90, it is merely now measured.
      // (Dispatch ordering reads that same 90 and is deliberately NOT changed here: SPS-DISPATCH1.)
      expect(body.sps).toBe(90);
      expect(body.variables?.respect_evenements.value).toBe(100);
    });

    it('weights come from the CONFIG row when one exists — never hardcoded (pins R6)', async () => {
      await db.insert(dispatchConfig).values({
        seuilDiffusable: 1000,
        gMois: '100',
        joursActifs: 30,
        rMinEfficace: 2,
        spsWeightAcceptation: '35.00',
        spsWeightRespectEvenements: '25.00',
        spsWeightActivite: '25.00',
        spsWeightRemplissage: '15.00',
      });
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      await seedInspection(sh, me); // MEJ-14b — idem
      mockSession(me);
      const body = (await get(`/api/screenhosts/${sh}/sps`)).json<SpsBody>();
      expect(body.variables?.acceptation.weight).toBe(35);
      expect(body.variables?.respect_evenements.weight).toBe(25);
      expect(body.variables?.activite.weight).toBe(25);
      expect(body.variables?.remplissage.weight).toBe(15);
    });
  });

  describe('GET /api/screenhosts/:id/pistes (R5 — the page mirrors the PDF)', () => {
    interface PistesBody {
      pistes: { num: string; title: string; body: string; pending: boolean }[];
    }
    const range = 'from=2026-06-01&to=2026-06-30';

    it('requires authentication (401) and owner scope (404 on foreign)', async () => {
      mockNoSession();
      expect(
        (await get(`/api/screenhosts/11111111-1111-4111-8111-111111111111/pistes?${range}`))
          .statusCode,
      ).toBe(401);
      const me = await seedUser();
      const other = await seedUser();
      const foreign = await seedScreenhost(other);
      mockSession(me);
      expect((await get(`/api/screenhosts/${foreign}/pistes?${range}`)).statusCode).toBe(404);
    });

    it('an over-400-day range is the same DISTINCT 400 RANGE_TOO_WIDE as the report route (R4)', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      mockSession(me);
      const res = await get(`/api/screenhosts/${sh}/pistes?from=2020-01-01&to=2026-08-05`);
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe('RANGE_TOO_WIDE');
    });

    it('serves the generator BYTE-EQUAL when the AI seam yields nothing (single home)', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      // MEJ-14b — this venue needs ONE real observation, or Piste 03 is now (correctly) a wait
      // state and there is no generator output to compare. Before the ruling this test asserted
      // « votre score de priorité est de 90/100 » for a BARE venue: it documented the defect as
      // intended behaviour. The inspection leaves every value where it was (respect was already
      // 100), so the assertions below are unchanged — the 90 is simply measured now.
      await seedInspection(sh, me);
      mockSession(me);
      const res = await get(`/api/screenhosts/${sh}/pistes?${range}`);
      expect(res.statusCode).toBe(200);
      // Nothing in the event catalogue → the honest no-events teaser; no AI body → the generic
      // angles-morts copy; a computable SPS (default weights, nothing engaged → 40+30+20+0 = 90)
      // → the real analysis, naming remplissage as the weighted weak point.
      const body = res.json<PistesBody>();
      expect(body.pistes.map((p) => [p.num, p.title, p.pending])).toEqual([
        ['01', PISTE_01_TITLE, false],
        ['02', PISTE_02_TITLE, true], // US-P.10 — no analysis yet → the « À venir » wait state
        ['03', PISTE_03_TITLE, false],
      ]);
      expect(body.pistes[0]?.body).toBe(PISTE_01_NO_EVENTS_BODY);
      expect(body.pistes[1]?.body).toBe(PISTE_02_WAIT_BODY);
      expect(body.pistes[2]?.body).toContain('Votre score de priorité est de 90/100.');
      expect(body.pistes[2]?.body).toContain(
        'Point faible : Taux de remplissage (0/100, poids 10 %).',
      );
    });

    it('goes through the SAME cache-wrapped seam as the period report, keyed venue × period', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      await seedInspection(sh, me); // MEJ-14b — idem: Piste 03 needs a computable score to exist
      mockSession(me);
      pistesCachedSpy.mockResolvedValue('Corps IA du créneau faible.');
      const res = await get(`/api/screenhosts/${sh}/pistes?${range}`);
      expect(res.statusCode).toBe(200);
      const body = res.json<PistesBody>();
      expect(body.pistes[1]?.body).toBe('Corps IA du créneau faible.');
      expect(body.pistes[1]?.title).toBe(PISTE_02_TITLE); // the title stays FIXED either way
      expect(pistesCachedSpy).toHaveBeenCalledTimes(1);
      expect(pistesCachedSpy.mock.calls[0]?.[0]).toBe(sh);
      expect(pistesCachedSpy.mock.calls[0]?.[1]?.range).toEqual({
        from: '2026-06-01',
        to: '2026-06-30',
      });
      // …and the ai body only ever displaces Piste 02 — 01/03 stay generator-authored.
      expect(body.pistes[0]?.body).toBe(PISTE_01_NO_EVENTS_BODY);
      expect(body.pistes[2]?.body).toContain('Votre score de priorité est de');
    });

    // MEJ-14b — the ruling's real teeth: a hidden score on the page paired with « votre score est
    // de 90/100 » in the piste text would be WORSE than showing the 90 everywhere. Piste 03 reads
    // the same SPS block the page and the PDF read, so one predicate governs all three.
    it('MEJ-14b: a no-history venue gets the Piste 03 WAIT body — never « votre score est de 90/100 »', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me); // deliberately bare: no observation on any variable
      mockSession(me);
      const body = (await get(`/api/screenhosts/${sh}/pistes?${range}`)).json<PistesBody>();
      expect(body.pistes[2]?.pending).toBe(true);
      expect(body.pistes[2]?.body).toBe(PISTE_03_WAIT_BODY);
      expect(body.pistes[2]?.body).not.toContain('90');
      expect(body.pistes[2]?.title).toBe(PISTE_03_TITLE); // the title is fixed either way
    });

    it('a pistes-seam failure never fails the response — 200 with the generic body', async () => {
      const me = await seedUser();
      const sh = await seedScreenhost(me);
      mockSession(me);
      pistesCachedSpy.mockRejectedValue(new Error('anthropic exploded'));
      const res = await get(`/api/screenhosts/${sh}/pistes?${range}`);
      expect(res.statusCode).toBe(200);
      expect(res.json<PistesBody>().pistes[1]?.body).toBe(PISTE_02_WAIT_BODY);
    });
  });

  describe('GET /api/screenhosts/playout-summary (R11 — Durée totale, all-time)', () => {
    it('requires authentication (401)', async () => {
      mockNoSession();
      expect((await get('/api/screenhosts/playout-summary')).statusCode).toBe(401);
    });

    it('an owner with no proofs reads 0 (the honest empty state)', async () => {
      const me = await seedUser();
      await seedScreenhost(me);
      mockSession(me);
      const res = await get('/api/screenhosts/playout-summary');
      expect(res.statusCode).toBe(200);
      expect(res.json<{ total_played_ms: number }>().total_played_ms).toBe(0);
    });

    it('sums played_duration_ms over VIDEO_ENDED across MY venues only', async () => {
      const me = await seedUser();
      const mine = await seedScreenhost(me, 'Mon Café');
      const other = await seedUser();
      const foreign = await seedScreenhost(other, 'Autre Café');
      const chain = await seedProofChain();
      await seedProof(mine, chain, 1500);
      await seedProof(mine, chain, 2500);
      await seedProof(mine, chain, null, 'VIDEO_STARTED'); // no duration — never counted
      await seedProof(foreign, chain, 9999); // someone else's venue — never bleeds in
      mockSession(me);
      const res = await get('/api/screenhosts/playout-summary');
      expect(res.statusCode).toBe(200);
      expect(res.json<{ total_played_ms: number }>().total_played_ms).toBe(4000);
    });
  });
});
