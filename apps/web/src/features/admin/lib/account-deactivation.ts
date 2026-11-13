// DEACT-1 (Mariem's sheet row 11, operator rulings 2026-10-28) — the admin's account deactivation,
// pure: who can be deactivated / reactivated, the reason, the result toast. Twin of the api's
// lib/account-deactivation.ts (owner roles + advertiser, only a validated account).

export const DEACTIVATABLE_ROLES = ['individual_owner', 'fleet_owner', 'advertiser'];

export const canDeactivate = (user: { role: string; status: string }): boolean =>
  DEACTIVATABLE_ROLES.includes(user.role) && user.status === 'approved';

export const canReactivate = (user: { status: string }): boolean => user.status === 'deactivated';

export function parseDeactivationReason(
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const reason = raw.trim();
  return reason.length >= 3 && reason.length <= 500
    ? { ok: true, value: reason }
    : { ok: false, error: 'Indiquez le motif de la désactivation (3 à 500 caractères).' };
}

/** « Compte désactivé — 2 campagnes arrêtées, 1 rejetée. » */
export function deactivatedToast(r: {
  kind: 'host' | 'cast';
  moved_campaigns: number;
  rejected_campaigns: number;
  stopped_campaigns: unknown[];
  finishing_campaigns: number;
}): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
  const parts =
    r.kind === 'host'
      ? r.moved_campaigns > 0
        ? [plural(r.moved_campaigns, 'campagne redistribuée', 'campagnes redistribuées')]
        : []
      : [
          ...(r.stopped_campaigns.length > 0
            ? [plural(r.stopped_campaigns.length, 'campagne arrêtée', 'campagnes arrêtées')]
            : []),
          ...(r.finishing_campaigns > 0
            ? [
                plural(
                  r.finishing_campaigns,
                  'campagne va se terminer',
                  'campagnes vont se terminer',
                ),
              ]
            : []),
          ...(r.rejected_campaigns > 0
            ? [
                plural(
                  r.rejected_campaigns,
                  'campagne en attente rejetée',
                  'campagnes en attente rejetées',
                ),
              ]
            : []),
        ];
  return parts.length > 0 ? `Compte désactivé — ${parts.join(', ')}.` : 'Compte désactivé.';
}
