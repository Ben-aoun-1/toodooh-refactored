import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeUser } from '@/features/auth/types/auth';
import { ApiError, apiClient } from '@/lib/api-client';

import { authService } from './auth.service';

// Stub supabase (authService imports it for deferred methods) + clean apiClient mock (F1
// carry-forward — no real-module spread).
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

const patch = vi.mocked(apiClient.patch);
const get = vi.mocked(apiClient.get);
const postForm = vi.mocked(apiClient.postForm);

const meUser: MeUser = {
  id: 'u1',
  email: 'a@b.c',
  email_verified: true,
  role: 'advertiser',
  status: 'approved',
  onboarding_completed: true,
  profile_type: 'advertiser',
  contact_name: 'Alice',
  business_name: 'Acme',
  tax_number: 'AB1234567',
  contact_phone: '+21612345678',
  fonction: 'Gérant',
  business_sector_id: 's1',
  business_type: 'local',
  street_address: '1 rue',
  city: 'Tunis',
  postal_code: '1000',
  governorate_id: 'g1',
  zone: null,
  documents: { registration: false, cin: false },
  notifications: { news_updates: true, reminders_events: false, promotions_offers: true },
};

describe('authService profile section saves (F4a)', () => {
  beforeEach(() => {
    patch.mockReset();
    get.mockReset();
  });

  it('updateProfileContact → PATCH /profile/contact', async () => {
    patch.mockResolvedValue(undefined);
    await authService.updateProfileContact({
      contact_name: 'X',
      contact_phone: '+21611111111',
      fonction: null,
    });
    expect(patch).toHaveBeenCalledWith('/profile/contact', {
      contact_name: 'X',
      contact_phone: '+21611111111',
      fonction: null,
    });
  });

  it('updateProfileBusiness → PATCH /profile/business (owner-extras forwarded; backend strips)', async () => {
    patch.mockResolvedValue(undefined);
    await authService.updateProfileBusiness({
      business_name: 'Acme',
      business_sector_id: undefined,
      company_size: '0 - 10',
    });
    expect(patch).toHaveBeenCalledWith('/profile/business', {
      business_name: 'Acme',
      business_sector_id: undefined,
      company_size: '0 - 10',
    });
  });

  it('updateProfileAddress → PATCH /profile/address', async () => {
    patch.mockResolvedValue(undefined);
    await authService.updateProfileAddress({
      street_address: '1 rue',
      city: 'Tunis',
      postal_code: '1000',
      governorate_id: undefined,
    });
    expect(patch).toHaveBeenCalledWith(
      '/profile/address',
      expect.objectContaining({ city: 'Tunis', postal_code: '1000' }),
    );
  });

  it('updateProfileNotifications → PATCH /profile/notifications', async () => {
    patch.mockResolvedValue(undefined);
    await authService.updateProfileNotifications({
      notify_news_updates: true,
      notify_reminders_events: false,
      notify_promotions_offers: true,
    });
    expect(patch).toHaveBeenCalledWith('/profile/notifications', {
      notify_news_updates: true,
      notify_reminders_events: false,
      notify_promotions_offers: true,
    });
  });

  it('a section save throws a French message on failure', async () => {
    patch.mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK', message: '' }));
    await expect(authService.updateProfileContact({ contact_name: 'X' })).rejects.toThrow(
      /connexion/i,
    );
  });
});

describe('authService.getBusinessProfile (F4a — /api/me read bridge)', () => {
  beforeEach(() => {
    patch.mockReset();
    get.mockReset();
  });

  it('maps /api/me → BusinessProfile: section fields, notifications FLATTENED, status mapped', async () => {
    get.mockResolvedValue({ user: meUser });
    const p = await authService.getBusinessProfile();
    expect(get).toHaveBeenCalledWith('/me', { skipAuthRedirect: true });
    expect(p?.contact_name).toBe('Alice');
    expect(p?.business_name).toBe('Acme');
    expect(p?.street_address).toBe('1 rue');
    // notifications nested → flat (the one structural transform)
    expect(p?.notify_news_updates).toBe(true);
    expect(p?.notify_reminders_events).toBe(false);
    expect(p?.notify_promotions_offers).toBe(true);
    // status → verification_status (approved → verified)
    expect(p?.verification_status).toBe('verified');
    // deferred fields absent (no backend columns)
    expect(p?.logo_url).toBeUndefined();
    expect(p?.bank_rib).toBeUndefined();
    // F5 — document presence is a direct map of /api/me's booleans (no sentinel; _doc_url undefined)
    expect(p?.documents).toEqual({ registration: false, cin: false });
    expect(p?.registration_doc_url).toBeUndefined();
  });

  it('401 → null (logged out)', async () => {
    get.mockRejectedValueOnce(new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: '' }));
    await expect(authService.getBusinessProfile()).resolves.toBeNull();
  });

  it('non-401 → throws a French message', async () => {
    get.mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK', message: '' }));
    await expect(authService.getBusinessProfile()).rejects.toThrow(/connexion/i);
  });
});

describe('authService documents (F5 — multipart upload + on-demand view)', () => {
  beforeEach(() => {
    postForm.mockReset();
    get.mockReset();
  });

  it('uploadProfileDocument(rne) → POST /profile/documents/rne with the file in FormData', async () => {
    postForm.mockResolvedValue({ type: 'rne', key: 'rne/u1' });
    const file = new File(['x'], 'rc.pdf', { type: 'application/pdf' });
    await authService.uploadProfileDocument('rne', file);
    expect(postForm).toHaveBeenCalledTimes(1);
    expect(postForm.mock.calls[0][0]).toBe('/profile/documents/rne');
    const form = postForm.mock.calls[0][1] as FormData;
    expect(form.get('file')).toBe(file);
  });

  it('uploadProfileDocument(cin) → POST /profile/documents/cin', async () => {
    postForm.mockResolvedValue({ type: 'cin', key: 'cin/u1' });
    await authService.uploadProfileDocument(
      'cin',
      new File(['x'], 'cin.png', { type: 'image/png' }),
    );
    expect(postForm.mock.calls[0][0]).toBe('/profile/documents/cin');
  });

  it('upload failure → throws a French message', async () => {
    postForm.mockRejectedValueOnce(
      new ApiError({ status: 413, code: 'PAYLOAD_TOO_LARGE', message: '' }),
    );
    await expect(
      authService.uploadProfileDocument('rne', new File(['x'], 'big.pdf')),
    ).rejects.toThrow(/5 Mo/);
  });

  it('getProfileDocumentUrl(rne) → GET /profile/documents/rne → the presigned url', async () => {
    get.mockResolvedValue({ url: 'https://minio/presigned' });
    await expect(authService.getProfileDocumentUrl('rne')).resolves.toBe('https://minio/presigned');
    expect(get).toHaveBeenCalledWith('/profile/documents/rne');
  });

  it('getProfileDocumentUrl → 404 (no document) → null', async () => {
    get.mockRejectedValueOnce(new ApiError({ status: 404, code: 'NOT_FOUND', message: '' }));
    await expect(authService.getProfileDocumentUrl('cin')).resolves.toBeNull();
  });

  it('getProfileDocumentUrl → non-404 → throws a French message', async () => {
    get.mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK', message: '' }));
    await expect(authService.getProfileDocumentUrl('rne')).rejects.toThrow(/connexion/i);
  });
});
