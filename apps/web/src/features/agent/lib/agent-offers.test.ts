import { describe, expect, it } from 'vitest';

import {
  kickoffLabel,
  offerAnsweredToast,
  offerBadge,
  offerFacts,
  offerBanner,
  offerIdOfLink,
  offerTypeLabel,
  offerZoneLabel,
} from './agent-offers';

const base = { screenhost_name: 'toodooh', decidable: true } as const;

describe('agent spec VF §10 — the offer window', () => {
  it('reads the offer id from a notification link', () => {
    expect(offerIdOfLink('/agent?offre=abc-1')).toBe('abc-1');
    expect(offerIdOfLink('/agent/campagnes')).toBeNull();
    expect(offerIdOfLink('/agent?offre=')).toBeNull();
    expect(offerIdOfLink(null)).toBeNull();
  });

  it('badge: waiting, then who answered', () => {
    expect(offerBadge({ ...base, state: 'attente', answered_by: null })).toEqual({
      tone: 'wait',
      label: 'En attente de réponse',
    });
    expect(offerBadge({ ...base, state: 'acceptee', answered_by: 'vous' }).label).toBe(
      'Acceptée par vous',
    );
    expect(offerBadge({ ...base, state: 'acceptee', answered_by: 'screenhost' }).label).toBe(
      'Acceptée par toodooh',
    );
    expect(offerBadge({ ...base, state: 'refusee', answered_by: 'screenhost' })).toEqual({
      tone: 'red',
      label: 'Refusée par toodooh',
    });
  });

  it('banner: the rule while waiting, then who can no longer act', () => {
    expect(offerBanner({ ...base, state: 'attente', answered_by: null })).toEqual({
      tone: 'violet',
      text: "Vous pouvez répondre pour le compte de toodooh. Le premier qui répond, vous ou le Screenhost, décide ; l'autre est informé et ne peut plus agir.",
    });
    expect(offerBanner({ ...base, state: 'acceptee', answered_by: 'vous' }).text).toBe(
      'Vous avez répondu pour le compte de toodooh. Le Screenhost en a été informé et ne peut plus agir.',
    );
    expect(offerBanner({ ...base, state: 'refusee', answered_by: 'screenhost' }).text).toBe(
      'toodooh a déjà répondu à cette offre. Vous ne pouvez plus agir, vous êtes seulement informé.',
    );
    expect(
      offerBanner({ ...base, decidable: false, state: 'attente', answered_by: null }).tone,
    ).toBe('ok');
  });

  it('toast, zone and type', () => {
    expect(offerAnsweredToast(true, 'toodooh')).toBe(
      'Offre acceptée pour toodooh. Le Screenhost est informé.',
    );
    expect(offerAnsweredToast(false, 'toodooh')).toBe(
      'Offre refusée pour toodooh. Le Screenhost est informé.',
    );
    expect(offerZoneLabel([])).toBe('Tout le réseau');
    expect(offerZoneLabel(['Grand Tunis', 'Sousse'])).toBe('Grand Tunis, Sousse');
    expect(offerTypeLabel('standard')).toBe('Particuliers');
  });

  it('a match offer shows its kick-off and the spots the answer covers (Mariem 15/11)', () => {
    expect(offerTypeLabel('evenement')).toBe('Soir de match');
    expect(kickoffLabel('2027-09-15T19:00:00Z')).toBe('15/09/2027 à 20h00');
    const match = {
      kind: 'event' as const,
      campaign_type: 'evenement',
      zones: [],
      start_date: '2027-09-15',
      end_date: '2027-09-15',
      kickoff_at: '2027-09-15T19:00:00Z',
      spots: 3,
    };
    expect(offerFacts(match)).toEqual([
      { label: 'Type de la campagne', value: 'Soir de match' },
      { label: 'Coup d’envoi', value: '15/09/2027 à 20h00' },
      { label: 'Spots', value: '3 spots' },
    ]);
    expect(offerFacts({ ...match, spots: 1 })[2]?.value).toBe('1 spot');
    expect(
      offerFacts({ ...match, kind: 'campaign', campaign_type: 'standard', kickoff_at: null }).map(
        (f) => f.label,
      ),
    ).toEqual(['Type de la campagne', 'Zone', 'Début', 'Fin']);
  });
});
