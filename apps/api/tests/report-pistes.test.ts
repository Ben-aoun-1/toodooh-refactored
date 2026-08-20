import { describe, expect, it } from 'vitest';

import {
  BODY_MAX_CHARS,
  PISTE_01_NO_EVENTS_BODY,
  PISTE_01_TITLE,
  PISTE_02_GENERIC_BODY,
  PISTE_02_TITLE,
  PISTE_03_TITLE,
  PISTE_03_WAIT_BODY,
  type SpsBlock,
  type SpsKey,
  buildPistes,
  weakestCriterion,
} from '../src/lib/report/pistes.js';

// PERF-QA2 — THE pistes generator, pinned per branch. R3's fixed 3-theme structure was superseded
// on 2026-08-20 by Mejri's 13-juil « Retour rapport » spec: Piste 01 is an event teaser, Piste 03
// is a real SPS analysis. The page (/pistes) and the PDF (S07) both render THIS function's
// output, so every rule below holds on both surfaces at once.

const sps = (over: Partial<Record<SpsKey, number>> = {}, score = 70): SpsBlock => ({
  score,
  criteria: [
    {
      key: 'acceptation',
      label: "Taux d'acceptation des campagnes",
      weight: 40,
      value: over.acceptation ?? 100,
    },
    {
      key: 'respect_evenements',
      label: 'Respect des événements acceptés',
      weight: 30,
      value: over.respect_evenements ?? 100,
    },
    {
      key: 'activite',
      label: "Activité de l'écran",
      weight: 20,
      value: over.activite ?? 100,
    },
    {
      key: 'remplissage',
      label: 'Taux de remplissage',
      weight: 10,
      value: over.remplissage ?? 100,
    },
  ],
});

describe('Piste 01 — the event teaser (13-juil spec)', () => {
  it('says « cette semaine » up to J+7 and « ces prochains jours » beyond it', () => {
    for (const days of [0, 1, 7]) {
      expect(
        buildPistes({ events: { count: 1, soonestInDays: days }, sps: null, aiBody: null })[0].body,
      ).toContain('cette semaine');
    }
    for (const days of [8, 14]) {
      expect(
        buildPistes({ events: { count: 1, soonestInDays: days }, sps: null, aiBody: null })[0].body,
      ).toContain('ces prochains jours');
    }
  });

  it('a single event reads singular, several read « Plusieurs matchs » — never a count', () => {
    const one = buildPistes({ events: { count: 1, soonestInDays: 2 }, sps: null, aiBody: null })[0]
      .body;
    const many = buildPistes({ events: { count: 4, soonestInDays: 2 }, sps: null, aiBody: null })[0]
      .body;
    expect(one).toContain('Un match important est à');
    expect(many).toContain('Plusieurs matchs importants sont à');
    // Her spec: « pas nécessaire de les mentionner en détails ». No count, no name, no date, and
    // no window NUMBER either (ruling 2026-08-20 — the window is expressed in words only).
    for (const body of [one, many]) {
      expect(body).not.toMatch(/\d/);
    }
  });

  it('no upcoming events → the honest no-events variant (never a fabricated temps fort)', () => {
    for (const events of [null, { count: 0, soonestInDays: 3 }]) {
      expect(buildPistes({ events, sps: null, aiBody: null })[0].body).toBe(
        PISTE_01_NO_EVENTS_BODY,
      );
    }
  });

  it('the retired R3 hardcode is gone from every branch', () => {
    for (const events of [null, { count: 1, soonestInDays: 0 }, { count: 9, soonestInDays: 14 }]) {
      const body = buildPistes({ events, sps: null, aiBody: null })[0].body;
      expect(body).not.toContain('Coupe du Monde');
      expect(body).not.toContain('ce mois-ci');
    }
  });
});

