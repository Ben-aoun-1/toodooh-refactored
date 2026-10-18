import { describe, expect, it } from 'vitest';

import type { CampaignCtaView } from '../services/campaigns.api';

import { ctaFormBody, ctaScansLabel, ctaStatusLine } from './spot-cta';

const view = (over: Partial<CampaignCtaView> = {}): CampaignCtaView => ({
  enabled: true,
  url: 'https://example.tn',
  label: null,
  default_label: 'Pour en savoir plus',
  status: 'ready',
  scan_url: 'https://too-dooh.com/q/abcd2345',
  preview_url: null,
  scans: 0,
  ...over,
});

describe('QR-CTA1 — the spot step’s call-to-action form', () => {
  it('maps to the api body (https only, message ≤ 20, empty = default)', () => {
    expect(ctaFormBody(' https://example.tn/offre ', '  Commandez  vite ')).toEqual({
      ok: true,
      value: { url: 'https://example.tn/offre', label: 'Commandez vite' },
    });
    expect(ctaFormBody('https://example.tn', '')).toEqual({
      ok: true,
      value: { url: 'https://example.tn', label: null },
    });
    expect(ctaFormBody('', '').ok).toBe(false);
    expect(ctaFormBody('http://example.tn', '').ok).toBe(false);
    expect(ctaFormBody('example.tn', '').ok).toBe(false);
    expect(ctaFormBody('https://example.tn', 'a'.repeat(21)).ok).toBe(false);
    expect(ctaFormBody('https://example.tn', 'é'.repeat(20)).ok).toBe(true);
  });

  it('says where the QR copy stands', () => {
    expect(ctaStatusLine(view({ url: null, status: null }))).toBeNull();
    expect(ctaStatusLine(view({ status: 'pending' }))?.tone).toBe('waiting');
    expect(ctaStatusLine(view({ status: 'failed' }))?.tone).toBe('error');
    expect(ctaStatusLine(view())?.tone).toBe('ok');
  });

  it('counts scans in French', () => {
    expect(ctaScansLabel(0)).toBe('0 scan du QR code');
    expect(ctaScansLabel(1)).toBe('1 scan du QR code');
    expect(ctaScansLabel(12)).toBe('12 scans du QR code');
  });
});
