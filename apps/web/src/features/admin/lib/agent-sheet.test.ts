import { describe, expect, it } from 'vitest';

import {
  EMPTY_AGENT_SHEET,
  affiliationIsLive,
  affiliationWindowLabel,
  CIN_MAX_BYTES,
  agentSheetPayload,
  cinProblem,
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

  // Spec VF §15 / §10 (Mariem 12/11/2026) — « Matricule fiscal : devient facultatif », both roles.
  it('the tax number is optional for both agent roles, and still checked when given', () => {
    const noTax = { ...full, tax_number: '' };
    expect(agentSheetPayload(noTax, 'screencast_agent').ok).toBe(true);
    expect(agentSheetPayload(noTax, 'screenhost_agent').ok).toBe(true);
    expect(agentSheetPayload({ ...full, tax_number: '12' }, 'screencast_agent').ok).toBe(false);
  });

  it('the CIN needs both sides, an image or a PDF, 5 MB at most', () => {
    const ok = { type: 'image/jpeg', size: 1000 };
    expect(cinProblem(null, ok)).toBe('La CIN recto est obligatoire.');
    expect(cinProblem(ok, null)).toBe('La CIN verso est obligatoire.');
    expect(cinProblem(ok, { type: 'application/pdf', size: 1000 })).toBeNull();
    expect(cinProblem(ok, { type: 'image/gif', size: 1000 })).toContain('CIN verso');
    expect(cinProblem({ type: 'image/png', size: CIN_MAX_BYTES + 1 }, ok)).toContain('5 Mo');
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
