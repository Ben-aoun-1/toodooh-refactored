import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  adresseFormFrom,
  emptyPasswordForm,
  entrepriseFormFrom,
  notificationsFormFrom,
  responsableFormFrom,
  type ProfileFormInitialValues,
} from './profile-forms';

// CANCEL-NOOP1 (Mejri 07/09) — « Annuler » did nothing, with or without edits: four of the five
// buttons were `type="button"` with a className and NO onClick at all. Only Notifications reset.
// The button wiring is pinned by source-scan (apps/web has no render harness); the mapping the
// handlers use is unit-tested here so cancel provably lands where hydration first landed.

const PROFILE_SETTINGS = join(__dirname, '..', 'components', 'ProfileSettings.tsx');

const stripComments = (src: string): string =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every <button …>Annuler</button> element in the file, as written. */
const annulerButtons = (src: string): string[] =>
  src
    .split('<button')
    .slice(1)
    .filter((chunk) => /^[\s\S]{0,700}?>\s*(?:\{'\s*'\}\s*)?Annuler\s*</.test(chunk));

const saved: ProfileFormInitialValues = {
  last_name: 'Ben Aoun',
  first_name: 'Amine',
  fonction: 'Gérant',
  contact_phone: '+21612345678',
  business_name: 'Toodooh SARL',
  tax_number: '1234567AAA000',
  business_sector_id: 'sector-uuid',
  company_size: '50 - 100',
  number_of_screens: '4',
  number_of_rooms: '2',
  street_address: '12 rue de la Paix',
  city: 'Tunis',
  postal_code: '1000',
  governorate_id: 'gov-uuid',
  zone: 'Lac 2',
  notify_news_updates: true,
  notify_reminders_events: false,
  notify_promotions_offers: true,
};

describe('the Paramètres cancel mapping', () => {
  it('returns each form to its SAVED values, not to empty', () => {
    expect(responsableFormFrom(saved)).toEqual({
      last_name: 'Ben Aoun',
      first_name: 'Amine',
      fonction: 'Gérant',
      contact_phone: '+21612345678',
    });
    expect(entrepriseFormFrom(saved)).toEqual({
      business_name: 'Toodooh SARL',
      tax_number: '1234567AAA000',
      business_sector_id: 'sector-uuid',
      company_size: '50 - 100',
      number_of_screens: '4',
      number_of_rooms: '2',
    });
    expect(adresseFormFrom(saved)).toEqual({
      street_address: '12 rue de la Paix',
      city: 'Tunis',
      postal_code: '1000',
      governorate_id: 'gov-uuid',
      zone: 'Lac 2',
    });
    expect(notificationsFormFrom(saved)).toEqual({
      notify_news_updates: true,
      notify_reminders_events: false,
      notify_promotions_offers: true,
    });
  });

  it('carries a falsy saved value through — cancel must not resurrect a default', () => {
    // notify_reminders_events defaults to TRUE in useState; a user who saved it OFF must get OFF
    // back from Annuler, not the default.
    expect(notificationsFormFrom(saved).notify_reminders_events).toBe(false);
    const blank = { ...saved, fonction: '', zone: '' };
    expect(responsableFormFrom(blank).fonction).toBe('');
    expect(adresseFormFrom(blank).zone).toBe('');
  });

  it('clears the password sub-form, which has nothing saved to return to', () => {
    expect(emptyPasswordForm()).toEqual({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    });
  });

  it('builds a fresh object each call, so a reset cannot alias the previous state', () => {
    expect(emptyPasswordForm()).not.toBe(emptyPasswordForm());
    expect(adresseFormFrom(saved)).not.toBe(adresseFormFrom(saved));
  });
});

describe('the Annuler buttons (CANCEL-NOOP1)', () => {
  const src = stripComments(readFileSync(PROFILE_SETTINGS, 'utf8'));

  it('finds all five', () => {
    expect(annulerButtons(src)).toHaveLength(5);
  });

  it('every one of them resets something — none is inert', () => {
    const inert = annulerButtons(src).filter((button) => !button.includes('onClick'));
    expect(inert).toEqual([]);
  });

  it('hydration and cancel share ONE mapping, so they cannot drift', () => {
    expect(src).toContain("from '@/features/profile/lib/profile-forms'");
    for (const builder of [
      'responsableFormFrom',
      'entrepriseFormFrom',
      'adresseFormFrom',
      'notificationsFormFrom',
    ]) {
      // once in the hydration effect, once in that form's cancel handler
      expect(src.split(builder).length - 1).toBeGreaterThanOrEqual(2);
    }
  });
});
