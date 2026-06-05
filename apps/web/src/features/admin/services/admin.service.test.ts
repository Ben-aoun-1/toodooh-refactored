import { describe, it, expect, vi, beforeEach } from 'vitest';

// Slice-2 A: createAdmin is repointed onto the apps/api endpoint. Mock the apiClient (assert the
// call shape) and stub supabase (admin.service still imports it for the not-yet-repointed methods —
// avoids constructing the real client at import).
const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { post: postMock } }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { adminService } from './admin.service';

const INPUT = {
  email: 'agent@example.com',
  password: 'a-strong-pass-12',
  contact_name: 'Agent One',
  role: 'screenhost_agent' as const,
};

describe('adminService.createAdmin', () => {
  beforeEach(() => {
    postMock.mockReset();
  });

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
