import type { ScreenhostEligibility } from '@/features/admin/services/admin-screenhost.service';

// Mariem 11/11 — what the Host declared at signup next to its hours, as ONE read-only line on the
// admin eligibility card: « Ramadan : 20h → 2h · Diffuse les matchs : Oui ». Not declared (a venue
// from before migration 0107, or the mobile app) reads « non renseigné ».

const NOT_DECLARED = 'non renseigné';

export function venueDeclarationsLine(view: ScreenhostEligibility): string {
  const o = view.ramadan_opening_hour ?? null;
  const c = view.ramadan_closing_hour ?? null;
  const ramadan = o === null || c === null ? NOT_DECLARED : `${o}h → ${c}h`;
  const m = view.broadcasts_matches ?? null;
  const matches = m === null ? NOT_DECLARED : m ? 'Oui' : 'Non';
  return `Ramadan : ${ramadan} · Diffuse les matchs : ${matches}`;
}
