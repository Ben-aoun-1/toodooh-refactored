import { describe, expect, it, vi } from 'vitest';

// The service module builds on apiClient — stubbed: only the pure CF-Q1 helpers are under test.
vi.mock('@/lib/api-client', () => ({ apiClient: {} }));

import {
  REJECT_ALLOCATION_CONFIRM,
  decisionNeedsConfirm,
  revenueLabel,
} from './screenhost-allocations.service';

// CF-Q1 — the owner's money leads each allocation card, and ONLY reject asks for confirmation.

describe('revenueLabel (spec 2.2 « en tête le montant qui me revient »)', () => {
  it('formats fr-FR with the TND unit', () => {
    expect(revenueLabel(412)).toBe('412 TND');
    expect(revenueLabel(1065.5)).toBe('1 065,5 TND'); // fr-FR NNBSP grouping
    expect(revenueLabel(0)).toBe('0 TND');
  });
});

describe('decisionNeedsConfirm (reject is consequential; accept stays one-click)', () => {
  it('asks only for reject', () => {
    expect(decisionNeedsConfirm('reject')).toBe(true);
    expect(decisionNeedsConfirm('accept')).toBe(false);
  });

  it('the confirmation copy is the ruled French message (no reattribution claim — no cascade yet)', () => {
    expect(REJECT_ALLOCATION_CONFIRM).toBe('Refuser cette campagne ? Cette action est définitive.');
  });
});
