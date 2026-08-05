// PERF-QA1 R3 — filename-safe venue slug for report downloads: the owner's browser shows WHICH
// venue a PDF belongs to ('Café Période N°3' → 'cafe-periode-n-3'). Diacritics fold to ASCII;
// anything else collapses to single dashes. Never empty — a fully non-ASCII name degrades to
// 'etablissement' rather than an empty segment.
export function venueSlug(name: string): string {
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'etablissement' : slug;
}
