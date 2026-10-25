import { z } from 'zod';

import { validatePhone } from './phone.js';
import { TAX_NUMBER_ERROR, validateTaxNumber } from './tax-number.js';

// HOST-EDIT1 — the wire of the admin « Fiche Host » edits (2026-10-25). The field rules are the
// signup's (validation/signup-venue.ts) and the owner profile's (routes/profile.ts), so an admin
// can never store a value an owner could not. Every body is PARTIAL with at least one field: an
// omitted key is left unchanged, an explicit null clears a nullable column.

const atLeastOne = (b: Record<string, unknown>): boolean => Object.keys(b).length > 0;
const AT_LEAST_ONE = 'At least one field is required';
const POSTAL_CODE = z.string().regex(/^\d{4}$/, 'Postal code must be 4 digits');

// The venue itself (screenhosts). Latitude and longitude travel as a pair: the route checks the
// RESULTING state (stored ⊕ patch) is both-set or both-null.
export const hostVenuePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    address: z.string().trim().min(1).max(300).nullable(),
    city: z.string().trim().min(1).max(100).nullable(),
    postal_code: POSTAL_CODE.nullable(),
    governorate_id: z.uuid().nullable(),
    zone: z.string().trim().min(1).max(100).nullable(),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
  })
  .partial()
  .refine(atLeastOne, { message: AT_LEAST_ONE });
export type HostVenuePatch = z.infer<typeof hostVenuePatchSchema>;

// The OWNER account of the venue (users) — ruling Q2 B. Shared by every venue of a fleet owner.
// Not here, on purpose: the email (the login identity), the bank coordinates (money-adjacent,
// audited by REV1 on their own route) and the role / status (the moderation routes).
export const hostOwnerPatchSchema = z
  .object({
    business_name: z.string().trim().min(1).max(200),
    tax_number: z.string().trim().refine(validateTaxNumber, TAX_NUMBER_ERROR).nullable(),
    contact_name: z.string().trim().min(1).max(100),
    contact_phone: z
      .string()
      .trim()
      .refine(validatePhone, 'Phone must be E.164 (e.g. +21612345678)'),
    fonction: z.string().trim().max(100).nullable(),
    street_address: z.string().trim().min(1).max(300),
    city: z.string().trim().min(1).max(100),
    postal_code: POSTAL_CODE,
    governorate_id: z.uuid(),
    zone: z.string().trim().max(100).nullable(),
  })
  .partial()
  .refine(atLeastOne, { message: AT_LEAST_ONE });
export type HostOwnerPatch = z.infer<typeof hostOwnerPatchSchema>;
