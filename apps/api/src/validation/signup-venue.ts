import { z } from 'zod';

// The venue fields a screenhost signup carries — moved verbatim out of routes/signup.ts (the
// route file was over 400 lines); the individual owner's top level and every fleet entry share
// the hours rules below. No behaviour change.
//
// One fleet location the fleet_owner declares at signup → one screenhosts row. All
// location/WiFi fields are optional ("add later"); name is the only requirement.
// room_count is accepted on the wire (the FE still sends it) but stripped here —
// screenhosts has no room_count column, so it is never persisted.

// H1 (Mejri item 5) — working hours at signup: the venue's single daily window [open, close),
// ints 0–23, landing in the SAME screenhosts.opening_hour/closing_hour columns the admin
// eligibility PATCH and the C3 ingest write. The pair is all-or-nothing and must satisfy
// open < close (the dispatch/report reading semantics); skipping leaves both NULL (14h report
// fallback, full hachure, dispatch-ineligible until set). Per-day + overnight stay deferred.
export const hourField = z.number().int().min(0).max(23);
interface HoursPair {
  opening_hour?: number;
  closing_hour?: number;
}
export const hoursArePaired = (b: HoursPair): boolean =>
  (b.opening_hour === undefined) === (b.closing_hour === undefined);
// HOURS-X1: closing ≤ opening is legal (« closes the next day »); only an EQUAL pair is refused.
export const hoursAreOrdered = (b: HoursPair): boolean =>
  b.opening_hour === undefined || b.closing_hour === undefined || b.opening_hour !== b.closing_hour;
export const PAIR_MESSAGE = 'opening_hour and closing_hour must be provided together';
export const ORDER_MESSAGE =
  'opening_hour and closing_hour must differ (closing before opening = closes the next day)';
export const HOURS_REQUIRED_MESSAGE =
  'opening_hour and closing_hour are required for a screenhost signup';

export const fleetEstablishmentSchema = z
  .object({
    name: z.string().min(1).max(200),
    screen_count: z.number().int().min(0).optional(),
    address: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    zone: z.string().optional(),
    governorate_id: z.uuid().optional(),
    postal_code: z
      .string()
      .regex(/^\d{4}$/, 'Postal code must be 4 digits')
      .optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    wifi_ssid: z.string().min(1).optional(),
    wifi_password: z.string().min(1).optional(),
    // HOURS-M1 (Mejri 09/09, operator 2026-09-12): the pair is REQUIRED per establishment —
    // « préciser plus tard » is gone from the wizard and refused on the wire.
    opening_hour: hourField,
    closing_hour: hourField,
  })
  .refine(hoursArePaired, { message: PAIR_MESSAGE, path: ['closing_hour'] })
  .refine(hoursAreOrdered, { message: ORDER_MESSAGE, path: ['closing_hour'] });
