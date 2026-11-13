/**
 * DEL-1 (operator 2026-10-19, rulings A A B A) — the admin's complete account deletion, pure: the
 * confirm form (a reason + the account's email retyped) and the French summary of what goes,
 * from the api's row counts per table.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function deletionBody(
  reason: string,
  typedEmail: string,
  accountEmail: string,
): Parsed<{ reason: string; confirm_email: string }> {
  const motif = reason.trim();
  if (motif.length < 3) return { ok: false, error: 'Indiquez le motif de la suppression.' };
  if (typedEmail.trim().toLowerCase() !== accountEmail.trim().toLowerCase()) {
    return { ok: false, error: 'Retapez exactement l’e-mail du compte pour confirmer.' };
  }
  return { ok: true, value: { reason: motif, confirm_email: typedEmail.trim() } };
}

const LABELS: Record<string, [string, string]> = {
  campaigns: ['campagne', 'campagnes'],
  creatives: ['spot', 'spots'],
  recharges: ['recharge', 'recharges'],
  monthly_invoices: ['facture', 'factures'],
  screenhosts: ['établissement', 'établissements'],
  screens: ['écran', 'écrans'],
  screenhost_factures: ['facture screenhost', 'factures screenhost'],
  proof_of_play: ['preuve de diffusion', 'preuves de diffusion'],
  user_documents: ['document', 'documents'],
  agent_affiliations: ['affiliation', 'affiliations'],
  agent_commission_lines: ['ligne de commission', 'lignes de commission'],
  notifications: ['notification', 'notifications'],
};

/** « 3 campagnes, 2 spots, 120 preuves de diffusion » — the tables a reader recognises, biggest first. */
export function deletionSummary(counts: Record<string, number>): string[] {
  return Object.entries(LABELS)
    .flatMap(([table, [one, many]]) => {
      const n = counts[table] ?? 0;
      return n > 0 ? [{ n, text: `${n} ${n > 1 ? many : one}` }] : [];
    })
    .sort((a, b) => b.n - a.n)
    .map((x) => x.text);
}

/** Every row the deletion removes, all tables together. */
export const deletionTotal = (counts: Record<string, number>): number =>
  Object.values(counts).reduce((sum, n) => sum + n, 0);
