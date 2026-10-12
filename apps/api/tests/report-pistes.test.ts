import { describe, expect, it } from 'vitest';

import {
  BODY_MAX_CHARS,
  PISTE_01_MAX_MATCHES,
  PISTE_01_NO_EVENTS_BODY,
  PISTE_01_TITLE,
  PISTE_02_WAIT_BODY,
  PISTE_02_TITLE,
  PISTE_03_TITLE,
  PISTE_03_WAIT_BODY,
  type SpsBlock,
  type SpsKey,
  buildPistes,
  formatKickoffFr,
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

describe('Piste 01 — the upcoming matches, named (operator 2026-10-12)', () => {
  const derby = { name: 'Derby Tunis VS Sfax', day: '2026-10-20', time: '20:00' };
  const classico = { name: 'CA - EST', day: '2026-10-24', time: '18:30' };

  it('one match: its name, weekday, date and kickoff, then the singular call to action', () => {
    expect(buildPistes({ events: { matches: [derby] }, sps: null, aiBody: null })[0].body).toBe(
      "À l'affiche : Derby Tunis VS Sfax, mar. 20/10 à 20h. Annoncez sa diffusion à vos clients dès maintenant pour remplir votre lieu ce jour-là.",
    );
  });

  it('several matches: listed nearest first, plural call to action, minutes kept when not :00', () => {
    expect(
      buildPistes({ events: { matches: [derby, classico] }, sps: null, aiBody: null })[0].body,
    ).toBe(
      "À l'affiche : Derby Tunis VS Sfax, mar. 20/10 à 20h · CA - EST, sam. 24/10 à 18h30. Annoncez leur diffusion à vos clients dès maintenant pour remplir votre lieu ces jours-là.",
    );
  });

  it('never names more than PISTE_01_MAX_MATCHES', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ ...derby, name: `Match ${i}` }));
    const body = buildPistes({ events: { matches: many }, sps: null, aiBody: null })[0].body;
    expect(body).toContain('Match 2');
    expect(body).not.toContain('Match 3');
    expect(PISTE_01_MAX_MATCHES).toBe(3);
  });

  it('formats a kickoff as the owner reads it', () => {
    expect(formatKickoffFr('2026-10-18', '17:00')).toBe('dim. 18/10 à 17h');
    expect(formatKickoffFr('2026-10-24', '18:30')).toBe('sam. 24/10 à 18h30');
  });

  it('no upcoming match → the honest no-events variant (never a fabricated temps fort)', () => {
    for (const events of [null, { matches: [] }]) {
      expect(buildPistes({ events, sps: null, aiBody: null })[0].body).toBe(
        PISTE_01_NO_EVENTS_BODY,
      );
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

describe('Piste 02 — the AI body, or an honest wait (US-P.10)', () => {
  it('a non-blank ai body fills it, out of the wait state', () => {
    const p2 = buildPistes({ events: null, sps: null, aiBody: 'Corps IA.' })[1];
    expect(p2.body).toBe('Corps IA.');
    expect(p2.pending).toBe(false);
  });

  it('null/blank → EXACTLY « À venir », in the pending style — never generic prose', () => {
    for (const aiBody of [null, '', '   ']) {
      const p2 = buildPistes({ events: null, sps: null, aiBody })[1];
      expect(p2.body).toBe(PISTE_02_WAIT_BODY);
      expect(p2.body).toBe('À venir');
      expect(p2.pending).toBe(true);
    }
  });

  it('the retired R3.1 generic paragraph never renders again', () => {
    const body = buildPistes({ events: null, sps: null, aiBody: null })[1].body;
    expect(body).not.toContain('Comparez vos créneaux');
    expect(body).not.toContain('essayez X et Y');
  });
});

describe('the three cards as a whole', () => {
  const matrix = [
    { events: null, sps: null },
    {
      events: { matches: [{ name: 'Derby Tunis VS Sfax', day: '2026-10-20', time: '20:00' }] },
      sps: sps({ acceptation: 0 }),
    },
    {
      events: {
        matches: [
          { name: 'Derby Tunis VS Sfax', day: '2026-10-20', time: '20:00' },
          { name: 'CA - EST', day: '2026-10-24', time: '18:30' },
          { name: 'CSS - USM', day: '2026-10-25', time: '15:00' },
        ],
      },
      sps: sps({ respect_evenements: 0 }),
    },
    {
      events: { matches: [{ name: 'Derby Tunis VS Sfax', day: '2026-10-20', time: '20:00' }] },
      sps: sps({ activite: 0 }, 12.5),
    },
    {
      events: {
        matches: [
          { name: 'Derby Tunis VS Sfax', day: '2026-10-20', time: '20:00' },
          { name: 'CA - EST', day: '2026-10-24', time: '18:30' },
          { name: 'CSS - USM', day: '2026-10-25', time: '15:00' },
        ],
      },
      sps: sps({ remplissage: 0 }, 99.9),
    },
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
