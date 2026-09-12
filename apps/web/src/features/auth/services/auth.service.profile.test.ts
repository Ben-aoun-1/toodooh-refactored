import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeUser, ProfileDocument } from '@/features/auth/types/auth';
import { ApiError, apiClient } from '@/lib/api-client';

import { authService } from './auth.service';

// Stub supabase (authService imports it for deferred methods) + clean apiClient mock (F1
// carry-forward — no real-module spread).
vi.mock('@/lib/api-client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api-client')>();
  return {
    ApiError: actual.ApiError,
    apiClient: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      del: vi.fn(),
      postForm: vi.fn(),
      onUnauthorized: vi.fn(),
    },
  };
});

const patch = vi.mocked(apiClient.patch);
const get = vi.mocked(apiClient.get);
const del = vi.mocked(apiClient.del);
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
  bank_account_holder: null,
  bank_rib: null,
  bank_iban: null,
  documents: { registration: false, cin: false, bank: false },
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

  it('updateProfileBank → PATCH /profile/bank', async () => {
    patch.mockResolvedValue(undefined);
    await authService.updateProfileBank({
      bank_account_holder: 'Foulen Ben Foulen',
      bank_rib: '12345678901234567890',
      bank_iban: 'TN5912345678901234567890',
    });
    expect(patch).toHaveBeenCalledWith('/profile/bank', {
      bank_account_holder: 'Foulen Ben Foulen',
      bank_rib: '12345678901234567890',
      bank_iban: 'TN5912345678901234567890',
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
    // bank fields: null on the wire → undefined on the profile (no details saved yet)
    expect(p?.bank_rib).toBeUndefined();
    expect(p?.bank_doc_path).toBeUndefined();
    // F5 — document presence is a direct map of /api/me's booleans (no sentinel; _doc_url undefined)
    expect(p?.documents).toEqual({ registration: false, cin: false, bank: false });
    expect(p?.registration_doc_url).toBeUndefined();
  });

  it('maps bank details when present; bank_doc_path carries the deterministic key', async () => {
    get.mockResolvedValue({
      user: {
        ...meUser,
        bank_account_holder: 'Foulen Ben Foulen',
        bank_rib: '12345678901234567890',
        bank_iban: 'TN5912345678901234567890',
        documents: { registration: false, cin: false, bank: true },
      },
    });
    const p = await authService.getBusinessProfile();
    expect(p?.bank_account_holder).toBe('Foulen Ben Foulen');
    expect(p?.bank_rib).toBe('12345678901234567890');
    expect(p?.bank_iban).toBe('TN5912345678901234567890');
    expect(p?.bank_doc_path).toBe('bank/u1');
    expect(p?.documents?.bank).toBe(true);
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

// F-docs Commit 2 — the multi-document service surface (grouped list, slot upload,
// presign-by-id, delete). Replaces the F5 single-slot pins (`{type,key}` response +
// the GET /:type compat presign), which the web no longer calls.
describe('authService documents (F-docs — grouped multi-document model)', () => {
  const doc = (over: Partial<ProfileDocument> = {}): ProfileDocument => ({
    id: 'd1',
    category: 'rne',
    position: 1,
    original_filename: 'rc.pdf',
    mime_type: 'application/pdf',
    size_bytes: 123,
    uploaded_at: '2026-06-11T00:00:00.000Z',
    ...over,
  });
  const emptyGroups = { cin: [], rne: [], complementaire: [], bank: [] };

  beforeEach(() => {
    postForm.mockReset();
    get.mockReset();
    del.mockReset();
  });

  it('listProfileDocuments → GET /profile/documents → the grouped categories', async () => {
    const documents = { ...emptyGroups, rne: [doc()] };
    get.mockResolvedValue({ documents });
    await expect(authService.listProfileDocuments()).resolves.toEqual(documents);
    expect(get).toHaveBeenCalledWith('/profile/documents');
  });

  it('uploadProfileDocument(rne) → POST /profile/documents/rne (no position) with the file in FormData → the document', async () => {
    postForm.mockResolvedValue({ document: doc() });
    const file = new File(['x'], 'rc.pdf', { type: 'application/pdf' });
    await expect(authService.uploadProfileDocument('rne', file)).resolves.toEqual(doc());
    expect(postForm).toHaveBeenCalledTimes(1);
    expect(postForm.mock.calls[0][0]).toBe('/profile/documents/rne');
    const form = postForm.mock.calls[0][1] as FormData;
    expect(form.get('file')).toBe(file);
  });

  it('uploadProfileDocument(cin, position) → POST /profile/documents/cin?position=2 (semantic verso slot)', async () => {
    postForm.mockResolvedValue({ document: doc({ category: 'cin', position: 2 }) });
    await authService.uploadProfileDocument(
      'cin',
      new File(['x'], 'verso.png', { type: 'image/png' }),
      2,
    );
    expect(postForm.mock.calls[0][0]).toBe('/profile/documents/cin?position=2');
  });

  it('uploadProfileDocument(bank) sends no position (single-slot: the server replaces slot 1)', async () => {
    postForm.mockResolvedValue({ document: doc({ category: 'bank' }) });
    await authService.uploadProfileDocument('bank', new File(['x'], 'rib.pdf'));
    expect(postForm.mock.calls[0][0]).toBe('/profile/documents/bank');
  });

  it('upload failure → throws a French message', async () => {
    postForm.mockRejectedValueOnce(
      new ApiError({ status: 413, code: 'PAYLOAD_TOO_LARGE', message: '' }),
    );
    await expect(
      authService.uploadProfileDocument('rne', new File(['x'], 'big.pdf')),
    ).rejects.toThrow(/5 Mo/);
  });

  it('getProfileDocumentUrlById → GET /profile/documents/:id/url → the presigned url', async () => {
    get.mockResolvedValue({ url: 'https://minio/presigned' });
    await expect(authService.getProfileDocumentUrlById('d1')).resolves.toBe(
      'https://minio/presigned',
    );
    expect(get).toHaveBeenCalledWith('/profile/documents/d1/url');
  });

  it('getProfileDocumentUrlById → 404 (no such document) → null', async () => {
    get.mockRejectedValueOnce(new ApiError({ status: 404, code: 'NOT_FOUND', message: '' }));
    await expect(authService.getProfileDocumentUrlById('missing')).resolves.toBeNull();
  });

  it('getProfileDocumentUrlById → non-404 → throws a French message', async () => {
    get.mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK', message: '' }));
    await expect(authService.getProfileDocumentUrlById('d1')).rejects.toThrow(/connexion/i);
  });

  it('getProfileDocumentUrlByCategory presigns the LOWEST-position document of the category', async () => {
    get
      .mockResolvedValueOnce({
        documents: {
          ...emptyGroups,
          bank: [doc({ id: 'd2', category: 'bank', position: 2 }), doc({ category: 'bank' })],
        },
      })
      .mockResolvedValueOnce({ url: 'https://minio/presigned' });
    await expect(authService.getProfileDocumentUrlByCategory('bank')).resolves.toBe(
      'https://minio/presigned',
    );
    expect(get).toHaveBeenNthCalledWith(2, '/profile/documents/d1/url');
  });

  it('getProfileDocumentUrlByCategory → empty category → null without a presign call', async () => {
    get.mockResolvedValueOnce({ documents: emptyGroups });
    await expect(authService.getProfileDocumentUrlByCategory('bank')).resolves.toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('deleteProfileDocument → DELETE /profile/documents/:id', async () => {
    del.mockResolvedValue({ deleted: true, id: 'd1' });
    await authService.deleteProfileDocument('d1');
    expect(del).toHaveBeenCalledWith('/profile/documents/d1');
  });

  it('delete failure → throws a French message', async () => {
    del.mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK', message: '' }));
    await expect(authService.deleteProfileDocument('d1')).rejects.toThrow(/connexion/i);
  });
});
