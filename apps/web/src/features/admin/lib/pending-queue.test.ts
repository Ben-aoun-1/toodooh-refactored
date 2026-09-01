import { describe, expect, it } from 'vitest';

import {
  type PendingQueue,
  pendingBadgeLabel,
  pendingBadgeTitle,
  showPendingBadge,
} from './pending-queue';

// SIGN-4 — the admin queue badge. This repo has no render harness (vitest runs in the node
// environment; a .test.tsx executes ZERO tests), so the badge's rules live in this pure module and
// the component reads them from here — otherwise none of this could be asserted at all.
const q = (total: number, owners = 0): PendingQueue => ({ total, owners });

describe('showPendingBadge', () => {
  it('an empty queue is not news — nothing is rendered', () => {
    expect(showPendingBadge(q(0))).toBe(false);
  });

  it('one waiting account shows the badge', () => {
    expect(showPendingBadge(q(1))).toBe(true);
  });
});

describe('pendingBadgeLabel', () => {
  it('shows the count', () => {
    expect(pendingBadgeLabel(q(1))).toBe('1');
    expect(pendingBadgeLabel(q(42))).toBe('42');
  });

  it('caps at 99+ so a backlog never reflows the nav', () => {
    expect(pendingBadgeLabel(q(99))).toBe('99');
    expect(pendingBadgeLabel(q(100))).toBe('99+');
  });
});

describe('pendingBadgeTitle — the number says what it is', () => {
  it('names the Host share, which is what SIGN-4 was reported about', () => {
    expect(pendingBadgeTitle(q(3, 1))).toBe(
      '3 comptes en attente de validation, dont 1 établissement',
    );
    expect(pendingBadgeTitle(q(5, 2))).toBe(
      '5 comptes en attente de validation, dont 2 établissements',
    );
  });

  it('omits the Host clause when none are waiting', () => {
    expect(pendingBadgeTitle(q(2, 0))).toBe('2 comptes en attente de validation');
  });

  it('is singular for one', () => {
    expect(pendingBadgeTitle(q(1, 1))).toBe(
      '1 compte en attente de validation, dont 1 établissement',
    );
  });
});
