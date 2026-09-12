import { describe, expect, it } from 'vitest';

import type { BusinessProfile } from '@/features/auth/types/auth';

import {
  hasOwnerBankDetails,
  hasOwnerLegalDocument,
  hideOwnerGettingStarted,
  isOwnerAccountActive,
} from './ownerGettingStarted';

// A complete owner profile as the /api/me bridge produces it: documents booleans set, bank
// details present with the synthesized bank_doc_path, and NO legacy *_doc_url fields.
const makeProfile = (overrides: Partial<BusinessProfile> = {}): BusinessProfile => ({
  id: 'u1',
  user_id: 'u1',
  business_name: 'Café Central',
  tax_number: '',
  business_sector_id: 's1',
  business_type: 'local',
  profile_type: 'individual_owner',
  contact_name: 'Kais',
  contact_phone: '+21612345678',
  street_address: '1 rue Test',
  city: 'Tunis',
  postal_code: '1000',
  governorate_id: 'g1',
  documents: { registration: false, cin: true, bank: true },
  bank_account_holder: 'Kais',
  bank_rib: '12345678901234567890',
  bank_iban: 'TN5912345678901234567890',
  bank_doc_path: 'bank/u1',
  verification_status: 'verified',
  terms_accepted: true,
  onboarding_completed: true,
  created_at: '',
  updated_at: '',
  is_admin: false,
  ...overrides,
});

describe('"Pour bien commencer" dismissal (F5 — Kais QA 2026-06-11)', () => {
  it('hides when legal document + bank details + approved account all hold', () => {
    expect(hideOwnerGettingStarted(makeProfile(), 'approved')).toBe(true);
  });

  it('the regression: documents booleans drive the legal check — a cin on file hides the block even with every legacy *_doc_url unset', () => {
    // Pre-fix the predicate read cin_doc_url/registration_doc_*, which /api/me never sets, so
    // the block stayed visible for owners whose documents were already uploaded.
    const profile = makeProfile();
    expect(profile.cin_doc_url).toBeUndefined();
    expect(profile.registration_doc_url).toBeUndefined();
    expect(profile.registration_doc_path).toBeUndefined();
    expect(hasOwnerLegalDocument(profile)).toBe(true);
  });

  it('CIN-2: an individual owner has no legal document to file — the check holds with cin=false', () => {
    const profile = makeProfile({ documents: { registration: false, cin: false, bank: true } });
    expect(hasOwnerLegalDocument(profile)).toBe(true);
    expect(hideOwnerGettingStarted(profile, 'approved')).toBe(true);
  });

  it('a fleet owner still needs the RNE (registration) — shows without it, hides with it', () => {
    const missing = makeProfile({
      profile_type: 'fleet_owner',
      documents: { registration: false, cin: false, bank: true },
    });
    expect(hasOwnerLegalDocument(missing)).toBe(false);
    expect(hideOwnerGettingStarted(missing, 'approved')).toBe(false);
    const filed = makeProfile({
      profile_type: 'fleet_owner',
      documents: { registration: true, cin: false, bank: true },
    });
    expect(hasOwnerLegalDocument(filed)).toBe(true);
  });

  it('shows when the bank document is missing', () => {
    const profile = makeProfile({ bank_doc_path: undefined });
    expect(hasOwnerBankDetails(profile)).toBe(false);
    expect(hideOwnerGettingStarted(profile, 'approved')).toBe(false);
  });

  it('shows while the account is pending — by design, not a bug', () => {
    expect(isOwnerAccountActive(makeProfile(), 'pending')).toBe(false);
    expect(hideOwnerGettingStarted(makeProfile(), 'pending')).toBe(false);
  });

  it('shows when the profile is still loading (null)', () => {
    expect(hideOwnerGettingStarted(null, 'approved')).toBe(false);
  });

  it('shows when an approved account has been deactivated (is_active=false)', () => {
    expect(hideOwnerGettingStarted(makeProfile({ is_active: false }), 'approved')).toBe(false);
  });
});
