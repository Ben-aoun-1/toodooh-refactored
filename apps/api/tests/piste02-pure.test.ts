import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ReportData } from '../src/lib/report/assemble.js';
import { overlapsRamadan, saisonOf } from '../src/lib/report/piste02/calendar.js';
import { type Piste02Output, checkPiste02 } from '../src/lib/report/piste02/checks.js';
import {
  INSUFFICIENT_BODY,
  type Piste02Input,
  type PlanArgs,
  type VenueFacts,
  measuredHourlyCells,
  planPiste02,
} from '../src/lib/report/piste02/input.js';
import { PISTE_02_SYSTEM_PROMPT, piste02UserMessage } from '../src/lib/report/piste02/prompt.js';
import { referentielBlock, referentielCategoryFor } from '../src/lib/report/piste02/referentiel.js';

// PISTES-V2 — the pure halves of the Piste 02 generator (docs/specs/piste-02-angles-morts.md):
// the référentiel, the calendar, the input contract + mode decision (§2/§8) and the post-checks
// (§9). The DB seam is pinned in piste02-store.test.ts, the model call in piste02-generate.test.ts.

// heatSlots: two half-hour columns per hour, 10h → 13h (slots 20…25).
const SLOTS = [20, 21, 22, 23, 24, 25];
const row = (values: number[]): number[] => values;
const measuredRow = (): ('measured' | 'backup' | 'none')[] => SLOTS.map(() => 'measured');

const heat = (
  values: number[][] = Array.from({ length: 7 }, () => row([10, 20, 40, 40, 5, 5])),
  kinds: ('measured' | 'backup' | 'none')[][] = Array.from({ length: 7 }, measuredRow),
): Pick<ReportData, 'heatSlots' | 'heatValues' | 'heatKinds'> => ({
  heatSlots: SLOTS,
  heatValues: values,
  heatKinds: kinds,
});

const facts = (over: Partial<VenueFacts> = {}): VenueFacts => ({
  venueName: 'Café Le Palmier',
  sectorName: 'Café',
  venueClass: 'moyen',
  zoneName: 'El Ghazela',
  city: 'Ariana',
  governorateName: 'Ariana',
  openingHour: 10,
  closingHour: 13,
  closures: ['2026-06-14'],
  ...over,
});

const args = (over: Partial<PlanArgs> = {}): PlanArgs => ({
  month: '2026-06',
  data: {
    range: { from: '2026-06-01', to: '2026-06-30' },
    kpis: {
      global: 1100,
      perDay: 40,
      perHour: 13,
      peak: null,
      measuredDays: 28,
      estimatedPct: 6,
    },
    ...heat(),
  },
  facts: facts(),
  previousGlobal: 1000,
  history: { familles: ['B'], titres: ['Réveillez vos matinées de semaine'], creneaux: [] },
  firstReport: false,
  ...over,
});

const generated = (over: Partial<PlanArgs> = {}) => {
  const plan = planPiste02(args(over));
  if (plan.kind !== 'generate') throw new Error(`expected generate, got ${plan.kind}`);
  return plan;
};

describe('the référentiel (spec §6)', () => {
  it('maps the five venue sectors in prod, and nothing else', () => {
    expect(referentielCategoryFor('Café')?.categorie).toBe('Cafés');
    expect(referentielCategoryFor('Resto')?.categorie).toBe('Restaurants / bars');
    expect(referentielCategoryFor('Resto/Bar')).toEqual({
      categorie: 'Restaurants / bars',
      sousCategorie: 'Bar',
    });
    expect(referentielCategoryFor('Salle de sport')?.categorie).toBe('Salles de sport');
    expect(referentielCategoryFor('Espace de loisir')?.categorie).toBe('Espaces de loisirs');
    expect(referentielCategoryFor('Banque, assurance et finance')).toBeNull();
    expect(referentielCategoryFor(null)).toBeNull();
  });

  it("sends ONE category's block: the eight families, its levers and its bans — never another's", () => {
    const block = referentielBlock('Cafés');
    for (const code of ['A ·', 'B ·', 'C ·', 'D ·', 'E ·', 'F ·', 'G ·', 'H ·']) {
      expect(block).toContain(code);
    }
    expect(block).toContain('Leviers admissibles · Cafés');
    expect(block).toContain("toute référence à l'alcool sauf `service_alcool: true`");
    expect(block).not.toContain('Salles de sport');
    expect(block).not.toContain('nutritionnel');
  });
});

