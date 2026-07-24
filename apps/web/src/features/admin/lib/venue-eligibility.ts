import type {
  EligibilityPatch,
  ScreenhostEligibility,
  VenueClass,
} from '@/features/admin/services/admin-screenhost.service';
import { HOURS_ORDER_HINT } from '@/features/screenhost/lib/venue-hours';

// EL1 — the « Éligibilité dispatch » editor's pure logic + pinned French copy (node-env test
// harness; no render tests). The client-side rules MIRROR the intended PATCH contract: hours
// set-together with ouverture strictly before fermeture (the H2 pair rules, same copy), capacity
// a strictly positive integer, catégorie/classe null-clearable via « — ».

export interface EligibilityFormState {
  businessSectorId: string | null;
  venueClass: VenueClass | null;
  openingHour: number | null;
  closingHour: number | null;
  /** Raw text input — '' means "clear the capacity" (explicit null in the patch). */
  capacityInput: string;
}

export type EligibilityFieldErrors = Partial<Record<keyof EligibilityPatch, string>>;

// ── Pinned French copy ───────────────────────────────────────────────────────────────────────────
export const HOURS_PAIR_ERROR =
  "Les heures d'ouverture et de fermeture doivent être renseignées ensemble.";
export const CAPACITY_ERROR = 'La capacité doit être un nombre entier strictement positif.';
export const SECTOR_INVALID_ERROR = 'Catégorie invalide : choisissez un secteur propriétaire.';
export const CLASS_INVALID_ERROR = 'Classe invalide.';
export const OPENING_RANGE_ERROR = "Heure d'ouverture invalide (entier de 0 à 23).";
export const CLOSING_RANGE_ERROR = 'Heure de fermeture invalide (entier de 0 à 23).';
export const ELIGIBILITY_CONSEQUENCE_NOTE =
  "Sans horaires ou capacité, l'établissement est exclu des prochaines campagnes.";
export const ELIGIBILITY_SAVED_TOAST = 'Éligibilité dispatch enregistrée';
export const ELIGIBILITY_ERROR_TOAST = "Impossible d'enregistrer l'éligibilité";
export const NO_CHANGES_TOAST = 'Aucune modification à enregistrer';

/** The classe select's options — server enum values with French labels; « — » clears. */
export const VENUE_CLASS_OPTIONS: { value: VenueClass; label: string }[] = [
  { value: 'populaire', label: 'Populaire' },
  { value: 'moyen', label: 'Moyen' },
  { value: 'premium', label: 'Premium' },
];

/** Prefill the form from the GET view (capacity stringified for the text input). */
export const formStateFromView = (view: ScreenhostEligibility): EligibilityFormState => ({
  businessSectorId: view.business_sector_id,
  venueClass: view.class,
  openingHour: view.opening_hour,
  closingHour: view.closing_hour,
  capacityInput: view.broadcast_capacity === null ? '' : String(view.broadcast_capacity),
});

/** '' → null (clear); a validated input → its integer value. */
export const parseCapacity = (input: string): number | null => {
  const trimmed = input.trim();
  return trimmed === '' ? null : Number(trimmed);
};

const isPositiveIntText = (input: string): boolean => {
  const trimmed = input.trim();
  return /^\d+$/.test(trimmed) && Number(trimmed) >= 1;
};

/** The client-side mirror — {} means valid. Errors land on the field that must change. */
export const validateEligibilityForm = (form: EligibilityFormState): EligibilityFieldErrors => {
  const errors: EligibilityFieldErrors = {};
  if (form.openingHour !== null && form.closingHour === null) {
    errors.closing_hour = HOURS_PAIR_ERROR;
  } else if (form.closingHour !== null && form.openingHour === null) {
    errors.opening_hour = HOURS_PAIR_ERROR;
  } else if (
    form.openingHour !== null &&
    form.closingHour !== null &&
    form.openingHour >= form.closingHour
  ) {
    errors.closing_hour = HOURS_ORDER_HINT;
  }
  if (form.capacityInput.trim() !== '' && !isPositiveIntText(form.capacityInput)) {
    errors.broadcast_capacity = CAPACITY_ERROR;
  }
  return errors;
};

