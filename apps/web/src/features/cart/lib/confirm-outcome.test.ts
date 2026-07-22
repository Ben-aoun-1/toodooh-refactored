import { describe, expect, it } from 'vitest';

import {
  APPROVED_SPOT_REASSURANCE,
  approvedSpotNotice,
  confirmSuccessMessage,
} from './confirm-outcome';

// CF-SK1 (ruling #9) — the confirm can resolve two ways at once; the copy must say which.

describe('confirmSuccessMessage — the mixed-outcome matrix', () => {
  it('MIXED: both groups named, launched first', () => {
    expect(confirmSuccessMessage({ launched: 1, pendingReview: 1 })).toBe(
      '1 campagne lancée, 1 en attente de validation.',
    );
    expect(confirmSuccessMessage({ launched: 2, pendingReview: 3 })).toBe(
      '2 campagnes lancées, 3 en attente de validation.',
    );
  });

  it('ALL-APPROVED: launched only — no false "en attente" promise', () => {
    expect(confirmSuccessMessage({ launched: 1, pendingReview: 0 })).toBe(
      '1 campagne lancée — diffusion programmée.',
    );
    expect(confirmSuccessMessage({ launched: 3, pendingReview: 0 })).toBe(
      '3 campagnes lancées — diffusion programmée.',
    );
  });

  it('ALL-NEW: the pre-CF-SK1 pending-only copy is preserved verbatim', () => {
    expect(confirmSuccessMessage({ launched: 0, pendingReview: 1 })).toBe(
      '1 campagne soumise — en attente de validation.',
    );
    expect(confirmSuccessMessage({ launched: 0, pendingReview: 2 })).toBe(
      '2 campagnes soumises — en attente de validation.',
    );
  });
});

describe('approvedSpotNotice — the Validation-step reassurance', () => {
  it('ONLY an approved spot earns the line', () => {
    expect(approvedSpotNotice('approved')).toBe(APPROVED_SPOT_REASSURANCE);
  });

  it.each(['pending', 'rejected', null, undefined])(
    'a %s spot promises nothing (the admin still has to bless it)',
    (status) => {
      expect(approvedSpotNotice(status)).toBeNull();
    },
  );

  it('the copy states the skip plainly', () => {
    expect(APPROVED_SPOT_REASSURANCE).toBe(
      'Spot déjà validé — votre campagne sera lancée dès la confirmation du panier.',
    );
  });
});
