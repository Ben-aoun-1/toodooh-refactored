import { describe, expect, it } from 'vitest';

import {
  MATCH_NOTIFICATION_TYPE,
  matchAmountLabel,
  matchDateLabel,
  matchKey,
  matchKickoffLabel,
  matchOfNotification,
  matchSpotsBadge,
  matchSpotsHeading,
  matchTeams,
  spotDurationLabel,
  spotName,
} from './match-decision';

describe('the « Soir de match » popup rules (Mariem 05/11)', () => {
  it('a match notice opens its match and venue; anything else opens nothing', () => {
    expect(
      matchOfNotification({ kind: MATCH_NOTIFICATION_TYPE, eventId: 'e1', screenhostId: 's1' }),
    ).toEqual({ eventId: 'e1', screenhostId: 's1' });
    expect(matchOfNotification({ kind: MATCH_NOTIFICATION_TYPE, eventId: 'e1' })).toBeNull();
    expect(
      matchOfNotification({
        kind: 'dispatch_pending_acceptance',
        eventId: 'e1',
        screenhostId: 's1',
      }),
    ).toBeNull();
    expect(matchKey('e1', 's1')).toBe('e1:s1');
  });

  it('splits « A - B » into its two teams, not a soirée name', () => {
    expect(matchTeams('Arsenal - Manchester City')).toEqual(['Arsenal', 'Manchester City']);
    expect(matchTeams('Club Africain – Espérance de Tunis')).toEqual([
      'Club Africain',
      'Espérance de Tunis',
    ]);
    expect(matchTeams('PSG vs AS Roma')).toEqual(['PSG', 'AS Roma']);
    expect(matchTeams('Soirée Ligue des champions du mercredi 25 novembre 2026')).toBeNull();
    expect(matchTeams('Saint-Étienne - Paris FC')).toEqual(['Saint-Étienne', 'Paris FC']);
  });

  it('dates the kick-off in Tunis, whatever the browser zone', () => {
    // 20:00 UTC on 4 Nov = 21:00 in Tunis.
    expect(matchDateLabel('2026-11-04T20:00:00Z')).toBe('Mercredi 4 novembre 2026');
    expect(matchKickoffLabel('2026-11-04T20:00:00Z')).toBe('21:00');
    // 23:30 UTC on 4 Nov is already the 5th in Tunis.
    expect(matchDateLabel('2026-11-04T23:30:00Z')).toBe('Jeudi 5 novembre 2026');
  });

  it('writes the match total in millimes, as the mockup and the notice do', () => {
    // fr-FR separates thousands with a narrow no-break space.
    expect(matchAmountLabel(64.8)).toBe('64,800 TND');
    expect(matchAmountLabel(25)).toBe('25,000 TND');
    expect(matchAmountLabel(1234.5).replace(/\s/g, ' ')).toBe('1 234,500 TND');
  });

  it('counts the spots in the badge and the heading', () => {
    expect(matchSpotsBadge(3)).toBe('Total · 3 spots');
    expect(matchSpotsBadge(1)).toBe('Total · 1 spot');
    expect(matchSpotsHeading(3)).toBe('Spots à diffuser (3)');
    expect(matchSpotsHeading(1)).toBe('Spot à diffuser (1)');
  });

  it('labels a spot by its length and its name', () => {
    expect(spotDurationLabel(20)).toBe('00:20');
    expect(spotDurationLabel(75)).toBe('01:15');
    expect(spotDurationLabel(null)).toBe('—');
    expect(spotName({ title: 'Spot annonceur 1', filename: 'a.mp4' }, 0)).toBe('Spot annonceur 1');
    expect(spotName({ title: '  ', filename: 'a.mp4' }, 0)).toBe('a.mp4');
    expect(spotName(null, 2)).toBe('Spot 3');
  });
});
