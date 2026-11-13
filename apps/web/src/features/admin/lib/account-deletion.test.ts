import { describe, expect, it } from 'vitest';

import { deletionBody, deletionSummary, deletionTotal } from './account-deletion';

describe('DEL-1 — admin account deletion rules', () => {
  it('needs a reason and the account email retyped (case-insensitive)', () => {
    expect(deletionBody(' Demande du client ', ' Client@Example.tn ', 'client@example.tn')).toEqual(
      {
        ok: true,
        value: { reason: 'Demande du client', confirm_email: 'Client@Example.tn' },
      },
    );
    expect(deletionBody('', 'client@example.tn', 'client@example.tn').ok).toBe(false);
    expect(deletionBody('Motif', 'autre@example.tn', 'client@example.tn').ok).toBe(false);
  });

  it('summarises what goes in French, biggest first', () => {
    expect(
      deletionSummary({ users: 1, campaigns: 2, creatives: 1, proof_of_play: 40, accounts: 1 }),
    ).toEqual(['40 preuves de diffusion', '2 campagnes', '1 spot']);
    expect(deletionSummary({ users: 1 })).toEqual([]);
    expect(deletionTotal({ users: 1, campaigns: 2 })).toBe(3);
  });
});
