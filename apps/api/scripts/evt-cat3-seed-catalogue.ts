import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { and, eq, sql as dsql } from 'drizzle-orm';

import { db, sql } from '../src/db/client.js';
import { eventMatches, events, teams } from '../src/db/schema.js';

// EVT-CAT3 (operator 2026-10-12) — load the REAL events catalogue Youssef's « Toodooh Page
// événements.html » carries (scripts/data/evt-cat3-catalogue.json, extracted verbatim from its
// T / EV arrays) into the EVT-CAT2 tables. DRY-RUN BY DEFAULT; --execute writes, in ONE
// transaction. Idempotent: a re-run creates nothing it already created.
//
// Rulings 2026-10-12:
//   Q1 A — a match without a kickoff time is listed « à confirmer » (time_tbc): visible, not
//          positionable until an admin sets the time. Its provisional kickoff is 20h00 Tunis.
//          « Jour à confirmer » and the CAF « sous réserve de qualification » dates are date_tbc
//          and keep the HTML's own wording as date_label.
//   Q2 A — the prod teams « Barcelona », « CA » and « EST » are RENAMED to the HTML names (the
//          test events that use them keep working); every team takes the HTML colours.
//   Q3 A — the existing (test) events are not touched.
//   Q4 A — the seasonal « Soirées du Ramadan 2027 » card is not loaded.
//
// Mapping: a match ends 2 h after kickoff (the HTML's window = kickoff −1 h → kickoff +3 h, i.e.
// the EVT-PLAY1 reservation end + 1 h); type sport, category Football, source official; pinned
// cards → featured 'pinned'. Teams match on lower(name) (the teams_name_uq index); an event is
// « already loaded » when one with the same name and kickoff exists.
//
// Usage (prod):
//   sudo docker compose -f /srv/toodooh/docker-compose.prod.yml exec api \
//     node_modules/.bin/tsx scripts/evt-cat3-seed-catalogue.ts             # dry-run
//   … the same command … --execute                                        # write

export interface CatalogueTeam {
  name: string;
  is_national: boolean;
  color_main: string;
  color_second: string;
  color_crowd: string | null;
}

export interface CatalogueEvent {
  name: string;
  competition: string;
  round: string;
  day: string; // YYYY-MM-DD, Tunis
  kickoff_tunis: string; // HH:MM — provisional when time_tbc
  time_tbc: boolean;
  date_tbc: boolean;
  qualification_pending: boolean;
  date_label: string;
  featured: 'pinned' | null;
  matches: { home: string; away: string | null }[];
}

export interface CatalogueData {
  teams: Record<string, CatalogueTeam>;
  events: CatalogueEvent[];
}

/** Q2 A — the prod test teams the HTML names replace (new name → the name it renames). */
export const TEAM_RENAMES: Readonly<Record<string, string>> = {
  'FC Barcelone': 'Barcelona',
  'Club Africain': 'CA',
  'Espérance de Tunis': 'EST',
};

const MATCH_DURATION_MS = 2 * 60 * 60 * 1000;

/** The kickoff instant: Tunis is UTC+1 all year (no DST since 2009). */
export const kickoffInstant = (e: Pick<CatalogueEvent, 'day' | 'kickoff_tunis'>): Date =>
  new Date(`${e.day}T${e.kickoff_tunis}:00+01:00`);

export const loadCatalogueData = (): CatalogueData =>
  JSON.parse(
    readFileSync(new URL('./data/evt-cat3-catalogue.json', import.meta.url), 'utf8'),
  ) as CatalogueData;

