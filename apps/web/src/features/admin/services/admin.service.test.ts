import { describe, it, expect, vi, beforeEach } from 'vitest';

// ADM-ADM1 — every adminService call is on apps/api. Mock the apiClient and assert the call shapes.
const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: getMock, post: postMock } }));

import { adminService } from './admin.service';

const INPUT = {
  email: 'agent@example.com',
  password: 'a-strong-pass-12',
  contact_name: 'Agent One',
  role: 'screenhost_agent' as const,
};

const ACCOUNT = {
  id: 'u1',
  email: 'staff@example.com',
  contact_name: 'Staff One',
  first_name: 'Staff',
  last_name: 'One',
  role: 'admin',
  is_active: true,
  created_at: '2026-08-01T00:00:00.000Z',
};

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
});

describe('adminService.createAdmin', () => {
  it('POSTs /admin/accounts with the internal-account payload and returns the account', async () => {
    const account = {
      id: 'u1',
      email: INPUT.email,
      role: 'screenhost_agent',
      status: 'approved',
      contact_name: 'Agent One',
      email_verified: true,
    };
    postMock.mockResolvedValue({ account });

    const result = await adminService.createAdmin(INPUT);

    expect(postMock).toHaveBeenCalledWith('/admin/accounts', INPUT);
    expect(result).toEqual(account);
  });

  it('propagates apiClient errors (no swallow → the page surfaces the server message)', async () => {
    postMock.mockRejectedValue(new Error('An account with this email already exists.'));
    await expect(adminService.createAdmin({ ...INPUT, role: 'admin' })).rejects.toThrow(
      'already exists',
    );
  });
});

describe('adminService staff-account lifecycle', () => {
  it('getAdmins GETs /admin/admins and unwraps the list', async () => {
    getMock.mockResolvedValue({ admins: [ACCOUNT] });
    await expect(adminService.getAdmins()).resolves.toEqual([ACCOUNT]);
    expect(getMock).toHaveBeenCalledWith('/admin/admins');
  });

  // ADM-FIX1 — the agent half of the Administrateurs listing.
  it('getAgents GETs /admin/agents and unwraps the list', async () => {
    const agent = {
      ...ACCOUNT,
      role: 'screenhost_agent',
      code: 'SH123456',
      export_status: 'synced',
    };
    getMock.mockResolvedValue({ agents: [agent] });
    await expect(adminService.getAgents()).resolves.toEqual([agent]);
    expect(getMock).toHaveBeenCalledWith('/admin/agents');
  });

  it('deactivateAdmin POSTs the EXISTING ban route with the motif', async () => {
    postMock.mockResolvedValue({ user: {} });
    await adminService.deactivateAdmin('u1', 'Départ de la société');
    expect(postMock).toHaveBeenCalledWith('/admin/users/u1/ban', { notes: 'Départ de la société' });
  });

  it('reactivateAdmin POSTs /admin/users/:id/unban and returns the account', async () => {
    postMock.mockResolvedValue({ account: ACCOUNT });
    await expect(adminService.reactivateAdmin('u1')).resolves.toEqual(ACCOUNT);
    expect(postMock).toHaveBeenCalledWith('/admin/users/u1/unban');
  });

  it('propagates a 409 from unban (end-user bans are terminal server-side)', async () => {
    postMock.mockRejectedValue(new Error('Only staff (admin) accounts can be reactivated'));
    await expect(adminService.reactivateAdmin('u2')).rejects.toThrow('Only staff');
  });
});