describe('the calendar context', () => {
  it('flags a month overlapping a Ramadan of the table', () => {
    expect(overlapsRamadan('2026-03-01', '2026-03-31')).toBe(true);
    expect(overlapsRamadan('2026-02-01', '2026-02-28')).toBe(true);
    expect(overlapsRamadan('2026-06-01', '2026-06-30')).toBe(false);
  });

  it('derives the season from the month', () => {
    expect(saisonOf('2026-01-01')).toBe('hiver');
    expect(saisonOf('2026-04-01')).toBe('printemps');
    expect(saisonOf('2026-07-01')).toBe('ete');
    expect(saisonOf('2026-10-01')).toBe('automne');
  });
});

describe('the input contract (spec §2)', () => {
  it('folds the measured half-hours into hourly means, lundi first', () => {
    const cells = measuredHourlyCells(heat());
    expect(cells.slice(0, 3)).toEqual([
      { jour: 'lundi', heure: 10, occupancy: 15 },
      { jour: 'lundi', heure: 11, occupancy: 40 },
      { jour: 'lundi', heure: 12, occupancy: 5 },
    ]);
    expect(cells).toHaveLength(21);
  });

  it('keeps SENSOR-MEASURED cells only (invariant 3): an estimated half is ignored', () => {
    const kinds = Array.from({ length: 7 }, measuredRow);
    kinds[0] = ['backup', 'measured', 'none', 'none', 'backup', 'backup'];
    const cells = measuredHourlyCells(heat(undefined, kinds)).filter((c) => c.jour === 'lundi');
    expect(cells).toEqual([{ jour: 'lundi', heure: 10, occupancy: 20 }]);
  });

  it('carries the median and each cell’s % of it (the spec’s step 2, so ratios are input numbers)', () => {
    const { input } = generated();
    expect(input.mesure.mediane_ouverture).toBe(15);
    expect(input.mesure.affluence_horaire[0]).toEqual({
      jour: 'lundi',
      heure: 10,
      occupancy_moyenne: 15,
      pct_mediane: 100,
    });
    expect(input.mesure.affluence_horaire[2]?.pct_mediane).toBe(33);
  });

  it('fills the venue, the calendar, the comparison and the history', () => {
    const { input } = generated();
    expect(input.periode).toEqual({ debut: '2026-06-01', fin: '2026-06-30', libelle: 'juin 2026' });
    expect(input.etablissement).toMatchObject({
      nom: 'Café Le Palmier',
      categorie: 'Cafés',
      csp: 'Moyen',
      zone: 'El Ghazela, Ariana',
      jours_fermeture_exceptionnelle: ['2026-06-14'],
      attributs_declares: {},
    });
    expect(input.etablissement.horaires_ouverture['lundi']).toEqual([['10:00', '13:00']]);
    expect(input.mesure).toMatchObject({ jours_mesures: 28, uptime_capteur_pct: 94 });
    expect(input.comparatif.mois_precedent).toEqual({ affluence_totale_variation_pct: 10 });
    expect(input.contexte_calendaire).toEqual({
      ramadan: false,
      vacances_scolaires: null,
      saison: 'ete',
      evenements_locaux_majeurs: [],
    });
    expect(input.historique_recommandations.familles_leviers_utilisees_3_derniers_mois).toEqual([
      'B',
    ]);
  });
});

