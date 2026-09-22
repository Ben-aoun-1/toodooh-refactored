import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SignUpData } from '@/features/auth/types/auth';
import { ApiError, apiClient } from '@/lib/api-client';

import { screencasterSignupDocuments } from '../lib/signup-documents';

import { authService } from './auth.service';

// Stub supabase (authService still imports it for deferred methods) + clean apiClient mock object
// (F1 carry-forward — no real-module spread, which double-observes rejected promises).
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
  company_size: '50 - 100', // sent since SIZE-PERSIST1
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

  it('drops files + owner-extras (never in the payload) — company_size is SENT since SIZE-PERSIST1', async () => {
    post.mockResolvedValue(ok);
    await authService.signUp(advertiser);
    for (const k of [
      'registration_doc',
      'company_logo',
      'bank_doc',
      'cin',
      'formule',
      'number_of_screens',
      'number_of_rooms',
      'fleet_establishments',
    ]) {
      expect(body()).not.toHaveProperty(k);
    }
    // Mejri 07/09 — the band chosen at signup must reach the api, which now stores it (0069).
    expect(body()).toHaveProperty('company_size', advertiser.company_size);
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
        // Minimal row: every optional blank → only name + the two counts reach the wire.
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
      room_count: 2,
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
    // SCR-DECL1 — room_count reaches the api (stored since migration 0077; it used to be dropped).
    expect(sent[1]).toEqual({ name: 'Kiosque Lac', screen_count: 1, room_count: 1 });
  });

  // ── H1 (Mejri item 5) — working hours: the single [open, close) window rides the payload
  // when captured, and is OMITTED entirely on the « préciser plus tard » skip. ─────────────────
  it('sends the individual_owner working-hours pair — a 0 opening hour is kept (H1)', async () => {
    postForm.mockResolvedValue(ok);
    await authService.signUp({
      ...advertiser,
      profile_type: 'individual_owner',
      opening_hour: 0,
      closing_hour: 22,
    });
    expect(ownerPayload()).toMatchObject({ opening_hour: 0, closing_hour: 22 });
  });

  it('omits the working-hours pair when unset — the skip path sends NOTHING (H1)', async () => {
    postForm.mockResolvedValue(ok);
    await authService.signUp({ ...advertiser, profile_type: 'individual_owner' });
    expect(ownerPayload()).not.toHaveProperty('opening_hour');
    expect(ownerPayload()).not.toHaveProperty('closing_hour');
  });

  it('carries fleet working hours PER establishment; a skipped entry omits them (H1)', async () => {
    postForm.mockResolvedValue(ok);
    await authService.signUp({
      ...advertiser,
      profile_type: 'fleet_owner',
      fleet_establishments: [
        {
          name: 'Café Centre',
          screen_count: 3,
          room_count: 2,
          street_address: '',
          city: '',
          zone: '',
          governorate_id: '',
          opening_hour: 6,
          closing_hour: 23,
        },
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
    expect(sent[0]).toEqual({
      name: 'Café Centre',
      screen_count: 3,
      room_count: 2,
      opening_hour: 6,
      closing_hour: 23,
    });
    expect(sent[1]).toEqual({ name: 'Kiosque Lac', screen_count: 1, room_count: 1 });
  });

  // SCR-DECL1 — the individual owner's declaration used to be dropped here (« backend-stripped »),
  // so its venue was stored with 0 screens and no rooms.
  it('sends the individual_owner exact screen_count + room_count at the top level (SCR-DECL1)', async () => {
    postForm.mockResolvedValue(ok);
    await authService.signUp({
      ...advertiser,
      profile_type: 'individual_owner',
      screen_count: 3,
      room_count: 2,
    });
    expect(ownerPayload()).toMatchObject({ screen_count: 3, room_count: 2 });
  });

  it('an advertiser sends no screen or room count (SCR-DECL1)', async () => {
    post.mockResolvedValue(ok);
    await authService.signUp(advertiser);
    expect(body()).not.toHaveProperty('screen_count');
    expect(body()).not.toHaveProperty('room_count');
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

  // SIGN-2 (operator ruling 2026-08-31) took the CIN volets out of signup (no CIN part). RNE-SIGN1
  // (2026-09-21) — CIN-2b made the wizard collect the RNE from EVERY owner, so an individual owner's
  // RNE pick is sent as `rne` exactly like a fleet owner's (it used to be silently dropped here).
  it('individual_owner → multipart: payload + rne + bank parts (no CIN)', async () => {
    postForm.mockResolvedValue(ok);
    await authService.signUp({
      ...advertiser,
      profile_type: 'individual_owner',
      registration_doc: ownerFile('rne.pdf'),
      bank_doc: ownerFile('rib.pdf'),
    });
    expect(post).not.toHaveBeenCalled();
    expect(postForm).toHaveBeenCalledTimes(1);
    expect(postForm.mock.calls[0][0]).toBe('/signup');
    const form = ownerForm();
    expect(typeof form.get('payload')).toBe('string');
    expect(form.get('rne')).toBeInstanceOf(File); // the individual owner's RNE reaches the api
    expect((form.get('rne') as File).name).toBe('rne.pdf');
    expect(form.get('bank')).toBeInstanceOf(File);
    expect(form.get('cin_recto')).toBeNull(); // the intake is gone from signup
    expect(form.get('cin_verso')).toBeNull();
  });

  it('individual_owner with NO document at all still posts multipart and completes', async () => {
    postForm.mockResolvedValue(ok);
    await authService.signUp({
      ...advertiser,
      profile_type: 'individual_owner',
      registration_doc: undefined,
    });
    expect(postForm).toHaveBeenCalledTimes(1);
    const form = ownerForm();
    expect(typeof form.get('payload')).toBe('string');
    expect(form.get('rne')).toBeNull(); // no pick → no part (never an empty one)
    expect(form.get('bank')).toBeNull();
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

  // DOC-CAST1 (ruling A 2026-09-22) — the screencaster « Documents » step used to post JSON, so its
  // RNE (≤ 2) and documents complémentaires (≤ 10) never reached the api. Picked files now ride the
  // owners' multipart shape: every RNE as an `rne` part, every complémentaire as a `complementaire`
  // part. No file (nothing picked, or « plus tard ») keeps the plain JSON path.
  const screencasterPicks = (addLater: boolean, profileType: 'advertiser' | 'agency') =>
    screencasterSignupDocuments({
      profileType,
      rneFiles: [ownerFile('rne-1.pdf'), ownerFile('rne-2.pdf')],
      complementaireFiles: [ownerFile('comp-1.pdf')],
      addLater,
    });

  for (const profileType of ['advertiser', 'agency'] as const) {
    it(`${profileType} with picks → multipart: payload + EVERY rne and complementaire part (DOC-CAST1)`, async () => {
      postForm.mockResolvedValue(ok);
      await authService.signUp({
        ...advertiser,
        profile_type: profileType,
        ...screencasterPicks(false, profileType),
      });
      expect(post).not.toHaveBeenCalled();
      expect(postForm).toHaveBeenCalledTimes(1);
      expect(postForm.mock.calls[0][0]).toBe('/signup');
      const form = ownerForm();
      expect(ownerPayload()).toMatchObject({ email: 'a@b.c', profile_type: profileType });
      expect(form.getAll('rne').map((f) => (f as File).name)).toEqual(['rne-1.pdf', 'rne-2.pdf']);
      expect(form.getAll('complementaire').map((f) => (f as File).name)).toEqual(['comp-1.pdf']);
      expect(form.get('bank')).toBeNull(); // a screencaster has no RIB volet
      // Files never enter the JSON payload.
      for (const k of ['rne_docs', 'complementaire_docs', 'registration_doc', 'company_logo']) {
        expect(ownerPayload()).not.toHaveProperty(k);
      }
    });
  }

  it('advertiser who ticked « plus tard » → the plain JSON path, no file (DOC-CAST1)', async () => {
    post.mockResolvedValue(ok);
    await authService.signUp({ ...advertiser, ...screencasterPicks(true, 'advertiser') });
    expect(postForm).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
    expect(body()).toMatchObject({ email: 'a@b.c', profile_type: 'advertiser' });
  });

  it('advertiser who picked nothing → the plain JSON path (DOC-CAST1)', async () => {
    post.mockResolvedValue(ok);
    await authService.signUp({ ...advertiser, rne_docs: [], complementaire_docs: [] });
    expect(postForm).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('an owner never sends screencaster parts — rne + bank volets only (unchanged)', async () => {
    postForm.mockResolvedValue(ok);
    await authService.signUp({
      ...advertiser,
      profile_type: 'fleet_owner',
      registration_doc: ownerFile('rne.pdf'),
      bank_doc: ownerFile('rib.pdf'),
      rne_docs: [ownerFile('stray-rne.pdf')],
      complementaire_docs: [ownerFile('stray-comp.pdf')],
    });
    const form = ownerForm();
    expect(form.getAll('rne').map((f) => (f as File).name)).toEqual(['rne.pdf']);
    expect(form.getAll('bank').map((f) => (f as File).name)).toEqual(['rib.pdf']);
    expect(form.get('complementaire')).toBeNull();
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
