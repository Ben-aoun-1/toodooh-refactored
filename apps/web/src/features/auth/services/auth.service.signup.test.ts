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
const postForm = vi.mocked(apiClient.postForm);
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
// R7/N4 — owners now POST multipart (postForm): a `payload` field (the JSON) + the volet file parts.
const ownerForm = () => postForm.mock.calls[0][1];
const ownerPayload = () =>
  JSON.parse(ownerForm().get('payload') as string) as Record<string, unknown>;
const ownerFile = (name: string) => new File(['x'], name, { type: 'application/pdf' });

describe('authService.signUp → POST /signup (Phase-1f F2)', () => {
  beforeEach(() => {
    post.mockReset();
    postForm.mockReset();
  });

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

  it('omits tax_number when blank (advertiser, JSON path)', async () => {
    post.mockResolvedValue(ok);
    await authService.signUp({ ...advertiser, tax_number: '   ' });
    expect(body()).not.toHaveProperty('tax_number');
  });

  it('includes tax_number for an owner (in the multipart payload)', async () => {
    postForm.mockResolvedValue(ok);
    await authService.signUp({
      ...advertiser,
      profile_type: 'individual_owner',
      tax_number: 'OWNER123',
    });
    expect(postForm).toHaveBeenCalledTimes(1);
    expect(ownerPayload()).toMatchObject({
      profile_type: 'individual_owner',
      tax_number: 'OWNER123',
    });
  });

  it('sends individual_owner location + WiFi in the multipart payload (P3)', async () => {
    postForm.mockResolvedValue(ok);
    await authService.signUp({
      ...advertiser,
      profile_type: 'individual_owner',
      latitude: 36.8065,
      longitude: 10.1815,
      wifi_ssid: 'CafeNet',
      wifi_password: 'hunter2pass',
    });
    expect(ownerPayload()).toMatchObject({
      latitude: 36.8065,
      longitude: 10.1815,
      wifi_ssid: 'CafeNet',
      wifi_password: 'hunter2pass',
    });
  });

  it('omits location + WiFi (and fleet_establishments) when absent (P3)', async () => {
    post.mockResolvedValue(ok);
    await authService.signUp(advertiser);
    for (const k of [
      'latitude',
      'longitude',
      'wifi_ssid',
      'wifi_password',
      'fleet_establishments',
    ]) {
      expect(body()).not.toHaveProperty(k);
    }
  });

  it('maps fleet_establishments to the wire shape — street_address → address, geo/WiFi, blanks omitted (P3)', async () => {
    postForm.mockResolvedValue(ok);
    await authService.signUp({
      ...advertiser,
      profile_type: 'fleet_owner',
      fleet_establishments: [
        {
          name: 'Café Centre',
          screen_count: 3,
          room_count: 2,
          street_address: '12 Av. Habib Bourguiba',
          city: 'Tunis',
          zone: 'Centre Ville Tunis',
          governorate_id: '22222222-2222-2222-2222-222222222222',
          latitude: 36.8,
          longitude: 10.18,
          wifi_ssid: 'CafeWifi',
          wifi_password: 'cafe1234',
        },
        // Minimal row: every optional blank → only name + screen_count reach the wire.
        {
          name: 'Kiosque Lac',
          screen_count: 1,
          room_count: 1,
          street_address: '',
          city: '',
          zone: '',
          governorate_id: '',
        },
      ],
    });
    const sent = ownerPayload().fleet_establishments as Array<Record<string, unknown>>;
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({
      name: 'Café Centre',
      screen_count: 3,
      address: '12 Av. Habib Bourguiba',
      city: 'Tunis',
      zone: 'Centre Ville Tunis',
      governorate_id: '22222222-2222-2222-2222-222222222222',
      latitude: 36.8,
      longitude: 10.18,
      wifi_ssid: 'CafeWifi',
      wifi_password: 'cafe1234',
    });
    expect(sent[0]).not.toHaveProperty('street_address'); // remapped, never sent raw
    expect(sent[0]).not.toHaveProperty('room_count'); // backend has no such column
    expect(sent[1]).toEqual({ name: 'Kiosque Lac', screen_count: 1 });
  });

  it('throws a French message when the POST fails', async () => {
    post.mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK', message: '' }));
    await expect(authService.signUp(advertiser)).rejects.toThrow(/connexion/i);
  });

  // R7/N4 — the owner multipart contract (C5): payload field + the named volet parts; JSON path only
  // for non-owners.
  it('advertiser uses the JSON path (post), never multipart', async () => {
    post.mockResolvedValue(ok);
    await authService.signUp(advertiser);
    expect(post).toHaveBeenCalledTimes(1);
    expect(postForm).not.toHaveBeenCalled();
  });

  it('individual_owner → multipart: payload + cin_recto + cin_verso + bank parts (no rne)', async () => {
    postForm.mockResolvedValue(ok);
    await authService.signUp({
      ...advertiser,
      profile_type: 'individual_owner',
      cin_recto: ownerFile('recto.pdf'),
      cin_verso: ownerFile('verso.pdf'),
      bank_doc: ownerFile('rib.pdf'),
    });
    expect(post).not.toHaveBeenCalled();
    expect(postForm).toHaveBeenCalledTimes(1);
    expect(postForm.mock.calls[0][0]).toBe('/signup');
    const form = ownerForm();
    expect(typeof form.get('payload')).toBe('string');
    expect(form.get('cin_recto')).toBeInstanceOf(File);
    expect(form.get('cin_verso')).toBeInstanceOf(File);
    expect(form.get('bank')).toBeInstanceOf(File);
    expect(form.get('rne')).toBeNull(); // individual owner sends no RNE
  });

  it('fleet_owner → multipart: payload + rne + bank parts (no CIN)', async () => {
    postForm.mockResolvedValue(ok);
    await authService.signUp({
      ...advertiser,
      profile_type: 'fleet_owner',
      registration_doc: ownerFile('rne.pdf'),
      bank_doc: ownerFile('rib.pdf'),
    });
    expect(postForm).toHaveBeenCalledTimes(1);
    const form = ownerForm();
    expect(form.get('rne')).toBeInstanceOf(File);
    expect(form.get('bank')).toBeInstanceOf(File);
    expect(form.get('cin_recto')).toBeNull();
    expect(form.get('cin_verso')).toBeNull();
  });
});