/**
 * Dirty fields only — respects the PATCH's partial contract (the hub owns catégorie/classe pushes;
 * re-asserting unchanged fields could clobber a concurrent sync). Validate BEFORE building.
 */
export const buildEligibilityPatch = (
  view: ScreenhostEligibility,
  form: EligibilityFormState,
): EligibilityPatch => {
  const patch: EligibilityPatch = {};
  if (form.businessSectorId !== view.business_sector_id) {
    patch.business_sector_id = form.businessSectorId;
  }
  if (form.venueClass !== view.class) patch.class = form.venueClass;
  if (form.openingHour !== view.opening_hour) patch.opening_hour = form.openingHour;
  if (form.closingHour !== view.closing_hour) patch.closing_hour = form.closingHour;
  const capacity = parseCapacity(form.capacityInput);
  if (capacity !== view.broadcast_capacity) patch.broadcast_capacity = capacity;
  return patch;
};

// The PATCH's 400 fields[] → per-field French copy. Server reasons are English; each known field
// gets its mirror message (the reason text itself is not shown). Unknown fields are dropped —
// getErrorMessage still surfaces the generic toast.
const SERVER_FIELD_COPY: Record<string, { key: keyof EligibilityPatch; message: string }> = {
  business_sector_id: { key: 'business_sector_id', message: SECTOR_INVALID_ERROR },
  class: { key: 'class', message: CLASS_INVALID_ERROR },
  opening_hour: { key: 'opening_hour', message: OPENING_RANGE_ERROR },
  closing_hour: { key: 'closing_hour', message: CLOSING_RANGE_ERROR },
  broadcast_capacity: { key: 'broadcast_capacity', message: CAPACITY_ERROR },
};

export const mapEligibilityServerErrors = (
  fields: readonly { field: string; reason: string }[] | undefined,
): EligibilityFieldErrors => {
  const errors: EligibilityFieldErrors = {};
  for (const f of fields ?? []) {
    const copy = SERVER_FIELD_COPY[f.field];
    if (copy) errors[copy.key] = copy.message;
  }
  return errors;
};

// ── EL1 commit 2 — the per-venue readiness badge ─────────────────────────────────────────────────

export interface EligibilityReadiness {
  eligible: boolean;
  /** French field names, fixed order: catégorie, horaires, capacité. Empty when eligible. */
  missing: string[];
}

export const READINESS_ELIGIBLE_LABEL = 'Éligible au dispatch';

/**
 * The badge's verdict — mirrors the US-2.1 hard pool gates the admin can act on here: catégorie
 * set, a NON-EMPTY horaires window (both bounds, ouverture < fermeture — a half-set or inverted
 * pair yields no broadcastable hours and the pool skips the venue), capacité set. Classe and
 * affluence are not part of this badge (classe only narrows class-targeted campaigns; affluence
 * is S-W2's surface).
 */
export const eligibilityReadiness = (
  view: Pick<
    ScreenhostEligibility,
    'business_sector_id' | 'opening_hour' | 'closing_hour' | 'broadcast_capacity'
  >,
): EligibilityReadiness => {
  const missing: string[] = [];
  if (view.business_sector_id === null) missing.push('catégorie');
  const hasWindow =
    view.opening_hour !== null &&
    view.closing_hour !== null &&
    view.opening_hour < view.closing_hour;
  if (!hasWindow) missing.push('horaires');
  if (view.broadcast_capacity === null) missing.push('capacité');
  return { eligible: missing.length === 0, missing };
};

export const readinessBadgeLabel = (readiness: EligibilityReadiness): string =>
  readiness.eligible ? READINESS_ELIGIBLE_LABEL : `Incomplet — ${readiness.missing.join(', ')}`;
