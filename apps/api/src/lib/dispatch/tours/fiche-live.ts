import { getISODay, parseISO } from 'date-fns';

import { type DispatchCreneau } from '../../../db/schema.js';
import { type ToursFicheVenue, type ToursFicheWire } from '../../campaign-eligible-hosts-tours.js';

// Mariem 16/11 — the admin fiche of a LAUNCHED tours campaign (its week grid, its shares) shows the
// allocations as they are NOW, not only as frozen at the launch: a refusal re-placed onto a Host
// that accepted (its added hours), onto a new Host (« Amine Test »), or a Host withdrawn at its
// start − 6 h must all be visible. PURE: the frozen fiche + the plan's current allocations.

export interface LiveAllocation {
  screenhostId: string;
  statut: string;
  /** Who answered ('system' = withdrawn without an answer); absent where not recorded. */
  decidedBy?: string | null;
  /** Qualified impressions (ii_potentiel). */
  impressions: number;
  /** HT value (revenu_previsionnel), before the Screenhost share. */
  revenuTnd: number;
  creneaux: readonly (DispatchCreneau & { tour?: number })[];
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

const reponseOf = (a: LiveAllocation): NonNullable<ToursFicheVenue['reponse']> => {
  if (a.statut === 'REFUSE') return a.decidedBy === 'system' ? 'SANS_REPONSE' : 'REFUSE';
  if (a.statut === 'ACCEPTE' || a.statut === 'RESERVE') return a.statut;
  return 'EN_ATTENTE';
};

/** « Tours reçus » from the stored créneaux: each tour with its passages (the max of its hours). */
const liveTours = (creneaux: LiveAllocation['creneaux']): ToursFicheVenue['tours'] => {
  const byTour = new Map<number, number>();
  for (const c of creneaux) {
    const tour = c.tour ?? 1;
    byTour.set(tour, Math.max(byTour.get(tour) ?? 0, c.reps));
  }
  return [...byTour].sort(([a], [b]) => a - b).map(([tour, passages]) => ({ tour, passages }));
};

/** The week grid of one venue from its stored créneaux (the frozen cells kept for the rest). */
const liveWeek = (
  frozen: ToursFicheVenue['week'],
  creneaux: LiveAllocation['creneaux'],
  /** 'date:hour' → blacked-out minutes of a confirmed match (this venue's). */
  matchCut: ReadonlyMap<string, number> = new Map(),
): ToursFicheVenue['week'] => {
  type Cell = ToursFicheVenue['week'][number];
  const cells = new Map<string, Cell>(
    frozen.map((c) => [`${c.day_of_week}:${c.hour}`, { ...c, tour: null, passages: null }]),
  );
  const datesByCell = new Map<string, Set<string>>();
  const cutByCell = new Map<string, Set<string>>();
  for (const c of creneaux) {
    const dayOfWeek = getISODay(parseISO(c.date));
    const key = `${dayOfWeek}:${c.hour}`;
    const dates = datesByCell.get(key) ?? new Set<string>();
    dates.add(c.date);
    datesByCell.set(key, dates);
    const cut = cutByCell.get(key) ?? new Set<string>();
    if ((matchCut.get(`${c.date}:${c.hour}`) ?? 0) > 0) cut.add(c.date);
    cutByCell.set(key, cut);
    const cell: Cell = cells.get(key) ?? {
      day_of_week: dayOfWeek,
      hour: c.hour,
      affluence: c.reps > 0 ? round4(c.impressions / c.reps) : 0,
      n: 0,
      tour: null,
      passages: null,
    };
    cells.set(key, {
      ...cell,
      n: Math.max(cell.n, dates.size),
      tour: cell.tour === null ? (c.tour ?? 1) : Math.min(cell.tour, c.tour ?? cell.tour),
      passages: Math.max(cell.passages ?? 0, c.reps),
      ...(cut.size > 0 ? { match: cut.size } : {}),
    });
  }
  return [...cells.values()].sort((a, b) => a.day_of_week - b.day_of_week || a.hour - b.hour);
};

export const withLiveAllocations = (
  fiche: ToursFicheWire,
  allocations: readonly LiveAllocation[],
  nameOf: (id: string) => { name: string; sector: string | null; class: string | null },
  /**
   * Mariem 17/11 — per venue, 'date:hour' → minutes a confirmed match blacks out
   * (event-blackout's blackoutMinutesByVenueCell): a match created after the launch shows.
   */
  matchCut: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map(),
): ToursFicheWire => {
  const pct = fiche.params.pct_sh / 100;
  const byVenue = new Map(allocations.map((a) => [a.screenhostId, a]));
  const live = (v: ToursFicheVenue, a: LiveAllocation | undefined): ToursFicheVenue => {
    if (!a) return v;
    const reponse = reponseOf(a);
    if (a.statut === 'REFUSE') {
      return {
        ...v,
        reponse,
        impressions: 0,
        montant_tnd: 0,
        tours: [],
        week: liveWeek(v.week, []),
      };
    }
    return {
      ...v,
      statut: 'retenu',
      reponse,
      impressions: round4(a.impressions),
      montant_tnd: round4(a.revenuTnd * pct),
      tours: liveTours(a.creneaux),
      week: liveWeek(v.week, a.creneaux, matchCut.get(a.screenhostId)),
    };
  };
  const known = new Set(fiche.venues.map((v) => v.id));
  const added: ToursFicheVenue[] = allocations
    .filter((a) => !known.has(a.screenhostId))
    .map((a) => {
      const label = nameOf(a.screenhostId);
      const base: ToursFicheVenue = {
        id: a.screenhostId,
        name: label.name,
        sector: label.sector,
        class: label.class,
        sps: 0,
        ordre: fiche.venues.length + 1,
        plein_impressions: 0,
        plein_montant_tnd: 0,
        impressions: 0,
        montant_tnd: 0,
        statut: 'retenu',
        tours: [],
        week: [],
      };
      return live(base, a);
    });
  const venues = [...fiche.venues.map((v) => live(v, byVenue.get(v.id))), ...added];
  return {
    ...fiche,
    i_alloue: round4(
      allocations.filter((a) => a.statut !== 'REFUSE').reduce((s, a) => s + a.impressions, 0),
    ),
    venues,
  };
};
