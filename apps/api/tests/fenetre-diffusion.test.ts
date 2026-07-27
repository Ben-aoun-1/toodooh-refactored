import { describe, expect, it } from 'vitest';

import {
  BLOCS_POST_MATCH,
  BLOCS_PRE_MATCH,
  BLOC_MINUTES,
  FENETRE_MARGE_MS,
  SUGGESTED_MATCH_DURATION_HOURS,
  fenetreDiffusion,
  statutEvenement,
} from '../src/lib/fenetre-diffusion.js';

// EV1 — the ONE backend window function. The contract under exhaustive pin: window = kickoff − 1 h
// → end + 1 h; exactly SIX 20-minute blocs — three PRE ending AT kickoff, three POST starting AT
// the end, NONE during the match; pure instants (Tunis enters only at the display edges).

const MIN = 60 * 1000;

// A Tunis evening fixture on a NON-round kickoff (20:47 wall-clock) — the grid must anchor on the
// instants, never on round hours.
const KICKOFF = new Date('2026-08-05T20:47:00+01:00');
const ENDS = new Date('2026-08-05T22:39:00+01:00');

describe('fenetreDiffusion', () => {
  it('the window is exactly kickoff − 1 h → end + 1 h', () => {
    const f = fenetreDiffusion(KICKOFF, ENDS);
    expect(f.windowStart.getTime()).toBe(KICKOFF.getTime() - 60 * MIN);
    expect(f.windowEnd.getTime()).toBe(ENDS.getTime() + 60 * MIN);
    expect(FENETRE_MARGE_MS).toBe(60 * MIN);
  });

  it('exactly SIX 20-minute blocs: three avant, three après', () => {
    const f = fenetreDiffusion(KICKOFF, ENDS);
    expect(f.blocs).toHaveLength(6);
    expect(f.blocs.filter((b) => b.phase === 'avant')).toHaveLength(3);
    expect(f.blocs.filter((b) => b.phase === 'apres')).toHaveLength(3);
    expect(BLOCS_PRE_MATCH).toBe(3);
    expect(BLOCS_POST_MATCH).toBe(3);
    expect(BLOC_MINUTES).toBe(20);
    for (const b of f.blocs) expect(b.end.getTime() - b.start.getTime()).toBe(20 * MIN);
  });

  it('the pre-match grid ends exactly AT kickoff and is contiguous from window start', () => {
    const f = fenetreDiffusion(KICKOFF, ENDS);
    const pre = f.blocs.filter((b) => b.phase === 'avant');
    expect(pre[0]?.start.getTime()).toBe(KICKOFF.getTime() - 60 * MIN);
    expect(pre[0]?.end.getTime()).toBe(KICKOFF.getTime() - 40 * MIN);
    expect(pre[1]?.start.getTime()).toBe(KICKOFF.getTime() - 40 * MIN);
    expect(pre[1]?.end.getTime()).toBe(KICKOFF.getTime() - 20 * MIN);
    expect(pre[2]?.start.getTime()).toBe(KICKOFF.getTime() - 20 * MIN);
    expect(pre[2]?.end.getTime()).toBe(KICKOFF.getTime()); // the LAST pre bloc ends AT kickoff
  });

  it('the post-match grid starts exactly AT the end and is contiguous to window end', () => {
    const f = fenetreDiffusion(KICKOFF, ENDS);
    const post = f.blocs.filter((b) => b.phase === 'apres');
    expect(post[0]?.start.getTime()).toBe(ENDS.getTime()); // the FIRST post bloc starts AT the end
    expect(post[0]?.end.getTime()).toBe(ENDS.getTime() + 20 * MIN);
    expect(post[1]?.start.getTime()).toBe(ENDS.getTime() + 20 * MIN);
    expect(post[2]?.end.getTime()).toBe(ENDS.getTime() + 60 * MIN);
  });

  it('NO bloc overlaps the match itself', () => {
    const f = fenetreDiffusion(KICKOFF, ENDS);
    for (const b of f.blocs) {
      const outside = b.end.getTime() <= KICKOFF.getTime() || b.start.getTime() >= ENDS.getTime();
      expect(outside).toBe(true);
    }
  });

  it('is pure — the same instants always derive the same window', () => {
    const a = fenetreDiffusion(KICKOFF, ENDS);
    const b = fenetreDiffusion(new Date(KICKOFF), new Date(ENDS));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('refuses an inverted or zero-length event (the DB CHECK made it unrepresentable)', () => {
    expect(() => fenetreDiffusion(KICKOFF, KICKOFF)).toThrow();
    expect(() => fenetreDiffusion(ENDS, KICKOFF)).toThrow();
  });
});

describe('statutEvenement', () => {
  it('à venir strictly before kickoff; en cours from kickoff; terminé from the end', () => {
    expect(statutEvenement(new Date(KICKOFF.getTime() - 1), KICKOFF, ENDS)).toBe('a_venir');
    expect(statutEvenement(KICKOFF, KICKOFF, ENDS)).toBe('en_cours');
    expect(statutEvenement(new Date(KICKOFF.getTime() + 1), KICKOFF, ENDS)).toBe('en_cours');
    expect(statutEvenement(new Date(ENDS.getTime() - 1), KICKOFF, ENDS)).toBe('en_cours');
    expect(statutEvenement(ENDS, KICKOFF, ENDS)).toBe('termine');
    expect(statutEvenement(new Date(ENDS.getTime() + 1), KICKOFF, ENDS)).toBe('termine');
  });
});

describe('the suggested-match duration constant', () => {
  it('a suggestion runs kickoff + 2 h (the product constant, ONE home)', () => {
    expect(SUGGESTED_MATCH_DURATION_HOURS).toBe(2);
  });
});
