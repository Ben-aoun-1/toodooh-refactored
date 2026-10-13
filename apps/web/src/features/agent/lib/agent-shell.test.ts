import { describe, expect, it } from 'vitest';

import {
  agentKindOf,
  agentPageHeading,
  agentSupportObjectives,
  onboardingProgress,
  onboardingStepCopy,
  passwordCriteria,
  passwordStrength,
  settingsTabOf,
} from './agent-shell';

const PAGES = ['dashboard', 'campaigns', 'calendar', 'affiliates', 'settings'] as const;

describe('AGT-1b — agent shell literals', () => {
  it('maps the roles', () => {
    expect(agentKindOf('screencast_agent')).toBe('screencaster');
    expect(agentKindOf('screenhost_agent')).toBe('screenhost');
    expect(agentKindOf('advertiser')).toBeNull();
  });

  it('final labels per page (spec §3), the greeting uses the first name', () => {
    expect(agentPageHeading('screencaster', 'dashboard', 'Sami').title).toBe('Bonjour, Sami');
    expect(agentPageHeading('screenhost', 'calendar', null).subtitle).toBe(
      'Définissez vos disponibilités et suivez vos rendez-vous avec vos Screenhosts affiliés',
    );
    expect(agentPageHeading('screenhost', 'affiliates', null).title).toBe(
      'Mes Screenhosts affiliés',
    );
  });

  it('vocabulary: no word from the other interface, no SPS, no dollar sign', () => {
    const sc = PAGES.flatMap((p) => Object.values(agentPageHeading('screencaster', p, 'X')))
      .concat(agentSupportObjectives('screencaster'))
      .join(' ');
    expect(sc).not.toMatch(/Screenhost|établissement|dispositif de diffusion|\$/);
    const sh = PAGES.flatMap((p) => Object.values(agentPageHeading('screenhost', p, 'X')))
      .concat(agentSupportObjectives('screenhost'))
      .join(' ');
    expect(sh).not.toMatch(
      /Screencasters affiliés|SPS|pénalité|sanction|dispositif de diffusion|\$/,
    );
  });

  it('onboarding steps open the right tab; RIB shows « En attente de validation »', () => {
    expect(onboardingStepCopy({ key: 'rib', done: false, mandatory: true, pending: true })).toEqual(
      {
        label: 'Téléverser mon RIB',
        status: 'En attente de validation',
        tab: 'legal',
      },
    );
    expect(onboardingStepCopy({ key: 'info', done: false, mandatory: true }).tab).toBe('profil');
    expect(onboardingProgress(2, 4)).toBe('2 étapes sur 4');
    expect(onboardingProgress(1, 4)).toBe('1 étape sur 4');
  });

  it('settings tab from the query string; password rule', () => {
    expect(settingsTabOf('legal')).toBe('legal');
    expect(settingsTabOf('nope')).toBe('profil');
    expect(passwordCriteria('Abcdefghi1')).toEqual({ length: true, upper: true, digit: true });
    expect(passwordStrength('abc')).toBe(0);
  });
});
