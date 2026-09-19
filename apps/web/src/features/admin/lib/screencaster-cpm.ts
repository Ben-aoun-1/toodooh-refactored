import type {
  ScreencasterCpmPatch,
  ScreencasterCpmRow,
} from '@/features/admin/services/admin-screencaster-cpm.service';

// CPM-3 — the pure logic of the « CPM par screencaster » table (apps/web has no render harness,
// so it is tested here): search, selection of the FILTERED rows, the drafts a change re-prices,
// and the PATCH body.

/** Accent-, case- and space-insensitive form used by the search. */
const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** The name the table shows: the company when there is one, else the contact. */
export const screencasterName = (row: ScreencasterCpmRow): string =>
  row.company_name?.trim() || row.contact_name;

export const filterScreencasters = (
  rows: readonly ScreencasterCpmRow[],
  query: string,
): ScreencasterCpmRow[] => {
  const q = fold(query);
  if (q === '') return [...rows];
  return rows.filter((r) =>
    [r.company_name ?? '', r.contact_name, r.email].some((field) => fold(field).includes(q)),
  );
};

export const toggleSelected = (selected: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/** « Tout sélectionner » — adds or removes the FILTERED rows, leaving other selections alone. */
export const setFilteredSelected = (
  selected: ReadonlySet<string>,
  filtered: readonly ScreencasterCpmRow[],
  on: boolean,
): Set<string> => {
  const next = new Set(selected);
  for (const r of filtered) {
    if (on) next.add(r.id);
    else next.delete(r.id);
  }
  return next;
};

export const allFilteredSelected = (
  selected: ReadonlySet<string>,
  filtered: readonly ScreencasterCpmRow[],
): boolean => filtered.length > 0 && filtered.every((r) => selected.has(r.id));

/** How many drafts the change will re-price (Σ draft_count of the selected screencasters). */
export const draftsAffected = (
  rows: readonly ScreencasterCpmRow[],
  selected: ReadonlySet<string>,
): number => rows.reduce((sum, r) => (selected.has(r.id) ? sum + r.draft_count : sum), 0);

/** A parsed rate field: no input, an unusable value, more than 3 decimals (api: `numeric(10,3)`),
 * or a usable finite strictly-positive number. */
type ParsedRate =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'too-many-decimals' }
  | { kind: 'value'; value: number };

const parseRate = (input: string): ParsedRate => {
  const trimmed = input.trim();
  if (trimmed === '') return { kind: 'empty' };
  const normalized = trimmed.replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return { kind: 'invalid' };
  const decimals = normalized.split('.')[1];
  if (decimals !== undefined && decimals.length > 3) return { kind: 'too-many-decimals' };
  return { kind: 'value', value: n };
};

export const composeScreencasterCpmPatch = (
  ids: readonly string[],
  standardInput: string,
  eventInput: string,
): { ok: true; body: ScreencasterCpmPatch } | { ok: false; error: string } => {
  if (ids.length === 0) return { ok: false, error: 'Sélectionnez au moins un screencaster' };
  const standard = parseRate(standardInput);
  const event = parseRate(eventInput);
  if (standard.kind === 'invalid' || event.kind === 'invalid') {
    return { ok: false, error: 'Le CPM doit être un nombre strictement positif' };
  }
  if (standard.kind === 'too-many-decimals' || event.kind === 'too-many-decimals') {
    return { ok: false, error: 'Le CPM doit avoir au plus 3 décimales' };
  }
  if (standard.kind === 'empty' && event.kind === 'empty') {
    return { ok: false, error: 'Saisissez au moins un CPM' };
  }
  return {
    ok: true,
    body: {
      user_ids: [...ids],
      ...(standard.kind === 'value' ? { standard_cpm_tnd: standard.value } : {}),
      ...(event.kind === 'value' ? { event_cpm_tnd: event.value } : {}),
    },
  };
};