export interface SeedReport {
  teams: { created: string[]; renamed: string[]; recoloured: string[]; unchanged: string[] };
  events: { created: string[]; skipped: string[] };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const findTeam = async (tx: Tx, name: string) =>
  (
    await tx
      .select()
      .from(teams)
      .where(eq(dsql`lower(${teams.name})`, name.toLowerCase()))
      .limit(1)
  )[0];

class DryRunRollback extends Error {}

/**
 * Plan (dry-run) or apply (execute) the catalogue. The dry-run runs the SAME code inside a
 * transaction it rolls back, so the report it prints is exactly what --execute would write.
 */
export async function seedCatalogue(
  data: CatalogueData,
  opts: { execute: boolean },
): Promise<SeedReport> {
  const report: SeedReport = {
    teams: { created: [], renamed: [], recoloured: [], unchanged: [] },
    events: { created: [], skipped: [] },
  };
  try {
    await db.transaction(async (tx) => {
      const teamIds = new Map<string, string>();
      for (const [code, t] of Object.entries(data.teams)) {
        const colours = {
          isNational: t.is_national,
          colorMain: t.color_main,
          colorSecond: t.color_second,
          colorCrowd: t.color_crowd,
        };
        const existing = await findTeam(tx, t.name);
        if (existing) {
          const same =
            existing.isNational === colours.isNational &&
            existing.colorMain === colours.colorMain &&
            existing.colorSecond === colours.colorSecond &&
            existing.colorCrowd === colours.colorCrowd;
          if (!same) await tx.update(teams).set(colours).where(eq(teams.id, existing.id));
          (same ? report.teams.unchanged : report.teams.recoloured).push(t.name);
          teamIds.set(code, existing.id);
          continue;
        }
        const alias = TEAM_RENAMES[t.name];
        const renamed = alias ? await findTeam(tx, alias) : undefined;
        if (renamed) {
          await tx
            .update(teams)
            .set({ name: t.name, ...colours })
            .where(eq(teams.id, renamed.id));
          report.teams.renamed.push(`${renamed.name} → ${t.name}`);
          teamIds.set(code, renamed.id);
          continue;
        }
        const [created] = await tx
          .insert(teams)
          .values({ name: t.name, ...colours })
          .returning({ id: teams.id });
        if (!created) throw new Error(`team insert returned nothing: ${t.name}`);
        report.teams.created.push(t.name);
        teamIds.set(code, created.id);
      }

      for (const e of data.events) {
        const kickoffAt = kickoffInstant(e);
        const label = `${e.day} ${e.time_tbc ? '(heure à confirmer)' : e.kickoff_tunis} · ${e.name}`;
        const [already] = await tx
          .select({ id: events.id })
          .from(events)
          .where(and(eq(events.name, e.name), eq(events.kickoffAt, kickoffAt)))
          .limit(1);
        if (already) {
          report.events.skipped.push(label);
          continue;
        }
        const [row] = await tx
          .insert(events)
          .values({
            name: e.name,
            type: 'sport',
            category: 'Football',
            kickoffAt,
            endsAt: new Date(kickoffAt.getTime() + MATCH_DURATION_MS),
            source: 'official',
            competition: e.competition,
            round: e.round,
            featured: e.featured,
            dateTbc: e.date_tbc,
            timeTbc: e.time_tbc,
            qualificationPending: e.qualification_pending,
            // A confirmed date is worded from kickoff_at by the catalogue (and follows an admin
            // edit); an unconfirmed one keeps the HTML's own wording (« Entre le 27 et le 29 … »).
            dateLabel: e.date_tbc ? e.date_label : null,
          })
          .returning({ id: events.id });
        if (!row) throw new Error(`event insert returned nothing: ${e.name}`);
        await tx.insert(eventMatches).values(
          e.matches.map((m, position) => {
            const home = teamIds.get(m.home);
            if (!home) throw new Error(`unknown team code ${m.home} in « ${e.name} »`);
            const away = m.away === null ? null : teamIds.get(m.away);
            if (away === undefined) throw new Error(`unknown team code ${String(m.away)}`);
            return { eventId: row.id, position, homeTeamId: home, awayTeamId: away };
          }),
        );
        report.events.created.push(label);
      }
      if (!opts.execute) throw new DryRunRollback();
    });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }
  return report;
}

const run = async (argv: string[]): Promise<void> => {
  const execute = argv.includes('--execute');
  const report = await seedCatalogue(loadCatalogueData(), { execute });
  const section = (title: string, items: string[]): string =>
    `${title} (${items.length})${items.map((i) => `\n  ${i}`).join('')}`;
  process.stdout.write(
    [
      execute ? 'EXECUTED' : 'DRY-RUN (nothing written — pass --execute)',
      section('teams created', report.teams.created),
      section('teams renamed', report.teams.renamed),
      section('teams recoloured', report.teams.recoloured),
      section('teams unchanged', report.teams.unchanged),
      section('events created', report.events.created),
      section('events already loaded', report.events.skipped),
    ].join('\n') + '\n',
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run(process.argv.slice(2))
    .catch((err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
      process.exitCode = 1;
    })
    .finally(() => void sql.end());
}