describe('the mode decision (spec §8)', () => {
  it('no référentiel category → skip (no advice written for another trade)', () => {
    expect(planPiste02(args({ facts: facts({ sectorName: 'Autre' }) }))).toEqual({
      kind: 'skip',
      reason: 'no_category',
    });
  });

  it('fewer than 10 measured days → insuffisant, no call', () => {
    const a = args();
    a.data.kpis.measuredDays = 9;
    expect(planPiste02(a)).toEqual({ kind: 'insufficient', reason: 'few_measured_days' });
  });

  it('unknown opening hours or no measured hour → insuffisant', () => {
    expect(planPiste02(args({ facts: facts({ openingHour: null }) }))).toMatchObject({
      kind: 'insufficient',
      reason: 'no_hours',
    });
    const none = args();
    none.data = {
      ...none.data,
      ...heat(
        undefined,
        Array.from({ length: 7 }, () => SLOTS.map(() => 'backup' as const)),
      ),
    };
    expect(planPiste02(none)).toMatchObject({ kind: 'insufficient', reason: 'no_hourly_measure' });
  });

  it('a nominal month → genere, « Mode : genere. »', () => {
    const plan = generated();
    expect(plan.statut).toBe('genere');
    expect(plan.noPreciseHour).toBe(false);
    expect(plan.consignes).toEqual(['Mode : genere.']);
  });

  it('an uptime under 80 % → degrade, no precise hour may be cited', () => {
    const a = args();
    a.data.kpis.estimatedPct = 30;
    const plan = planPiste02(a);
    expect(plan).toMatchObject({ kind: 'generate', statut: 'degrade', noPreciseHour: true });
  });

  it('a strong/weak gap under 20 % → degrade, « fréquentation régulière »', () => {
    const flat = Array.from({ length: 7 }, () => row([20, 20, 21, 21, 22, 22]));
    const a = args();
    a.data = { ...a.data, ...heat(flat) };
    const plan = planPiste02(a);
    expect(plan).toMatchObject({ kind: 'generate', statut: 'degrade', noPreciseHour: false });
    if (plan.kind === 'generate') expect(plan.consignes.join(' ')).toContain('régulière');
  });

  it('Ramadan neutralises the month-to-month comparison; a first report steers to D or C', () => {
    const a = args({ month: '2026-03', firstReport: true });
    a.data.range = { from: '2026-03-01', to: '2026-03-31' };
    const plan = planPiste02(a);
    if (plan.kind !== 'generate') throw new Error('expected generate');
    expect(plan.input.contexte_calendaire.ramadan).toBe(true);
    expect(plan.input.comparatif.mois_precedent).toBeNull();
    expect(plan.consignes.join(' ')).toContain('Ramadan actif');
    expect(plan.consignes.join(' ')).toContain('famille D ou C');
  });
});

const VALID_BODY =
  'Vos lundis à 12h tournent à 33 % de votre niveau habituel, alors que la fin de matinée reste bien remplie à 11h. Ce creux suggère probablement une offre peu adaptée au moment du déjeuner pour le public présent. Une formule courte annoncée la veille sur vos réseaux sociaux se teste sans engagement et peut ramener une clientèle régulière.';

const output = (over: Partial<Piste02Output> = {}): Piste02Output => ({
  statut: 'genere',
  titre: 'Le creux du midi',
  corps: VALID_BODY,
  famille_levier: 'C',
  creneaux_cites: ['lundi 12h-13h'],
  hypothese_formulee: 'Offre inadaptée au déjeuner',
  confiance: 'haute',
  ...over,
});

