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
