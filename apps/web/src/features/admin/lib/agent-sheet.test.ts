import { describe, expect, it } from 'vitest';

import {
  EMPTY_AGENT_SHEET,
  affiliationIsLive,
  affiliationWindowLabel,
  agentSheetPayload,
  onboardingLabel,
} from './agent-sheet';

const full = {
  ...EMPTY_AGENT_SHEET,
  phone: '+216 12 345 678',
  tax_number: '1234567ABC000',
  street_address: '1 rue de Marseille',
  city: 'Tunis',
  postal_code: '1000',
  governorate_id: 'g1',
  covered_zone: 'Grand Tunis',
  certified_at: '2026-10-01',
};

describe('AGT-1 — the agent sheet at creation', () => {
  it('maps a complete sheet to the api fields (rate omitted = engine default)', () => {
    expect(agentSheetPayload(full, 'screencast_agent')).toEqual({
      ok: true,
      value: {
        phone: '+21612345678',
        tax_number: '1234567ABC000',
        street_address: '1 rue de Marseille',
        city: 'Tunis',
        postal_code: '1000',
        governorate_id: 'g1',
        covered_zone: 'Grand Tunis',
        certified_at: '2026-10-01',
      },
    });
  });

  it('the tax number is required for a Screencaster agent only', () => {
    const noTax = { ...full, tax_number: '' };
    expect(agentSheetPayload(noTax, 'screencast_agent').ok).toBe(false);
    expect(agentSheetPayload(noTax, 'screenhost_agent').ok).toBe(true);
  });

  it('refuses a bad phone, postal code, missing zone and a bad rate; takes a French comma', () => {
    expect(agentSheetPayload({ ...full, phone: '12345' }, 'screenhost_agent').ok).toBe(false);
    expect(agentSheetPayload({ ...full, postal_code: '10' }, 'screenhost_agent').ok).toBe(false);
    expect(agentSheetPayload({ ...full, covered_zone: ' ' }, 'screenhost_agent').ok).toBe(false);
    expect(agentSheetPayload({ ...full, commission_pct: '101' }, 'screenhost_agent').ok).toBe(
      false,
    );
    const r = agentSheetPayload({ ...full, commission_pct: '3,5' }, 'screenhost_agent');
    expect(r.ok && r.value.commission_pct).toBe(3.5);
  });

  it('onboarding progress label', () => {
    expect(onboardingLabel(null)).toBe('—');
    expect(onboardingLabel({ done: 2, steps: [1, 2, 3, 4], complete: false })).toBe(
      '2 étapes sur 4',
    );
    expect(onboardingLabel({ done: 3, steps: [1, 2, 3, 4], complete: true })).toBe('Terminé');
  });
});

describe('AGT-2 — affiliation labels', () => {
  it('shows the 24-month window in French dates, or the pending activation', () => {
    expect(affiliationWindowLabel('2026-09-03', '2028-09-03')).toBe('03/09/2026 → 03/09/2028');
    expect(affiliationWindowLabel(null, null)).toBe('Démarre à la première campagne terminée');
  });

  it('only live affiliations take hub actions', () => {
    expect(affiliationIsLive('en_cours')).toBe(true);
    expect(affiliationIsLive('en_attente_activation')).toBe(true);
    expect(affiliationIsLive('terminee')).toBe(false);
    expect(affiliationIsLive('exclue')).toBe(false);
  });
});