describe('the post-checks (spec §9)', () => {
  const ctx = (noPreciseHour = false): { input: Piste02Input; noPreciseHour: boolean } => ({
    input: generated().input,
    noPreciseHour,
  });

  it('a conforming generation passes every check', () => {
    expect(checkPiste02(output(), ctx())).toEqual([]);
  });

  it('rejects a body outside 40–80 words', () => {
    expect(checkPiste02(output({ corps: 'Trop court.' }), ctx()).join()).toContain('mots');
    expect(checkPiste02(output({ corps: `${VALID_BODY} ${VALID_BODY}` }), ctx()).join()).toContain(
      'mots',
    );
  });

  it('rejects a blacklisted term, plurals included (écrans, campagnes, score)', () => {
    for (const term of ['écrans', 'campagnes', 'score', 'diffusion', 'impressions', 'CPM']) {
      const failures = checkPiste02(output({ corps: `${VALID_BODY} Les ${term} suivent.` }), ctx());
      expect(failures.join()).toContain('terme interdit');
    }
  });

  it('rejects an em dash, an exclamation mark, an emoji and a bullet list', () => {
    expect(checkPiste02(output({ corps: VALID_BODY.replace(',', ' —') }), ctx())).toContain(
      'tiret cadratin',
    );
    expect(checkPiste02(output({ corps: `${VALID_BODY}!` }), ctx())).toContain(
      "point d'exclamation",
    );
    expect(checkPiste02(output({ corps: `${VALID_BODY} ☕` }), ctx())).toContain('émoji');
    expect(checkPiste02(output({ corps: `${VALID_BODY}\n- une liste` }), ctx())).toContain(
      'liste à puces',
    );
  });

  it('rejects a lever family used in the last three months, or outside A–H', () => {
    expect(checkPiste02(output({ famille_levier: 'B' }), ctx()).join()).toContain('déjà utilisée');
    expect(checkPiste02(output({ famille_levier: 'Z' }), ctx()).join()).toContain(
      'hors référentiel',
    );
  });

  it('rejects a number the input does not carry (the « 25 % du secteur » class)', () => {
    const failures = checkPiste02(output({ corps: VALID_BODY.replace('33 %', '25 %') }), ctx());
    expect(failures).toContain('le nombre 25 ne figure pas dans les données');
  });

  it('rejects a repeated title', () => {
    expect(checkPiste02(output({ titre: 'réveillez vos matinées de semaine' }), ctx())).toContain(
      'titre déjà utilisé',
    );
  });

  it('in the uptime degraded mode, rejects an exact hour', () => {
    expect(checkPiste02(output(), ctx(true)).join()).toContain('créneau horaire précis');
  });
});

describe('the prompt (spec §3/§4)', () => {
  it('the system prompt is the spec’s, VERBATIM', () => {
    const spec = readFileSync(
      join(__dirname, '..', '..', '..', 'docs', 'specs', 'piste-02-angles-morts.md'),
      'utf8',
    );
    const section = spec.slice(spec.indexOf('## 3. Prompt système'), spec.indexOf('## 4.'));
    const fenced = /```\n([\s\S]*?)\n```/.exec(section)?.[1];
    expect(fenced).toBe(PISTE_02_SYSTEM_PROMPT);
  });

  it('the user message is the §4 template plus the mode block, and names failed checks on a retry', () => {
    const first = piste02UserMessage({
      inputJson: '{"x":1}',
      categorie: 'Cafés',
      referentiel: 'BLOC',
      consignes: ['Mode : genere.'],
    });
    expect(first).toContain('Voici les données du mois pour cet établissement.');
    expect(first).toContain('<donnees>\n{"x":1}\n</donnees>');
    expect(first).toContain('Référentiel de leviers admissibles pour la catégorie « Cafés » :');
    expect(first).toContain('<mode>\nMode : genere.\n</mode>');
    expect(first).not.toContain('rejetée');
    const retry = piste02UserMessage({
      inputJson: '{}',
      categorie: 'Cafés',
      referentiel: 'BLOC',
      consignes: [],
      previousFailures: ['tiret cadratin'],
    });
    expect(retry).toContain('- tiret cadratin');
  });

  it('the insuffisant fallback is the spec’s fixed text', () => {
    expect(INSUFFICIENT_BODY).toBe(
      'La mesure de ce mois est trop partielle pour identifier un créneau sous-exploité de manière fiable. Cette lecture sera disponible dès le prochain rapport complet.',
    );
  });
});
