import type {
  HostLockKey,
  HostOwner,
  HostOwnerPatch,
  HostVenue,
  HostVenuePatch,
} from '@/features/admin/services/admin-host.service';
import { normalizeTaxNumber, validateTaxNumber } from '@/features/auth/utils/tax-number';

// HOST-EDIT1 — the « Fiche Host » form rules, pure (apps/web has no render harness: the rules live
// here and are tested in host-fiche.test.ts). The api re-checks every one of them
// (apps/api/src/validation/admin-host.ts); the client mirrors them to answer in French before the
// round-trip. Forms hold strings; a blank input means null (cleared) on a nullable field.

export type FieldErrors<K extends string> = Partial<Record<K, string>>;
type Draft<P, K extends string> = { patch: P } | { errors: FieldErrors<K> };

const POSTAL_CODE_RE = /^\d{4}$/;
// Twin of apps/api/src/validation/phone.ts (E.164).
const E164_RE = /^\+[1-9]\d{1,14}$/;

const blankToNull = (value: string): string | null => {
  const t = value.trim();
  return t === '' ? null : t;
};

// ── Venue ────────────────────────────────────────────────────────────────────────────────────────

export const VENUE_FIELDS = [
  'name',
  'address',
  'city',
  'postal_code',
  'governorate_id',
  'zone',
  'latitude',
  'longitude',
] as const;
export type VenueField = (typeof VENUE_FIELDS)[number];
export type VenueForm = Record<VenueField, string>;

const numText = (n: number | null): string => (n === null ? '' : String(n));

export const venueFormFrom = (v: HostVenue): VenueForm => ({
  name: v.name,
  address: v.address ?? '',
  city: v.city ?? '',
  postal_code: v.postal_code ?? '',
  governorate_id: v.governorate_id ?? '',
  zone: v.zone ?? '',
  latitude: numText(v.latitude),
  longitude: numText(v.longitude),
});

