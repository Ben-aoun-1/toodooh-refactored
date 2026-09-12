// SIZE-PERSIST1 — the literal bands `company_size` may hold. TWIN of
// apps/web/src/lib/company-size.ts (COMPANY_SIZE_OPTIONS + PARC_COUNT_OPTIONS); the web test
// company-size.test.ts pins the two files byte-for-byte on these arrays. The api accepts the UNION:
// which scale a user reads is a role question the web answers, the store just keeps the literal.
import { z } from 'zod';

export const COMPANY_SIZE_OPTIONS: readonly string[] = [
  '0 - 10',
  '10 - 50',
  '50 - 100',
  '100 - 500',
  '500 et plus',
];

export const PARC_COUNT_OPTIONS: readonly string[] = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '12+',
];

const ALL = [...COMPANY_SIZE_OPTIONS, ...PARC_COUNT_OPTIONS] as [string, ...string[]];

export const companySizeSchema = z.enum(ALL);
