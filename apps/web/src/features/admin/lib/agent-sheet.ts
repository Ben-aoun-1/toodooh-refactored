/**
 * AGT-1 (agent specs v1.0 §2 « Créer un Agent », operator rulings 2026-10-13) — the agent sheet the
 * admin fills at creation, and its rules, pure: first and last name, phone, address, governorate,
 * covered zone and certification date are required; the tax number too for a Screencaster agent
 * (optional for a Screenhost agent); the commission rate is optional (empty = the engine default).
 * Mirrors the api's createAccountSchema so the form refuses what the server would.
 */

export interface AgentSheetForm {
  phone: string;
  tax_number: string;
  street_address: string;
  city: string;
  postal_code: string;
  governorate_id: string;
  covered_zone: string;
  commission_pct: string;
  certified_at: string;
}

export const EMPTY_AGENT_SHEET: AgentSheetForm = {
  phone: '+216',
  tax_number: '',
  street_address: '',
  city: '',
  postal_code: '',
  governorate_id: '',
  covered_zone: '',
  commission_pct: '',
  certified_at: '',
};

export interface AgentSheetPayload {
  phone: string;
  tax_number?: string;
  street_address: string;
  city: string;
  postal_code: string;
  governorate_id: string;
  covered_zone: string;
  commission_pct?: number;
  certified_at: string;
}

const PHONE_RE = /^\+[1-9]\d{6,14}$/;
const TAX_RE = /^[A-Za-z0-9/]{7,20}$/;

/** The sheet → the api fields, or the first French error. */
export function agentSheetPayload(
  form: AgentSheetForm,
  role: 'screenhost_agent' | 'screencast_agent',
): { ok: true; value: AgentSheetPayload } | { ok: false; error: string } {
  const phone = form.phone.replace(/\s/g, '');
  if (!PHONE_RE.test(phone)) return { ok: false, error: 'Téléphone invalide (ex. +21612345678).' };
  const tax = form.tax_number.trim();
  if (role === 'screencast_agent' && !tax) {
    return { ok: false, error: 'Le matricule fiscal est obligatoire pour un Agent Screencaster.' };
  }
  if (tax && !TAX_RE.test(tax)) return { ok: false, error: 'Matricule fiscal invalide.' };
  for (const [key, label] of [
    ['street_address', 'L’adresse'],
    ['city', 'La ville'],
    ['governorate_id', 'Le gouvernorat'],
    ['covered_zone', 'La zone couverte'],
    ['certified_at', 'La date de certification'],
  ] as const) {
    if (!form[key].trim()) return { ok: false, error: `${label} est obligatoire.` };
  }
  if (!/^\d{4}$/.test(form.postal_code.trim())) {
    return { ok: false, error: 'Le code postal doit comporter 4 chiffres.' };
  }
  let pct: number | undefined;
  if (form.commission_pct.trim()) {
    pct = Number(form.commission_pct.trim().replace(',', '.'));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100 || Math.round(pct * 100) !== pct * 100) {
      return { ok: false, error: 'Taux de commission invalide (0 à 100, 2 décimales).' };
    }
  }
  return {
    ok: true,
    value: {
      phone,
      ...(tax ? { tax_number: tax } : {}),
      street_address: form.street_address.trim(),
      city: form.city.trim(),
      postal_code: form.postal_code.trim(),
      governorate_id: form.governorate_id,
      covered_zone: form.covered_zone.trim(),
      ...(pct !== undefined ? { commission_pct: pct } : {}),
      certified_at: form.certified_at,
    },
  };
}

export type AgentAccountStatus = 'en_attente' | 'actif' | 'suspendu' | 'cloture';

export const AGENT_STATUS_FR: Record<AgentAccountStatus, string> = {
  en_attente: 'En attente des CGE',
  actif: 'Actif',
  suspendu: 'Suspendu',
  cloture: 'Clôturé',
};

/** « 2 étapes sur 4 » — the onboarding progress the admin list shows. */
export const onboardingLabel = (o: { done: number; steps: unknown[]; complete: boolean } | null) =>
  o === null
    ? '—'
    : o.complete
      ? 'Terminé'
      : `${o.done} étape${o.done > 1 ? 's' : ''} sur ${o.steps.length}`;

/** AGT-2 — affiliation statuses as the hub shows them (spec §6). */
export const AFFILIATION_STATUS_FR = {
  en_attente_activation: 'En attente d’activation',
  en_cours: 'En cours',
  terminee: 'Terminée',
  exclue: 'Exclue',
} as const;

export const EXCLUSION_FR: Record<string, string> = {
  key_account: 'Key account',
  secteur_reserve: 'Secteur réservé',
  exclu: 'Exclu par le hub',
  reaffecte: 'Réaffecté',
};

/** « 03/09/2026 → 03/09/2028 », or the pending activation when no window starts yet. */
export const affiliationWindowLabel = (start: string | null, end: string | null) => {
  if (!start || !end) return 'Démarre à la première campagne terminée';
  const fr = (d: string) => d.split('-').reverse().join('/');
  return `${fr(start)} → ${fr(end)}`;
};

/** Only a live affiliation takes hub actions; an ended or excluded one is history. */
export const affiliationIsLive = (status: keyof typeof AFFILIATION_STATUS_FR) =>
  status === 'en_cours' || status === 'en_attente_activation';
