// Legacy parity: business_profiles.contact_phone CHECK valid_phone
// (supabase-schema-inventory §2.2). E.164: '+' then 1-15 digits, first 1-9.
const E164 = /^\+[1-9]\d{1,14}$/;

export const validatePhone = (value: string): boolean => E164.test(value);
