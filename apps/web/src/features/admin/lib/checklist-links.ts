import type { AdminChecklistRow } from '@/features/admin/services/admin-checklists.service';

// Mariem 15/11/2026 — the admin « Checklists » page: which fiches still wait for their Host, and
// how a fiche's state reads. Pure, tested in checklist-links.test.ts.

export type LinkFilter = 'a_relier' | 'reliees' | 'toutes';

export const LINK_FILTERS: readonly { id: LinkFilter; label: string }[] = [
  { id: 'a_relier', label: 'À relier' },
  { id: 'reliees', label: 'Reliées' },
  { id: 'toutes', label: 'Toutes' },
];

export const filterChecklists = (
  rows: readonly AdminChecklistRow[],
  filter: LinkFilter,
): AdminChecklistRow[] =>
  rows.filter((r) =>
    filter === 'toutes'
      ? true
      : filter === 'reliees'
        ? r.screenhost !== null
        : r.screenhost === null,
  );

export const countFor = (rows: readonly AdminChecklistRow[], filter: LinkFilter): number =>
  filterChecklists(rows, filter).length;

/** The manager's decision, as the admin reads it. */
export const decisionLabel = (status: AdminChecklistRow['status']): string =>
  status === 'validated'
    ? 'Validée par le manager'
    : status === 'refused'
      ? 'Refusée par le manager'
      : 'En attente du manager';

export const decisionTone = (status: AdminChecklistRow['status']): 'ok' | 'ko' | 'wait' =>
  status === 'validated' ? 'ok' : status === 'refused' ? 'ko' : 'wait';
