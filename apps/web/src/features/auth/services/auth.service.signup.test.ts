import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SignUpData } from '@/features/auth/types/auth';
import { ApiError, apiClient } from '@/lib/api-client';

import { authService } from './auth.service';

// Stub supabase (authService still imports it for deferred methods) + clean apiClient mock object
// (F1 carry-forward — no real-module spread, which double-observes rejected promises).
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/api-client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api-client')>();
  return {
    ApiError: actual.ApiError,
    apiClient: {
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(),
      postForm: vi.fn(),
      onUnauthorized: vi.fn(),
    },
  };
});

const post = vi.mocked(apiClient.post);
const ok = { userId: 'u1', email: 'a@b.c', verificationRequired: true, message: 'ok' };

// A complete advertiser payload (all SignUpData required fields) + files + owner-extras that must be
// dropped, + blank optionals that must be omitted (not sent as '').
const advertiser: SignUpData = {
  email: 'a@b.c',
  password: 'Abcdefgh1234',
  business_name: 'Acme',
  tax_number: 'AB1234567',
  business_sector_id: '11111111-1111-1111-1111-111111111111',
  business_type: 'local',
  profile_type: 'advertiser',
  contact_name: 'Alice Smith',
  contact_phone: '+21612345678',
  street_address: '1 rue X',
  city: 'Tunis',
  postal_code: '1000',
  governorate_id: '22222222-2222-2222-2222-222222222222',
  agent_toodooh: 'AG-9',
  zone: '', // blank optional → must be omitted
  fonction: '', // blank optional → must be omitted
  company_size: '50 - 100', // owner-extra → dropped
  number_of_screens: 5, // owner-extra → dropped
  cin: 'X', // owner-extra → dropped
  registration_doc: {} as unknown as File, // file → dropped
  company_logo: {} as unknown as File, // file → dropped
  terms_accepted: true,
};

const body = () => post.mock.calls[0][1] as Record<string, unknown>;

describe('authService.signUp → POST /signup (Phase-1f F2)', () => {
  beforeEach(() => post.mockReset());

  it('sends the accepted-fields JSON with profile_type (server-mapped)', async () => {
    post.mockResolvedValue(ok);
    await authService.signUp(advertiser);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('/signup');
    expect(body()).toMatchObject({
      email: 'a@b.c',
      password: 'Abcdefgh1234',
      contact_name: 'Alice Smith',
      business_name: 'Acme',
      contact_phone: '+21612345678',
      terms_accepted: true,
      profile_type: 'advertiser',
      business_type: 'local',
      business_sector_id: '11111111-1111-1111-1111-111111111111',
      street_address: '1 rue X',
      city: 'Tunis',
      postal_code: '1000',
      governorate_id: '22222222-2222-2222-2222-222222222222',
      tax_number: 'AB1234567',
      agent_toodooh: 'AG-9',
    });
  });

  it('drops files + owner-extras (never in the payload)', async () => {
    post.mockResolvedValue(ok);
    await authService.signUp(advertiser);
    for (const k of [
      'registration_doc',
      'company_logo',
      'bank_doc',
      'cin',
      'formule',
      'company_size',
      'number_of_screens',
      'number_of_rooms',
      'fleet_establishments',
    ]) {
      expect(body()).not.toHaveProperty(k);
    }
  });

  it('omits blank optionals (not sent as empty strings)', async () => {
    post.mockResolvedValue(ok);
    await authService.signUp(advertiser);
    expect(body()).not.toHaveProperty('zone');
    expect(body()).not.toHaveProperty('fonction');
  });

  it('omits tax_number when blank; includes it when present (owner)', async () => {
    post.mockResolvedValue(ok);
    await authService.signUp({ ...advertiser, tax_number: '   ' });
    expect(body()).not.toHaveProperty('tax_number');

    post.mockReset();
    post.mockResolvedValue(ok);
    await authService.signUp({
      ...advertiser,
      profile_type: 'individual_owner',
      tax_number: 'OWNER123',
    });
    expect(body()).toMatchObject({ profile_type: 'individual_owner', tax_number: 'OWNER123' });
  });

  it('throws a French message when the POST fails', async () => {
    post.mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK', message: '' }));
    await expect(authService.signUp(advertiser)).rejects.toThrow(/connexion/i);
  });
});
