import { describe, expect, it } from 'vitest';

import {
  SUPPORT_COMMENT_LABEL,
  SUPPORT_OBJECTIVES,
  isAutreObjective,
  supportPayloadError,
} from './support-form';

// SUP-1 — the support forms finally send; these pins are the client-side rules and the copy Mejri
// named (11/09 point 8).
describe('support form rules', () => {
  it('nine objectives, « Autre » last', () => {
    expect(SUPPORT_OBJECTIVES).toHaveLength(9);
    expect(SUPPORT_OBJECTIVES[SUPPORT_OBJECTIVES.length - 1]).toBe('Autre');
    expect(isAutreObjective(' autre ')).toBe(true);
  });

  it('« Autre » needs a detail; an appointment needs a date; otherwise valid', () => {
    expect(supportPayloadError({ kind: 'support', objective: '' })).toBe('Choisissez un objectif.');
    expect(supportPayloadError({ kind: 'support', objective: 'Autre' })).toBe(
      'Veuillez préciser dans la description',
    );
    expect(
      supportPayloadError({ kind: 'support', objective: 'Autre', other_detail: 'x' }),
    ).toBeNull();
    expect(supportPayloadError({ kind: 'appointment', objective: 'Budget' })).toBe(
      'Choisissez un créneau.',
    );
    expect(
      supportPayloadError({
        kind: 'appointment',
        objective: 'Budget',
        appointment_date: '2026-10-01',
      }),
    ).toBeNull();
  });

  it('the label is plural', () => {
    expect(SUPPORT_COMMENT_LABEL).toBe('Commentaires additionnels');
  });
});
