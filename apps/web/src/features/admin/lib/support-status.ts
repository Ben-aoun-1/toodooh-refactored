// SUP-1 — the admin « Support » queue's pure rules (no render harness: pinned here).

export const SUPPORT_STATUSES = ['new', 'handled'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const supportStatusLabel = (status: string): string =>
  status === 'new' ? 'À traiter' : status === 'handled' ? 'Traité' : status;

export const supportStatusChip = (status: string): string =>
  status === 'new'
    ? 'bg-amber-50 text-amber-800 border-amber-200'
    : 'bg-emerald-50 text-emerald-800 border-emerald-200';

export const supportKindLabel = (kind: string): string =>
  kind === 'appointment' ? 'Rendez-vous' : 'Message';

export const roleLabel = (role: string): string =>
  (
    ({
      advertiser: 'Annonceur',
      individual_owner: 'Screenhost',
      fleet_owner: 'Screenhost (réseau)',
      screenhost_agent: 'Agent Screenhost',
      screencast_agent: 'Agent Screencast',
    }) as Record<string, string>
  )[role] ?? role;