describe('Piste 03 — the SPS analysis', () => {
  it('scoreless venue → EXACTLY the ruled wait copy, in the pending style', () => {
    const p3 = buildPistes({ events: null, sps: null, aiBody: null })[2];
    expect(p3.body).toBe(PISTE_03_WAIT_BODY);
    expect(p3.body).toBe('En attente de votre score de priorité.');
    expect(p3.pending).toBe(true);
  });

  it('a scored venue states its score and leaves the pending style', () => {
    const p3 = buildPistes({ events: null, sps: sps({ remplissage: 0 }, 90), aiBody: null })[2];
    expect(p3.pending).toBe(false);
    expect(p3.body).toContain('Votre score de priorité est de 90/100.');
  });

  it('names the WEIGHTED weakest variable, not the lowest raw value', () => {
    // remplissage 0/100 at poids 10 loses 10 pts; acceptation 50/100 at poids 40 loses 20.
    const weakest = weakestCriterion(sps({ remplissage: 0, acceptation: 50 }).criteria);
    expect(weakest?.key).toBe('acceptation');
    const body = buildPistes({
      events: null,
      sps: sps({ remplissage: 0, acceptation: 50 }),
      aiBody: null,
    })[2].body;
    expect(body).toContain("Point faible : Taux d'acceptation des campagnes (50/100, poids 40 %).");
  });

  it('each variable carries its OWN concrete lever', () => {
    const levers: Record<SpsKey, string> = {
      acceptation: 'Acceptez davantage de campagnes proposées',
      respect_evenements: 'Diffusez les événements que vous acceptez',
      activite: 'Gardez votre écran allumé',
      remplissage: 'Ouvrez davantage de créneaux',
    };
    for (const key of Object.keys(levers) as SpsKey[]) {
      const body = buildPistes({ events: null, sps: sps({ [key]: 0 }), aiBody: null })[2].body;
      expect(body).toContain(levers[key]);
    }
  });

  it('formats fr-FR: integers bare, decimals with a comma', () => {
    const body = buildPistes({
      events: null,
      sps: { ...sps({ acceptation: 62.5 }), score: 71.25 },
      aiBody: null,
    })[2].body;
    expect(body).toContain('71,3/100'); // score, one decimal
    expect(body).toContain('62,5/100'); // the weak variable's value
    expect(body).toContain('poids 40 %');
  });
});

describe('Piste 02 — the AI body (contract unchanged)', () => {
  it('a non-blank ai body fills it; null/blank keeps the generic copy verbatim', () => {
    expect(buildPistes({ events: null, sps: null, aiBody: 'Corps IA.' })[1].body).toBe('Corps IA.');
    for (const aiBody of [null, '', '   ']) {
      expect(buildPistes({ events: null, sps: null, aiBody })[1].body).toBe(PISTE_02_GENERIC_BODY);
    }
  });
});

describe('the three cards as a whole', () => {
  const matrix = [
    { events: null, sps: null },
    { events: { count: 1, soonestInDays: 0 }, sps: sps({ acceptation: 0 }) },
    { events: { count: 5, soonestInDays: 9 }, sps: sps({ respect_evenements: 0 }) },
    { events: { count: 2, soonestInDays: 7 }, sps: sps({ activite: 0 }, 12.5) },
    { events: { count: 1, soonestInDays: 14 }, sps: sps({ remplissage: 0 }, 99.9) },
  ];

  it('keeps the ruled numbering, titles and order in every branch', () => {
    for (const input of matrix) {
      const pistes = buildPistes({ ...input, aiBody: null });
      expect(pistes.map((p) => p.num)).toEqual(['01', '02', '03']);
      expect(pistes.map((p) => p.title)).toEqual([PISTE_01_TITLE, PISTE_02_TITLE, PISTE_03_TITLE]);
    }
  });

  it('every generated body fits the S07 card (a 3rd line overflows page 4)', () => {
    for (const input of matrix) {
      for (const piste of buildPistes({ ...input, aiBody: null })) {
        expect(piste.body.length).toBeLessThanOrEqual(BODY_MAX_CHARS);
      }
    }
  });

  it('is a pure function of its input — same input twice, byte-identical cards', () => {
    for (const input of matrix) {
      expect(buildPistes({ ...input, aiBody: 'x' })).toEqual(
        buildPistes({ ...input, aiBody: 'x' }),
      );
    }
  });
});
