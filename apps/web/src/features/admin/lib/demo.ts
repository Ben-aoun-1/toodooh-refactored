import type { CreateDemoAccountBody, DemoCampaign } from '../services/admin-demo.service';

/**
 * DEMO-1 (operator 2026-10-12, rulings A A A A A A) — the admin « Démo » page's rules, pure:
 * the delay field (minutes, 0–1440, the api's bounds), the account form, and the on-air line of
 * a demo campaign (« À l'antenne dans 4 min »). The page only renders these.
 */

export const DEMO_DELAY_MAX_MINUTES = 1440;
/** The api's MAX_RECHARGE_TND — a demo balance or top-up never exceeds it. */
export const DEMO_AMOUNT_MAX_TND = 1_000_000;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** The delay field: a whole number of minutes in [0, 1440]. */
export function parseDelayMinutes(raw: string): Parsed<number> {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return { ok: false, error: 'Indiquez un nombre entier de minutes.' };
  const value = Number(trimmed);
  if (value > DEMO_DELAY_MAX_MINUTES) {
    return { ok: false, error: `Au plus ${DEMO_DELAY_MAX_MINUTES} minutes (24 h).` };
  }
  return { ok: true, value };
}

/** An amount in TND: positive, at most 2 decimals, at most the recharge ceiling. */
export function parseAmountTnd(raw: string): Parsed<number> {
  const normalized = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return { ok: false, error: 'Montant invalide (2 décimales au plus).' };
  }
  const value = Number(normalized);
  if (value <= 0) return { ok: false, error: 'Le montant doit être positif.' };
  if (value > DEMO_AMOUNT_MAX_TND) return { ok: false, error: 'Montant trop élevé.' };
  return { ok: true, value };
}

export interface DemoAccountForm {
  email: string;
  password: string;
  businessName: string;
  contactName: string;
  balance: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The account form → the api body, or the first French error. */
export function demoAccountBody(form: DemoAccountForm): Parsed<CreateDemoAccountBody> {
  const email = form.email.trim();
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Adresse e-mail invalide.' };
  if (form.password.length < 8) {
    return { ok: false, error: 'Le mot de passe doit faire au moins 8 caractères.' };
  }
  const businessName = form.businessName.trim();
  if (!businessName) return { ok: false, error: 'Le nom de la société est obligatoire.' };
  const balance = parseAmountTnd(form.balance);
  if (!balance.ok) return balance;
  const contactName = form.contactName.trim();
  return {
    ok: true,
    value: {
      email,
      password: form.password,
      business_name: businessName,
      ...(contactName ? { contact_name: contactName } : {}),
      balance_tnd: balance.value,
    },
  };
}

export type OnAirTone = 'waiting' | 'live' | 'done' | 'stopped';

const STATUS_FR: Record<string, string> = {
  pending: 'En attente de validation',
  upcoming: 'À venir',
  active: 'Active',
  completed: 'Terminée',
  rejected: 'Arrêtée',
};

const hhmm = (iso: string): string =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Tunis',
  });

/** The on-air line of a demo campaign at `now`. */
export function onAirStatus(c: DemoCampaign, now: Date): { label: string; tone: OnAirTone } {
  if (c.status === 'rejected') return { label: 'Arrêtée', tone: 'stopped' };
  if (c.status === 'completed') return { label: 'Terminée', tone: 'done' };
  if (c.airs_at === null) return { label: STATUS_FR[c.status] ?? c.status, tone: 'waiting' };
  const msLeft = new Date(c.airs_at).getTime() - now.getTime();
  if (msLeft > 0) {
    const minutes = Math.ceil(msLeft / 60_000);
    return {
      label:
        minutes <= 1
          ? 'À l’antenne dans moins d’une minute'
          : `À l’antenne dans ${minutes} min (${hhmm(c.airs_at)})`,
      tone: 'waiting',
    };
  }
  if (c.on_air_pushed_at === null) return { label: 'Envoi aux écrans…', tone: 'waiting' };
  return { label: `À l’antenne depuis ${hhmm(c.on_air_pushed_at)}`, tone: 'live' };
}