describe('authService.checkEmailAvailability → POST /signup/email-availability (QA-fix lane)', () => {
  beforeEach(() => post.mockReset());

  it('returns the endpoint verdict', async () => {
    post.mockResolvedValue({ available: false });
    await expect(authService.checkEmailAvailability('taken@example.com')).resolves.toBe(false);
    expect(post).toHaveBeenCalledWith('/signup/email-availability', {
      email: 'taken@example.com',
    });
    post.mockResolvedValue({ available: true });
    await expect(authService.checkEmailAvailability('new@example.com')).resolves.toBe(true);
  });

  it('fails OPEN (null) on rate-limit or network errors — submit stays the authority', async () => {
    post.mockRejectedValueOnce(new ApiError({ status: 429, code: 'RATE_LIMITED', message: '' }));
    await expect(authService.checkEmailAvailability('a@b.c')).resolves.toBeNull();
    post.mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK', message: '' }));
    await expect(authService.checkEmailAvailability('a@b.c')).resolves.toBeNull();
  });
});

describe('authService.checkTaxAvailability → POST /signup/tax-availability (Kais QA3)', () => {
  beforeEach(() => post.mockReset());

  it('returns the endpoint verdict', async () => {
    post.mockResolvedValue({ available: false });
    await expect(authService.checkTaxAvailability('MATRIC123')).resolves.toBe(false);
    expect(post).toHaveBeenCalledWith('/signup/tax-availability', { tax_number: 'MATRIC123' });
    post.mockResolvedValue({ available: true });
    await expect(authService.checkTaxAvailability('FREE456A')).resolves.toBe(true);
  });

  it('fails OPEN (null) on rate-limit or network errors — submit stays the authority', async () => {
    post.mockRejectedValueOnce(new ApiError({ status: 429, code: 'RATE_LIMITED', message: '' }));
    await expect(authService.checkTaxAvailability('MATRIC123')).resolves.toBeNull();
    post.mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK', message: '' }));
    await expect(authService.checkTaxAvailability('MATRIC123')).resolves.toBeNull();
  });
});
