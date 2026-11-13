import { env } from '../../env.js';

// EVT-ET1 — the API-Football (api-sports.io, v3) client: only the two reads the extra-time tracker
// needs. Every answer is narrowed by hand (no `any`): a fixture we cannot read is dropped, never
// guessed. One request per call — the free plan counts requests, not fixtures. What the FREE plan
// allows (checked on staging 2026-10-27): `date` (yesterday … tomorrow only), `id` (one fixture)
// and `live=all` (every live fixture worldwide); NOT `ids` (several at once).

export interface ApiFixture {
  id: number;
  /** Kick-off instant (ISO, as API-Football gives it). */
  date: string;
  /** API-Football status short code: NS, 1H, HT, 2H, ET, BT, P, FT, AET, PEN, PST, CANC… */
  status: string;
  home: string;
  away: string;
}

export const apiFootballEnabled = (): boolean => env.API_FOOTBALL_KEY !== undefined;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
/** obj[key] when obj is an object, else undefined — the one narrowing step. */
const field = (obj: unknown, key: string): unknown => (isRecord(obj) ? obj[key] : undefined);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** One API-Football fixture object → ApiFixture, or null when a field we rely on is missing. */
export const parseFixture = (raw: unknown): ApiFixture | null => {
  const fixture = field(raw, 'fixture');
  const teams = field(raw, 'teams');
  const id = field(fixture, 'id');
  const status = str(field(field(fixture, 'status'), 'short'));
  const home = str(field(field(teams, 'home'), 'name'));
  const away = str(field(field(teams, 'away'), 'name'));
  const date = str(field(fixture, 'date'));
  if (typeof id !== 'number' || !status || !home || !away || !date) return null;
  return { id, date, status, home, away };
};

/** The response envelope → fixtures; API-level errors (quota, bad key) throw with their text. */
export const parseFixturesResponse = (body: unknown): ApiFixture[] => {
  if (!isRecord(body)) throw new Error('API-Football: unexpected response');
  const errors = field(body, 'errors');
  if (isRecord(errors) && Object.keys(errors).length > 0) {
    throw new Error(`API-Football: ${JSON.stringify(errors)}`);
  }
  const response = field(body, 'response');
  const list: unknown[] = Array.isArray(response) ? response : [];
  return list.flatMap((item) => {
    const f = parseFixture(item);
    return f ? [f] : [];
  });
};

const get = async (path: string, query: Record<string, string>): Promise<ApiFixture[]> => {
  const key = env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API-Football: API_FOOTBALL_KEY is not set');
  const url = new URL(path, env.API_FOOTBALL_BASE_URL);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { 'x-apisports-key': key },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`API-Football: HTTP ${res.status}`);
  return parseFixturesResponse((await res.json()) as unknown);
};

/** Every fixture of a calendar day (Tunis), worldwide — one request. */
export const fixturesOnDate = (day: string): Promise<ApiFixture[]> =>
  get('/fixtures', { date: day, timezone: 'Africa/Tunis' });

/** Every fixture being played right now, worldwide — one request for all followed matches. */
export const liveFixtures = (): Promise<ApiFixture[]> => get('/fixtures', { live: 'all' });

/** One fixture's current state (a match no longer live: its final status) — one request. */
export const fixtureById = async (id: number): Promise<ApiFixture | null> =>
  (await get('/fixtures', { id: String(id) }))[0] ?? null;
