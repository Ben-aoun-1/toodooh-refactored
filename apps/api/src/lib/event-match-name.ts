// SUGG-2 — the ONE comparison key of a match name, for the « Suggérer un match » duplicate gate
// (routes/events.ts). Official rows are typed by hand in the admin (« Libye - Tunisie », with a
// plain hyphen) while suggestions are minted « A – B » (en dash), so a raw case-insensitive
// comparison never saw an official twin: a suggestion of a catalogue match created a second
// entity for one real-world fixture. The key folds case, accents, the separator (-, –, —, vs) and
// spacing; it is only ever compared, never shown.

const SEPARATOR = /\s+(?:-|–|—|vs\.?|v\.?)\s+/i;

const fold = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** The comparison key of a stored event name: « libye|tunisie » for « Libye - Tunisie ». */
export const matchNameKey = (name: string): string => {
  const parts = fold(name).split(SEPARATOR);
  return parts.length === 2 ? `${parts[0]}|${parts[1]}` : fold(name);
};

/** The keys a suggestion of A vs B matches, in both team orders. */
export const fixtureKeys = (teamA: string, teamB: string): Set<string> => {
  const a = fold(teamA);
  const b = fold(teamB);
  return new Set([`${a}|${b}`, `${b}|${a}`]);
};
