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

const BY: Record<'owner' | 'agent' | 'admin', string> = {
  owner: 'par le Host',
  agent: 'par l’agent',
  admin: 'par l’admin',
};

const tunisStamp = (iso: string): string =>
  new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'Africa/Tunis',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Mariem 16/11 — « le traçage doit être clair »: the status with who answered and when; a Host
 * withdrawn for not answering by its own deadline reads « Sans réponse », never « Refusée ».
 */
export const hostDecisionTrace = (
  row: Pick<HostDecisionRow, 'statut' | 'decided_by' | 'decided_at'>,
): string => {
  const when = row.decided_at ? ` · ${tunisStamp(row.decided_at)}` : '';
  if (row.statut === 'REFUSE' && row.decided_by === 'system') {
    return `Sans réponse : proposition retirée${when}`;
  }
  const by =
    row.decided_by && row.decided_by !== 'system' && row.statut !== 'EN_ATTENTE'
      ? ` ${BY[row.decided_by]}`
      : '';
  return `${HOST_DECISION_LABEL[row.statut]}${by}${when}`;
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
