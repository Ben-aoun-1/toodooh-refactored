import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  TEAM_RENAMES,
  kickoffInstant,
  loadCatalogueData,
  seedCatalogue,
} from '../scripts/evt-cat3-seed-catalogue.js';
import { db, sql } from '../src/db/client.js';
import { eventMatches, events, teams } from '../src/db/schema.js';

// EVT-CAT3 — the real catalogue from Youssef's HTML, loaded by a dry-run-by-default script
// (rulings 2026-10-12: Q1 A time « à confirmer », Q2 A rename the prod test teams, Q3 A existing
// events untouched, Q4 A no Ramadan card). Real Postgres: the dry-run writes nothing, --execute
// writes it all once, and a re-run writes nothing more.

const data = loadCatalogueData();

const reset = async (): Promise<void> => {
  await db.delete(eventMatches);
  await db.delete(events);
  await db.delete(teams);
};

beforeEach(reset);
afterAll(async () => {
  await reset();
  await sql.end();
});

describe('the catalogue data (extracted from the HTML)', () => {
  it('holds the 24 events and 36 matches, every team code resolving', () => {
    expect(data.events).toHaveLength(24);
    expect(data.events.flatMap((e) => e.matches)).toHaveLength(36);
    for (const e of data.events) {
      for (const m of e.matches) {
        expect(data.teams[m.home]).toBeDefined();
        if (m.away !== null) expect(data.teams[m.away]).toBeDefined();
      }
    }
    expect(Object.keys(TEAM_RENAMES)).toEqual([
      'FC Barcelone',
      'Club Africain',
      'Espérance de Tunis',
    ]);
  });

  it('reads kickoffs in Tunis time (UTC+1)', () => {
    expect(kickoffInstant({ day: '2026-11-03', kickoff_tunis: '21:00' }).toISOString()).toBe(
      '2026-11-03T20:00:00.000Z',
    );
  });
});

describe('seedCatalogue', () => {
  it('the dry-run reports the full plan and writes NOTHING', async () => {
    const report = await seedCatalogue(data, { execute: false });
    expect(report.events.created).toHaveLength(24);
    expect(report.teams.created).toHaveLength(Object.keys(data.teams).length);
    expect(await db.select().from(events)).toHaveLength(0);
    expect(await db.select().from(teams)).toHaveLength(0);
  });

  it('--execute loads every team, event and match; a re-run creates nothing more', async () => {
    await seedCatalogue(data, { execute: true });
    expect(await db.select().from(events)).toHaveLength(24);
    expect(await db.select().from(eventMatches)).toHaveLength(36);
    const again = await seedCatalogue(data, { execute: true });
    expect(again.events.created).toEqual([]);
    expect(again.events.skipped).toHaveLength(24);
    expect(again.teams.created).toEqual([]);
    expect(await db.select().from(events)).toHaveLength(24);
  });

  it('Q2 A — renames the prod test teams to the HTML names and gives them the HTML colours', async () => {
    const [est] = await db.insert(teams).values({ name: 'EST' }).returning();
    await db.insert(teams).values([{ name: 'CA' }, { name: 'Barcelona' }, { name: 'Arsenal' }]);
    const report = await seedCatalogue(data, { execute: true });
    expect(report.teams.renamed.sort()).toEqual([
      'Barcelona → FC Barcelone',
      'CA → Club Africain',
      'EST → Espérance de Tunis',
    ]);
    expect(report.teams.recoloured).toContain('Arsenal');
    const [renamed] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, est?.id ?? ''));
    expect(renamed).toMatchObject({
      name: 'Espérance de Tunis',
      colorMain: '#C8001E',
      colorSecond: '#F7D117',
    });
    expect(await db.select().from(teams).where(eq(teams.name, 'EST'))).toHaveLength(0);
  });

  it('Q1 A — a match without a time is « à confirmer » at a provisional 20h00, a confirmed one is exact', async () => {
    await seedCatalogue(data, { execute: true });
    const [milan] = await db.select().from(events).where(eq(events.name, 'AC Milan - Inter Milan'));
    expect(milan).toMatchObject({ timeTbc: true, dateTbc: false, dateLabel: null });
    expect(milan?.kickoffAt.toISOString()).toBe('2026-11-01T19:00:00.000Z');
    const [liv] = await db.select().from(events).where(eq(events.name, 'Liverpool - Arsenal'));
    expect(liv).toMatchObject({ timeTbc: false, dateTbc: false, competition: 'Premier League' });
    expect(liv?.kickoffAt.toISOString()).toBe('2026-11-01T16:30:00.000Z');
    expect(liv?.endsAt.toISOString()).toBe('2026-11-01T18:30:00.000Z');
  });

  it('the CAF dates: unconfirmed date with its wording, qualification pending, opponent empty', async () => {
    await seedCatalogue(data, { execute: true });
    const caf = (await db.select().from(events)).filter((e) =>
      e.name.startsWith('Espérance de Tunis - '),
    );
    expect(caf).toHaveLength(3);
    for (const e of caf) {
      expect(e).toMatchObject({ dateTbc: true, timeTbc: true, qualificationPending: true });
      expect(e.dateLabel).toMatch(/^Entre le /);
      const matches = await db.select().from(eventMatches).where(eq(eventMatches.eventId, e.id));
      expect(matches).toHaveLength(1);
      expect(matches[0]?.awayTeamId).toBeNull();
    }
  });

  it('a Champions League night carries its three matches in order; pinned cards are featured', async () => {
    await seedCatalogue(data, { execute: true });
    const [night] = await db
      .select()
      .from(events)
      .where(eq(events.name, 'Soirée Ligue des champions du mercredi 9 décembre 2026'));
    expect(night?.featured).toBe('pinned');
    const matches = await db
      .select()
      .from(eventMatches)
      .where(eq(eventMatches.eventId, night?.id ?? ''));
    expect(matches.map((m) => m.position).sort()).toEqual([0, 1, 2]);
    const pinned = (await db.select().from(events)).filter((e) => e.featured === 'pinned');
    expect(pinned.map((e) => e.name).sort()).toEqual([
      'Club Africain - Espérance de Tunis',
      'Libye - Tunisie',
      'Soirée Ligue des champions du mercredi 9 décembre 2026',
    ]);
  });
});
