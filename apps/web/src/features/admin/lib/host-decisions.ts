import type {
  HostDecisionRow,
  HostDecisionStatut,
} from '@/features/admin/services/admin-host-decisions.service';

// Mariem 13/11/2026 — the « Réponses des Hosts » panel's words and order (pure, tested).

export const HOST_DECISION_LABEL: Record<HostDecisionStatut, string> = {
  EN_ATTENTE: 'En attente',
  ACCEPTE: 'Acceptée',
  REFUSE: 'Refusée',
  RESERVE: 'Réservée (spot en validation)',
};

/** Only a share still awaiting its Host can be answered (a refusal is definitive). */
export const canAnswerForHost = (row: Pick<HostDecisionRow, 'statut'>): boolean =>
  row.statut === 'EN_ATTENTE';

/** Awaiting first, then accepted, reserved, refused — alphabetical inside each group. */
export const sortHostDecisions = (rows: readonly HostDecisionRow[]): HostDecisionRow[] => {
  const rank: Record<HostDecisionStatut, number> = {
    EN_ATTENTE: 0,
    ACCEPTE: 1,
    RESERVE: 2,
    REFUSE: 3,
  };
  return [...rows].sort(
    (a, b) =>
      rank[a.statut] - rank[b.statut] || a.screenhost_name.localeCompare(b.screenhost_name, 'fr'),
  );
};

/** « 2 en attente · 3 acceptées · 1 refusée » — zero groups left out. */
export const hostDecisionSummary = (rows: readonly Pick<HostDecisionRow, 'statut'>[]): string => {
  const n = (s: HostDecisionStatut) => rows.filter((r) => r.statut === s).length;
  const parts: string[] = [];
  const waiting = n('EN_ATTENTE');
  const accepted = n('ACCEPTE');
  const reserved = n('RESERVE');
  const refused = n('REFUSE');
  if (waiting > 0) parts.push(`${waiting} en attente`);
  if (accepted > 0) parts.push(`${accepted} acceptée${accepted > 1 ? 's' : ''}`);
  if (reserved > 0) parts.push(`${reserved} réservée${reserved > 1 ? 's' : ''}`);
  if (refused > 0) parts.push(`${refused} refusée${refused > 1 ? 's' : ''}`);
  return parts.length > 0 ? parts.join(' · ') : 'Aucun Host';
};

/** The refusal confirmation, in the Host's own words of « définitif ». */
export const refuseForHostQuestion = (venueName: string): string =>
  `Refuser pour ${venueName} ? Ce refus est définitif : la part sera proposée à d’autres Hosts.`;
