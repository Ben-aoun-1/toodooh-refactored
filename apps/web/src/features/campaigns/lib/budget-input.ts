// 20/11 (operator) — the cart's budget can be TYPED exactly, next to the cursor. Pure: what the
// box accepts and the sentence it shows when it refuses. The cursor and the box set the SAME
// requested budget; the server keeps the final word (the C_max gate at confirm).

export type BudgetInputResult = { ok: true; value: number } | { ok: false; error: string };

const fmt = (n: number): string =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** « 15 619 », « 15619,5 », « 15 619.50 » → TND (centimes at most), within (0, max]. */
export const parseBudgetInput = (raw: string, maxTnd: number | undefined): BudgetInputResult => {
  const cleaned = raw
    .replace(/\s/g, '') // \s covers the no-break spaces fr-FR numbers use
    .replace(/tnd$/i, '')
    .replace(',', '.');
  if (cleaned === '')
    return { ok: false, error: 'Indiquez le montant que vous souhaitez dépenser.' };
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, error: 'Montant invalide : un nombre, au plus 2 décimales.' };
  }
  const value = Number(cleaned);
  if (value <= 0) return { ok: false, error: 'Le montant doit être supérieur à 0.' };
  if (maxTnd !== undefined && value > maxTnd) {
    return { ok: false, error: `Au maximum ${fmt(maxTnd)} TND sur ces lieux et ces dates.` };
  }
  return { ok: true, value };
};

/** The box's text for a budget chosen with the cursor (empty while none is chosen). */
export const budgetInputText = (value: number | null): string => (value === null ? '' : fmt(value));
