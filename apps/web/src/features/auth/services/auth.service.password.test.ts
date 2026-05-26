import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiClient } from '@/lib/api-client';

import { authService } from './auth.service';

// Stub supabase (authService imports it for the remaining deferred methods) + clean apiClient mock
// (F1 carry-forward — no real-module spread).
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/api-client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api-client')>();
  return {
    ApiError: actual.ApiError,
    apiClient: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      postForm: vi.fn(),
      onUnauthorized: vi.fn(),
    },
  };
});

const post = vi.mocked(apiClient.post);

describe('authService password — the 3 flows (Phase-1f F6)', () => {
  beforeEach(() => post.mockReset());

  it('resetPassword(email) → POST /password/reset-request {email}', async () => {
    post.mockResolvedValue(undefined);
    await authService.resetPassword('user@example.com');
    expect(post).toHaveBeenCalledWith('/password/reset-request', { email: 'user@example.com' });
  });

  it('confirmPasswordReset(token, newPassword) → POST /password/reset {token, new_password}', async () => {
    post.mockResolvedValue(undefined);
    await authService.confirmPasswordReset('reset-token-xyz', 'Abcdefgh1234');
    expect(post).toHaveBeenCalledWith('/password/reset', {
      token: 'reset-token-xyz',
      new_password: 'Abcdefgh1234',
    });
  });

  it('updatePasswordWithOld(cur, new) → POST /password/change {current_password, new_password}', async () => {
    post.mockResolvedValue(undefined);
    await authService.updatePasswordWithOld('OldPass1234A', 'NewPass5678B');
    expect(post).toHaveBeenCalledWith('/password/change', {
      current_password: 'OldPass1234A',
      new_password: 'NewPass5678B',
    });
  });

  it('resetPassword failure → throws a French message', async () => {
    post.mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK', message: '' }));
    await expect(authService.resetPassword('x@y.z')).rejects.toThrow(/connexion/i);
  });

  it('confirmPasswordReset(invalid token) → INVALID_TOKEN → French message', async () => {
    post.mockRejectedValueOnce(new ApiError({ status: 400, code: 'INVALID_TOKEN', message: '' }));
    await expect(authService.confirmPasswordReset('bad', 'Abcdefgh1234')).rejects.toThrow(
      /lien.*invalide|expiré/i,
    );
  });

  it('updatePasswordWithOld(wrong current) → INVALID_CREDENTIALS → French message', async () => {
    post.mockRejectedValueOnce(
      new ApiError({ status: 400, code: 'INVALID_CREDENTIALS', message: '' }),
    );
    await expect(authService.updatePasswordWithOld('wrong', 'Abcdefgh1234')).rejects.toThrow(
      /incorrect/i,
    );
  });
});
