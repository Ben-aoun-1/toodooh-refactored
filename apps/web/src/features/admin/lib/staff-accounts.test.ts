import { describe, expect, it } from 'vitest';

import type { AdminAccount, StaffRole } from '@/features/admin/types/admin';

import {
  canDeactivate,
  canReactivate,
  filterStaffAccounts,
  isAgentRole,
  mergeStaffAccounts,
  STAFF_ROLE_LABELS,
  visibleStaffRoles,
} from './staff-accounts';

// ADM-FIX1 — the merged Administrateurs listing (admins + agents). apps/web has no render harness,
// so the page's rules are asserted here, on the pure functions the page calls.
const account = (over: Partial<AdminAccount> & { id: string; role: StaffRole }): AdminAccount => ({
  email: `${over.id}@example.com`,
  contact_name: 'Amine Ben Aoun',
  first_name: 'Amine',
  last_name: 'Ben Aoun',
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  ...over,
});

const superadmin = account({
  id: 'sa',
  role: 'superadmin',
  created_at: '2026-01-01T00:00:00.000Z',
});
const admin = account({ id: 'ad', role: 'admin', created_at: '2026-03-01T00:00:00.000Z' });
const host = account({
  id: 'sh',
  role: 'screenhost_agent',
  contact_name: 'Sami Host',
  created_at: '2026-02-01T00:00:00.000Z',
});
const cast = account({
  id: 'sc',
  role: 'screencast_agent',
  contact_name: 'Rim Cast',
  created_at: '2026-04-01T00:00:00.000Z',
  is_active: false,
});

describe('STAFF_ROLE_LABELS', () => {
  it('names the four internal roles in French', () => {
    expect(STAFF_ROLE_LABELS).toEqual({
      superadmin: 'Super Administrateur',
      admin: 'Administrateur',
      screenhost_agent: 'Agent ScreenHost',
      screencast_agent: 'Agent ScreenCast',
    });
  });

  it('isAgentRole covers exactly the two agent roles', () => {
    expect(isAgentRole('screenhost_agent')).toBe(true);
    expect(isAgentRole('screencast_agent')).toBe(true);
    expect(isAgentRole('admin')).toBe(false);
    expect(isAgentRole('superadmin')).toBe(false);
  });
});

describe('visibleStaffRoles', () => {
  it('a superadmin filters over all four roles', () => {
    expect(visibleStaffRoles('superadmin')).toEqual([
      'superadmin',
      'admin',
      'screenhost_agent',
      'screencast_agent',
    ]);
  });

  it('an admin filters over the agent roles only (the staff listing is superadmin-only)', () => {
    expect(visibleStaffRoles('admin')).toEqual(['screenhost_agent', 'screencast_agent']);
    expect(visibleStaffRoles(null)).toEqual(['screenhost_agent', 'screencast_agent']);
  });
});

describe('mergeStaffAccounts', () => {
  it('interleaves the two sources into ONE newest-first list', () => {
    const merged = mergeStaffAccounts([admin, superadmin], [cast, host]);
    expect(merged.map((a) => a.id)).toEqual(['sc', 'ad', 'sh', 'sa']);
  });

  it('an empty staff source (an admin actor) leaves the agents in order', () => {
    expect(mergeStaffAccounts([], [cast, host]).map((a) => a.id)).toEqual(['sc', 'sh']);
  });
});

describe('filterStaffAccounts', () => {
  const all = mergeStaffAccounts([admin, superadmin], [cast, host]);

  it('matches the name or the email, case-insensitively', () => {
    expect(filterStaffAccounts(all, { search: 'RIM', role: 'all' }).map((a) => a.id)).toEqual([
      'sc',
    ]);
    expect(
      filterStaffAccounts(all, { search: 'sh@example', role: 'all' }).map((a) => a.id),
    ).toEqual(['sh']);
  });

  it('filters on an agent role as well as a staff role', () => {
    expect(
      filterStaffAccounts(all, { search: '', role: 'screenhost_agent' }).map((a) => a.id),
    ).toEqual(['sh']);
    expect(filterStaffAccounts(all, { search: '', role: 'admin' }).map((a) => a.id)).toEqual([
      'ad',
    ]);
  });

  it('« all » with a blank search keeps every row', () => {
    expect(filterStaffAccounts(all, { search: '   ', role: 'all' })).toHaveLength(4);
  });
});

describe('canDeactivate / canReactivate', () => {
  it('a superadmin acts on a staff admin only', () => {
    expect(canDeactivate(admin, 'superadmin')).toBe(true);
    expect(canReactivate(admin, 'superadmin')).toBe(true);
    expect(canDeactivate(superadmin, 'superadmin')).toBe(false);
  });

  it('the agent rows are read-only — unban refuses a non-admin target (409)', () => {
    expect(canDeactivate(host, 'superadmin')).toBe(false);
    expect(canDeactivate(cast, 'admin')).toBe(false);
    expect(canReactivate(cast, 'superadmin')).toBe(false);
  });

  it('a plain admin never acts on a peer admin (the ban route 403s a staff target)', () => {
    expect(canDeactivate(admin, 'admin')).toBe(false);
    expect(canReactivate(admin, 'admin')).toBe(false);
  });
});
