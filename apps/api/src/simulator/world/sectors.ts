// SIM-1 — the venue archetypes a generated world draws from. `name` MUST match a
// `business_sectors` row with audience = 'owner' (migrations 0003 + 0036 seed exactly these five
// in every database, sandboxes included) — the writer looks the sector up BY NAME, never by id,
// because ids differ per database.
//
// `curve` is relative footfall (persons/hour) at each clock hour 0–23; the generator scales it per
// venue by class and weekday. The curves are shapes, not measurements: a café peaks at breakfast
// and late afternoon, a restaurant at the two services, a gym before and after work.

export type VenueClass = 'populaire' | 'moyen' | 'premium';

export interface SectorProfile {
  name: string;
  weight: number;
  openingHour: number;
  closingHour: number;
  curve: readonly number[];
}

const curve = (pairs: Record<number, number>): number[] =>
  Array.from({ length: 24 }, (_, hour) => pairs[hour] ?? 0);

export const OWNER_SECTORS: readonly SectorProfile[] = [
  {
    name: 'Café',
    weight: 35,
    openingHour: 7,
    closingHour: 23,
    curve: curve({
      7: 28,
      8: 46,
      9: 52,
      10: 44,
      11: 36,
      12: 34,
      13: 32,
      14: 30,
      15: 34,
      16: 44,
      17: 54,
      18: 58,
      19: 50,
      20: 40,
      21: 30,
      22: 20,
    }),
  },
  {
    name: 'Resto',
    weight: 25,
    openingHour: 11,
    closingHour: 23,
    curve: curve({
      11: 18,
      12: 48,
      13: 62,
      14: 44,
      15: 20,
      16: 16,
      17: 18,
      18: 26,
      19: 48,
      20: 64,
      21: 56,
      22: 32,
    }),
  },
  {
    name: 'Resto/Bar',
    weight: 15,
    openingHour: 12,
    closingHour: 2,
    curve: curve({
      12: 30,
      13: 42,
      14: 30,
      15: 18,
      16: 18,
      17: 24,
      18: 36,
      19: 52,
      20: 66,
      21: 72,
      22: 64,
      23: 48,
      0: 30,
      1: 18,
    }),
  },
  {
    name: 'Salle de sport',
    weight: 15,
    openingHour: 6,
    closingHour: 22,
    curve: curve({
      6: 22,
      7: 38,
      8: 34,
      9: 24,
      10: 18,
      11: 16,
      12: 20,
      13: 22,
      14: 18,
      15: 20,
      16: 28,
      17: 46,
      18: 58,
      19: 54,
      20: 40,
      21: 24,
    }),
  },
  {
    name: 'Espace de loisir',
    weight: 10,
    openingHour: 10,
    closingHour: 0,
    curve: curve({
      10: 16,
      11: 22,
      12: 28,
      13: 30,
      14: 34,
      15: 40,
      16: 48,
      17: 54,
      18: 60,
      19: 62,
      20: 56,
      21: 44,
      22: 30,
      23: 18,
    }),
  },
] as const;

/** Per-class footfall multiplier range and the share of venues in each class. */
export const VENUE_CLASSES: readonly {
  value: VenueClass;
  weight: number;
  scale: [number, number];
}[] = [
  { value: 'populaire', weight: 50, scale: [0.8, 1.4] },
  { value: 'moyen', weight: 30, scale: [1.0, 1.8] },
  { value: 'premium', weight: 20, scale: [1.3, 2.5] },
] as const;

/** Weekday multiplier, index 0 = Monday … 6 = Sunday (the dayOfWeek 1–7 convention minus one). */
export const WEEKDAY_FACTOR: readonly number[] = [0.95, 0.95, 1.0, 1.05, 1.25, 1.35, 1.1] as const;

/** Audience ratios by class: [male %, 17–30 %, 31–45 %] — the 46+ band takes the remainder. */
export const CLASS_DEMOGRAPHICS: Record<
  VenueClass,
  { male: number; a1730: number; a3145: number }
> = {
  populaire: { male: 68, a1730: 34, a3145: 41 },
  moyen: { male: 58, a1730: 38, a3145: 39 },
  premium: { male: 52, a1730: 44, a3145: 38 },
};
