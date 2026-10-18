import type { CampaignCtaBody, CampaignCtaView } from '../services/campaigns.api';

/**
 * QR-CTA1 — the spot step's call-to-action form, pure: the link (https only) and the message
 * (≤ 20 characters, empty = « Pour en savoir plus »), checked the way the api checks them
 * (apps/api/src/lib/spot-cta.ts), and the status line under the form.
 */

export const CTA_LABEL_MAX_CHARS = 20;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function ctaFormBody(url: string, label: string): Parsed<CampaignCtaBody> {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: 'Indiquez le lien à ouvrir.' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Lien invalide (ex. https://votre-site.tn/offre).' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Le lien doit commencer par https://' };
  }
  if (!parsed.hostname.includes('.')) return { ok: false, error: 'Lien invalide.' };
  const message = label.trim().replace(/\s+/g, ' ');
  if ([...message].length > CTA_LABEL_MAX_CHARS) {
    return { ok: false, error: `Le message fait ${CTA_LABEL_MAX_CHARS} caractères au plus.` };
  }
  return { ok: true, value: { url: trimmed, label: message || null } };
}

export type CtaTone = 'waiting' | 'ok' | 'error';

/** The line under the form once a link is saved. */
export function ctaStatusLine(view: CampaignCtaView): { text: string; tone: CtaTone } | null {
  if (view.url === null || view.status === null) return null;
  if (view.status === 'pending') {
    return { text: 'Préparation du QR code sur votre spot…', tone: 'waiting' };
  }
  if (view.status === 'failed') {
    return {
      text: 'Le QR code n’a pas pu être ajouté à ce spot (format ou taille). Essayez un autre fichier.',
      tone: 'error',
    };
  }
  return { text: 'QR code ajouté à votre spot.', tone: 'ok' };
}

/** « 3 scans » — the count shown on the campaign. */
export const ctaScansLabel = (n: number): string => `${n} scan${n > 1 ? 's' : ''} du QR code`;
