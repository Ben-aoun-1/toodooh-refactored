import { describe, expect, it } from 'vitest';

import {
  CTA_DEFAULT_LABEL,
  ctaCartBlock,
  ctaDrawnLabel,
  ctaFilterGraph,
  ctaGeometry,
  ctaScanUrl,
  isCtaCode,
  newCtaCode,
  parseCtaLabel,
  parseCtaUrl,
} from '../src/lib/spot-cta.js';

// QR-CTA1 — the call-to-action rules, pure.

describe('QR-CTA1 — call-to-action rules', () => {
  it('the link is https with a real host, no credentials', () => {
    expect(parseCtaUrl(' https://example.tn/promo?x=1 ')).toEqual({
      ok: true,
      value: 'https://example.tn/promo?x=1',
    });
    expect(parseCtaUrl('http://example.tn')).toEqual({ ok: false, error: 'CTA_URL_NOT_HTTPS' });
    expect(parseCtaUrl('https://localhost/x').ok).toBe(false);
    expect(parseCtaUrl('https://user:pw@example.tn').ok).toBe(false);
    expect(parseCtaUrl('javascript:alert(1)').ok).toBe(false);
    expect(parseCtaUrl('').ok).toBe(false);
    expect(parseCtaUrl(`https://example.tn/${'a'.repeat(2000)}`)).toEqual({
      ok: false,
      error: 'CTA_URL_TOO_LONG',
    });
  });

  it('the message is at most 20 characters; empty means the default', () => {
    expect(parseCtaLabel('  Commandez   vite ')).toEqual({ ok: true, value: 'Commandez vite' });
    expect(parseCtaLabel('')).toEqual({ ok: true, value: null });
    expect(parseCtaLabel(null)).toEqual({ ok: true, value: null });
    expect(parseCtaLabel('a'.repeat(20)).ok).toBe(true);
    expect(parseCtaLabel('a'.repeat(21))).toEqual({ ok: false, error: 'CTA_LABEL_TOO_LONG' });
    expect(parseCtaLabel('é'.repeat(20)).ok).toBe(true);
    expect(parseCtaLabel('a\u0007b').ok).toBe(false);
    expect(ctaDrawnLabel(null)).toBe(CTA_DEFAULT_LABEL);
    expect(ctaDrawnLabel('Promo')).toBe('Promo');
  });

  it('codes are 8 unambiguous characters; the QR encodes the redirect', () => {
    const code = newCtaCode();
    expect(isCtaCode(code)).toBe(true);
    expect(code).toMatch(/^[a-km-np-z2-9]{8}$/);
    expect(isCtaCode('abc')).toBe(false);
    expect(isCtaCode('abcdefg0')).toBe(false);
    expect(ctaScanUrl('https://too-dooh.com/', 'abcd2345')).toBe('https://too-dooh.com/q/abcd2345');
  });

  it('a video card sits bottom-left of the frame, clear of the player bar', () => {
    const g = ctaGeometry(1920, 1080, 'video');
    expect(g.qr).toBe(260);
    expect(g.x).toBe(32);
    expect(g.y + g.cardHeight).toBeLessThanOrEqual(1080 - 0.09 * 1080 + 1);
    expect(g.cardWidth).toBeGreaterThan(g.qr);
    expect(ctaFilterGraph(g, '/f.otf', '/l.txt')).toContain('textfile=/l.txt');
  });

  it('an image card lands inside the part the TV shows (16:9 centre crop)', () => {
    // A square photo: the TV keeps the middle 9/16 of its height.
    const square = ctaGeometry(1080, 1080, 'photo');
    const visibleTop = (1080 - 1080 * (9 / 16)) / 2;
    const visibleBottom = visibleTop + 1080 * (9 / 16);
    expect(square.y).toBeGreaterThan(visibleTop);
    expect(square.y + square.cardHeight).toBeLessThan(visibleBottom);
    // A very wide photo: the TV crops its sides.
    const wide = ctaGeometry(3000, 1000, 'photo');
    const visibleLeft = (3000 - 1000 * (16 / 9)) / 2;
    expect(wide.x).toBeGreaterThan(visibleLeft);
  });

  it('the cart refuses only a failed copy of the CURRENT spot', () => {
    const base = { ctaUrl: 'https://x.tn', creativeId: 'c1' };
    expect(ctaCartBlock({ ...base, ctaStatus: 'failed', ctaSourceCreativeId: 'c1' })).toBe(
      'SPOT_QR_FAILED',
    );
    expect(ctaCartBlock({ ...base, ctaStatus: 'failed', ctaSourceCreativeId: 'c0' })).toBeNull();
    expect(ctaCartBlock({ ...base, ctaStatus: 'pending', ctaSourceCreativeId: null })).toBeNull();
    expect(
      ctaCartBlock({ ctaUrl: null, creativeId: 'c1', ctaStatus: null, ctaSourceCreativeId: null }),
    ).toBeNull();
  });
});