/** '' → null; a comma is accepted as the decimal separator; NaN → undefined (invalid). */
export const parseCoordinate = (value: string): number | null | undefined => {
  const t = value.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

/** The DIRTY fields only, or the French errors. An empty patch means « nothing changed ». */
export const buildVenuePatch = (
  v: HostVenue,
  form: VenueForm,
): Draft<HostVenuePatch, VenueField> => {
  const errors: FieldErrors<VenueField> = {};
  const name = form.name.trim();
  if (name === '') errors.name = 'Le nom est obligatoire.';
  else if (name.length > 200) errors.name = '200 caractères au maximum.';
  const postal = blankToNull(form.postal_code);
  if (postal !== null && !POSTAL_CODE_RE.test(postal)) {
    errors.postal_code = 'Le code postal compte 4 chiffres.';
  }
  const lat = parseCoordinate(form.latitude);
  const lng = parseCoordinate(form.longitude);
  if (lat === undefined || (lat !== null && (lat < -90 || lat > 90))) {
    errors.latitude = 'Latitude entre -90 et 90.';
  }
  if (lng === undefined || (lng !== null && (lng < -180 || lng > 180))) {
    errors.longitude = 'Longitude entre -180 et 180.';
  }
  if (!errors.latitude && !errors.longitude && (lat === null) !== (lng === null)) {
    errors.longitude = 'Renseignez la latitude ET la longitude, ou aucune des deux.';
  }
  if (Object.keys(errors).length > 0) return { errors };

  const next: Required<HostVenuePatch> = {
    name,
    address: blankToNull(form.address),
    city: blankToNull(form.city),
    postal_code: postal,
    governorate_id: blankToNull(form.governorate_id),
    zone: blankToNull(form.zone),
    latitude: lat ?? null,
    longitude: lng ?? null,
  };
  const patch: HostVenuePatch = {};
  for (const key of VENUE_FIELDS) {
    if (next[key] !== v[key]) Object.assign(patch, { [key]: next[key] });
  }
  return { patch };
};

// ── Owner account ────────────────────────────────────────────────────────────────────────────────

export const OWNER_FIELDS = [
  'business_name',
  'tax_number',
  'contact_name',
  'contact_phone',
  'fonction',
  'street_address',
  'city',
  'postal_code',
  'governorate_id',
  'zone',
] as const;
export type OwnerField = (typeof OWNER_FIELDS)[number];
export type OwnerForm = Record<OwnerField, string>;

/** The owner fields the server never clears (non-null when sent): blank = refused if set. */
const OWNER_REQUIRED_WHEN_SET: readonly OwnerField[] = [
  'business_name',
  'contact_name',
  'contact_phone',
  'street_address',
  'city',
  'postal_code',
  'governorate_id',
];

export const ownerFormFrom = (o: HostOwner): OwnerForm => ({
  business_name: o.business_name ?? '',
  tax_number: o.tax_number ?? '',
  contact_name: o.contact_name,
  contact_phone: o.contact_phone ?? '',
  fonction: o.fonction ?? '',
  street_address: o.street_address ?? '',
  city: o.city ?? '',
  postal_code: o.postal_code ?? '',
  governorate_id: o.governorate_id ?? '',
  zone: o.zone ?? '',
});

export const buildOwnerPatch = (
  o: HostOwner,
  form: OwnerForm,
): Draft<HostOwnerPatch, OwnerField> => {
  const errors: FieldErrors<OwnerField> = {};
  const value = (k: OwnerField) => blankToNull(form[k]);
  for (const k of OWNER_REQUIRED_WHEN_SET) {
    if (value(k) === null && o[k] !== null) errors[k] = 'Ce champ ne peut pas être vidé.';
  }
  const tax = value('tax_number');
  if (tax !== null && !validateTaxNumber(tax)) {
    errors.tax_number = 'Matricule invalide : 7 chiffres, 3 lettres, 3 chiffres.';
  }
  const phone = value('contact_phone')?.replace(/\s+/g, '') ?? null;
  if (phone !== null && !E164_RE.test(phone)) {
    errors.contact_phone = 'Format international, ex. +21612345678.';
  }
  const postal = value('postal_code');
  if (postal !== null && !POSTAL_CODE_RE.test(postal)) {
    errors.postal_code = 'Le code postal compte 4 chiffres.';
  }
  if (Object.keys(errors).length > 0) return { errors };

  const next: Record<OwnerField, string | null> = {
    business_name: value('business_name'),
    tax_number: tax === null ? null : normalizeTaxNumber(tax),
    contact_name: value('contact_name'),
    contact_phone: phone,
    fonction: value('fonction'),
    street_address: value('street_address'),
    city: value('city'),
    postal_code: postal,
    governorate_id: value('governorate_id'),
    zone: value('zone'),
  };
  const patch: Record<string, string | null> = {};
  for (const key of OWNER_FIELDS) {
    // A blank required field that was already null stays absent (never sent as null).
    if (next[key] === null && OWNER_REQUIRED_WHEN_SET.includes(key)) continue;
    if (next[key] !== o[key]) patch[key] = next[key];
  }
  return { patch: patch as HostOwnerPatch };
};

/** The server's 400 fields[] → the form's inputs (the message is the server's when unmapped). */
export const mapServerFieldErrors = <K extends string>(
  fields: readonly { field: string; reason: string }[] | undefined,
  known: readonly K[],
): FieldErrors<K> => {
  const errors: FieldErrors<K> = {};
  for (const f of fields ?? []) {
    if ((known as readonly string[]).includes(f.field)) {
      errors[f.field as K] =
        f.field === 'tax_number' && f.reason === 'already registered'
          ? 'Ce matricule est déjà utilisé par un autre compte.'
          : 'Valeur refusée par le serveur.';
    }
  }
  return errors;
};

// ── Hub locks ────────────────────────────────────────────────────────────────────────────────────

export const LOCK_LABELS: Record<HostLockKey, string> = {
  business_sector: 'Catégorie',
  class: 'Classe',
  hours: 'Horaires',
  broadcast_capacity: 'Capacité de diffusion',
};

export const LOCKS_EXPLAINER =
  'Ces champs ont été modifiés par un administrateur : le hub ne les écrase plus. « Rendre au hub » le laisse de nouveau les mettre à jour.';

// ── Trail ────────────────────────────────────────────────────────────────────────────────────────

export const HISTORY_SECTION_LABELS: Record<string, string> = {
  venue: 'Informations générales',
  owner: 'Compte du propriétaire',
  eligibility: 'Horaires & éligibilité',
  wifi: 'Wi-Fi',
  declaration: 'Écrans déclarés',
  unavailability: 'Indisponibilités',
  lock: 'Verrou hub',
};

const FIELD_LABELS: Record<string, string> = {
  ...LOCK_LABELS,
  name: 'Nom',
  address: 'Adresse',
  city: 'Ville',
  postal_code: 'Code postal',
  governorate_id: 'Gouvernorat',
  zone: 'Zone / quartier',
  latitude: 'Latitude',
  longitude: 'Longitude',
  business_name: 'Raison sociale',
  tax_number: 'Matricule fiscal',
  contact_name: 'Responsable',
  contact_phone: 'Téléphone',
  fonction: 'Fonction',
  street_address: 'Adresse',
  business_sector_id: 'Catégorie',
  class: 'Classe',
  opening_hour: 'Ouverture',
  closing_hour: 'Fermeture',
  broadcast_capacity: 'Capacité de diffusion',
  wifi_ssid: 'Réseau Wi-Fi',
  wifi_password_changed: 'Mot de passe Wi-Fi',
  screen_count: "Nombre d'écrans",
  room_count: 'Nombre de salles',
};

export interface HistoryChange {
  label: string;
  before: string;
  after: string;
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const display = (
  key: string,
  value: unknown,
  section: string,
  names: { governorates: ReadonlyMap<string, string>; sectors: ReadonlyMap<string, string> },
): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (section === 'unavailability') return value === true ? 'Indisponible' : 'Disponible';
  if (section === 'lock') return value === true ? 'Verrouillé' : 'Rendu au hub';
  if (key === 'wifi_password_changed') return value === true ? 'Modifié' : '—';
  if (key === 'opening_hour' || key === 'closing_hour') return `${String(value)} h`;
  if (typeof value === 'string' && key === 'governorate_id')
    return names.governorates.get(value) ?? value;
  if (typeof value === 'string' && key === 'business_sector_id')
    return names.sectors.get(value) ?? value;
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
};

/** One trail row → its readable changes (an unavailability key IS the day). */
export const historyChanges = (
  entry: { section: string; before: Record<string, unknown>; after: Record<string, unknown> },
  names: { governorates: ReadonlyMap<string, string>; sectors: ReadonlyMap<string, string> },
): HistoryChange[] =>
  Object.keys(entry.after).map((key) => ({
    label: ISO_DAY_RE.test(key)
      ? `Jour du ${key.split('-').reverse().join('/')}`
      : (FIELD_LABELS[key] ?? key),
    before: display(key, entry.before[key], entry.section, names),
    after: display(key, entry.after[key], entry.section, names),
  }));
