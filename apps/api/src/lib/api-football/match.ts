import type { ApiFixture } from './client.js';

// EVT-ET1 (ruling 7.1 — AUTOMATIC) — which API-Football fixture is our event? Both teams must
// match (either order) and the kick-off must agree (within 30 min, or the same Tunis day when our
// kick-off time is still « à confirmer »). Team names are compared on a folded form — case,
// accents, punctuation and club boilerplate (FC, AS, Club…) dropped — and two names match when
// equal, when one contains the other, or when they share a distinctive word (« Bayern Munich » /
// « Bayern München »). Requiring BOTH teams AND the kick-off keeps that tolerance safe. An event
// that matches several fixtures, or none, stays unlinked.

const BOILERPLATE = new Set([
  'fc',
  'cf',
  'ac',
  'as',
  'sc',
  'ss',
  'ssc',
  'us',
  'cs',
  'ca',
  'afc',
  'bv',
  'vfb',
  'vfl',
  'rc',
  'rcd',
  'club',
  'de',
  'du',
  'la',
  'le',
  'les',
  'el',
  'al',
  'the',
  'of',
  'and',
  'et',
  'sporting',
  'football',
]);

export const foldTeam = (name: string): string[] =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !BOILERPLATE.has(w));

export const sameTeam = (a: string, b: string): boolean => {
  const x = foldTeam(a);
  const y = foldTeam(b);
  if (x.length === 0 || y.length === 0) return false;
  const xs = x.join(' ');
  const ys = y.join(' ');
  if (xs === ys || xs.includes(ys) || ys.includes(xs)) return true;
  return x.some((w) => w.length >= 4 && y.includes(w));
};

const SEPARATOR = /\s+(?:-|–|—|vs\.?|v\.?)\s+/i;

/** Our event's two teams: its single catalogue match, else « A - B » in its name; else null. */
export const eventTeams = (
  name: string,
  matches: readonly { home: string; away: string | null }[],
): [string, string] | null => {
  if (matches.length === 1 && matches[0]?.away) return [matches[0].home, matches[0].away];
  if (matches.length > 1) return null; // a multi-match evening is not one fixture
  const parts = name.split(SEPARATOR);
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0].trim(), parts[1].trim()] : null;
};

const KICKOFF_TOLERANCE_MS = 30 * 60_000;

const tunisDay = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(d);

export const matchFixture = (
  event: { teams: [string, string]; kickoffAt: Date; timeTbc: boolean },
  fixtures: readonly ApiFixture[],
): ApiFixture | null => {
  const [a, b] = event.teams;
  const candidates = fixtures.filter((f) => {
    const teamsOk =
      (sameTeam(a, f.home) && sameTeam(b, f.away)) || (sameTeam(a, f.away) && sameTeam(b, f.home));
    if (!teamsOk) return false;
    const kickoff = new Date(f.date);
    if (Number.isNaN(kickoff.getTime())) return false;
    return event.timeTbc
      ? tunisDay(kickoff) === tunisDay(event.kickoffAt)
      : Math.abs(kickoff.getTime() - event.kickoffAt.getTime()) <= KICKOFF_TOLERANCE_MS;
  });
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
};
