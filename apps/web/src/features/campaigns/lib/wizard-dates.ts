/**
 * Date utilities shared across the new-campaign wizard. Hoisted out of
 * NewCampaign.tsx so step components, the wizard hook, and persistence
 * helpers can use them without importing the page component.
 */

export function toLocalDateOnlyString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseCampaignUiDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0);
  }
  const part = String(value).trim().split('T')[0];
  if (!part) return null;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(part);
  if (ymd) {
    return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 0, 0, 0, 0);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0, 0);
}

// ── CF-Q2 (spec §1.4) — the server start floor, consumed (never recomputed) by StepBasics ──────

/** Week-end dates are unselectable in the START picker (react-datepicker filterDate). */
export function isSelectableStartDate(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

/** French helper line under the start field — from the server's first_available_start_date. */
export function startFloorHelperText(firstAvailableIso: string | undefined): string | null {
  const parsed = parseCampaignUiDate(firstAvailableIso ?? null);
  if (!parsed) return null;
  const label = parsed.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return `Premier départ possible : ${label} — les campagnes démarrent en jours ouvrés.`;
}
