import { describe, expect, it } from 'vitest';

import {
  offerAnsweredToast,
  offerBadge,
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
});
