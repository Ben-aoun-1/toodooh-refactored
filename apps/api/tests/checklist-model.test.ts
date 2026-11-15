import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  type Answers,
  checklistResult,
  delegationsOf,
  firstMissing,
  hasEliminatory,
  pagesOf,
  renderAnswers,
  visibleQuestions,
} from '../src/lib/checklist-model.js';

// Agent Screenhost spec VF §11 — the questionnaire's rules, pinned on the spec's own tables:
// page counts (10 / 12), the five eliminatory answers, the three results.

const base: Answers = {
  nom: 'Café Nord',
  categorie: 'Cafés',
  gouvernorat: 'Tunis',
  quartier: 'La Marsa',
  o_date: '2026-11-15',
  o_heure: '10:30',
  affluence: 'plus',
  potentiel: '3',
  tv: 'Oui',
  tvnb: '2',
  tvcouv: '60',
  tvon: 'Tous',
  wifi: 'stable',
  tvmarque: ['Samsung'],
  tvos: 'android',
  jours: ['Toute la semaine'],
  h_ouv: '08:00',
  h_ferm: '23:00',
  wk: 'non',
  pointe: ['Soirée'],
  pointesrc: 'Observé',
  gamme: 'Moyen',
  public: ['Familles'],
  age: ['17-30'],
  matchs: 'Oui',
  zone: 'Intérieure',
  entrees: '1',
  vitrine: 'Oui',
  enseigne: 'isole',
  avis: 'oui',
  action: 'install',
  a_date: '2026-11-20',
};
const met: Answers = {
  ...base,
  contact: 'decideur',
  mesure: 'Oui',
  rne: 'Oui',
  capteur: 'ok',
  comprend: 'Oui',
  interet: 'Très intéressé',
  rapports: 'Oui',
  promesse: 'ok',
};
const pages = (a: Answers) => pagesOf(visibleQuestions(a)).length;

describe('checklist model (spec VF §11)', () => {
  it('the api and web copies of the model are the same file', () => {
    const read = (rel: string) =>
      readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    expect(read('../../web/src/features/agent/lib/checklist-model.ts')).toBe(
      read('../src/lib/checklist-model.ts'),
    );
  });

  it('10 pages while the manager was not met, 12 once he was', () => {
    expect(pages({ ...base, contact: 'non' })).toBe(10);
    expect(pages({ ...base, contact: 'absent' })).toBe(10);
    expect(pages(met)).toBe(12);
    expect(firstMissing(met)).toBeNull();
  });

  it('each eliminatory answer closes the fiche as Non éligible, keeping the opinion and the action', () => {
    const cases: [Answers, string][] = [
      [{ ...met, affluence: 'moins' }, 'Affluence inférieure à 20 personnes en moyenne'],
      [{ ...met, tv: 'Non' }, 'Aucun téléviseur'],
      [{ ...met, mesure: 'Non' }, "Mesure d'affluence refusée par le gérant"],
      [{ ...met, rne: 'Non' }, "Pas d'immatriculation au RNE ni de RIB au nom de l'entreprise"],
      [{ ...met, wifi: 'non' }, 'Pas de Wi-Fi'],
    ];
    for (const [a, motif] of cases) {
      const r = checklistResult(a);
      expect(r.res).toBe('non');
      expect(r.motifs).toEqual([motif]);
      expect(hasEliminatory(a)).toBe(true);
      const titles = pagesOf(visibleQuestions(a)).map((p) => p.title);
      expect(titles.slice(-2)).toEqual(['Ton avis', 'La prochaine action']);
    }
    // Fewer than 20 people: only the first two pages, then the closing ones.
    expect(pages({ ...met, affluence: 'moins' })).toBe(4);
    expect(hasEliminatory(met)).toBe(false);
  });

  it('Éligible when complete and the manager was met; À compléter otherwise, with its first condition', () => {
    expect(checklistResult(met)).toEqual({ res: 'elig', motifs: [], cond: [], verif: [], sig: [] });
    const inc = checklistResult({ ...base, contact: 'absent' });
    expect(inc.res).toBe('inc');
    expect(inc.cond[0]).toContain('Rencontrer le gérant');
  });

  it('unfavourable answers become conditions, checks and signals, never a refusal', () => {
    const r = checklistResult({
      ...met,
      wifi: 'instable',
      tvos: 'autre',
      tvos_autre: 'WebOS',
      capteur: 'accord',
      rne: 'À vérifier',
      mesure: 'Réticent',
      tvcouv: '20',
      interet: 'Sceptique',
      objection: 'Revenu',
    });
    expect(r.res).toBe('elig');
    expect(r.cond).toEqual([
      "Wi-Fi stable à l'emplacement de l'écran",
      "Appareil compatible avec l'application Toodooh (téléviseur non Android)",
      "Accord du gérant pour l'emplacement du capteur",
    ]);
    expect(r.verif).toEqual(['Immatriculation au RNE et RIB']);
    expect(r.sig).toEqual([
      'Couverture visuelle faible (20 %)',
      "Réticence sur la mesure d'affluence",
      'Gérant sceptique : revenu',
    ]);
  });

  it('an answer hidden by a condition never counts', () => {
    // « mesure: Non » was answered, then the contact went back to « absent »: the page is hidden.
    const r = checklistResult({ ...met, mesure: 'Non', contact: 'absent' });
    expect(r.res).toBe('inc');
    expect(r.motifs).toEqual([]);
  });

  it('optional contact and Wi-Fi details never block; a required field does', () => {
    expect(
      firstMissing({ ...met, c_nom: undefined, ssid: undefined, wifi_mdp: undefined }),
    ).toBeNull();
    expect(firstMissing({ ...met, nom: undefined })?.id).toBe('nom');
    expect(firstMissing({ ...met, tvmarque: ['Autre'] })?.id).toBe('tvmarque');
    expect(firstMissing({ ...met, tvmarque: ['Autre'], tvmarque_autre: 'Sony' })).toBeNull();
  });

  it('délégations follow the governorate; an uncovered governorate takes a free text', () => {
    expect(delegationsOf(undefined)).toEqual([]);
    expect(delegationsOf('Ariana')).toContain('La Soukra');
    expect(delegationsOf('Sfax')).toBeNull();
  });

  it('renders the answers for the Hub: labels, formatted values, the secret and eliminatory flags', () => {
    const { pages: rendered, hidden_pages } = renderAnswers({
      ...base,
      contact: 'absent',
      wifi: 'non',
      wifi_mdp: 'secret',
    });
    expect(hidden_pages).toContain("L'accord du gérant");
    const obs = rendered.find((p) => p.title === 'Ton observation');
    expect(obs?.step).toBe('Présélection');
    expect(obs?.items[0]).toEqual({ label: 'Jour de la prospection', value: '15/11/2026' });
    expect(obs?.items[1]).toEqual({ label: 'Heure de la prospection', value: '10h30' });
    const equip = rendered.find((p) => p.title === "L'équipement");
    expect(equip?.items).toEqual([
      { label: "Y a-t-il un Wi-Fi dans l'établissement ?", value: 'Non', eliminatory: true },
    ]);
    const ok = renderAnswers({ ...met, ssid: 'Cafe_wifi', wifi_mdp: 'secret' });
    const wifi = ok.pages.find((p) => p.title === "L'équipement")?.items ?? [];
    expect(wifi).toContainEqual({ label: 'Mot de passe du Wi-Fi', value: 'secret', secret: true });
    expect(ok.hidden_pages).toEqual([]);
  });
});
