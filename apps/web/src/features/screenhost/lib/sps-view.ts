import type { VenueSps } from '../services/performance.service';

/**
 * PERF-QA1 R6 — pure view maths for the live SPS card (S08). Labels mirror the PDF's S08
 * VERBATIM; weights and values come EXCLUSIVELY from the wire (the 25/30/20/10 Σ-85 hardcode
 * era is over — pinned by test). fr-FR number style: integer or one comma decimal, like the
 * PDF's fmtScore.
 */

export interface SpsCriterionView {
  label: string;
  weightLabel: string; // 'poids 40 %'
  valueLabel: string; // '72,5 / 100'
  /** Bar fill 0–100 (clamped). */
  pct: number;
}

const fmtScore = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');

/** The PDF's S08 criterion labels, in the ruled order — the page mirrors the document. */
export function spsCriteria(variables: NonNullable<VenueSps['variables']>): SpsCriterionView[] {
  const row = (label: string, v: { value: number; weight: number }): SpsCriterionView => ({
    label,
    weightLabel: `poids ${fmtScore(v.weight)} %`,
    valueLabel: `${fmtScore(v.value)} / 100`,
    pct: Math.max(0, Math.min(100, v.value)),
  });
  return [
    row("Taux d'acceptation des campagnes", variables.acceptation),
    row('Respect des événements acceptés', variables.respect_evenements),
    row("Activité de l'écran", variables.activite),
    row('Taux de remplissage', variables.remplissage),
  ];
}

/** The big score figure — 'À venir' while the venue has no computable score. */
export function spsScoreLabel(sps: number | null): string {
  return sps === null ? 'À venir' : fmtScore(sps);
}
