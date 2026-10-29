import { describe, expect, it } from 'vitest';

import { ctaBracketHtml, ctaCardHtml } from '../src/lib/spot-cta-card.js';
import { ctaFilterGraph, ctaLayout, ctaWindow } from '../src/lib/spot-cta-layout.js';
import {
  CTA_DEFAULT_LABEL,
  ctaCartBlock,
  ctaDrawnLabel,
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

  // QR-CTA2 (Mariem 27/10 point 1) — her video's layout, at 1080 p.
  it('the card sits bottom-left at the design sizes, clear of the player bar', () => {
    const l = ctaLayout(1080);
    expect(l.tile.size).toBe(184);
    expect(l.panel).toMatchObject({ x: 72, width: 300, height: 168 });
    expect(l.panel.y + l.panel.height).toBe(1080 - 76);
    // The tile overlaps the card's top; the QR keeps a white margin inside the tile.
    expect(l.tile.y + l.tile.size).toBeGreaterThan(l.panel.y);
    expect(l.qr).toBeLessThan(l.tile.size);
    expect(l.layer).toEqual({ x: 72, y: l.tile.y, width: 300, height: 1004 - l.tile.y });
  });

  it('sizes follow the frame height (a 720 p spot gets 2/3)', () => {
    const l = ctaLayout(720);
    expect(l.tile.size).toBe(122);
    expect(l.panel.width).toBe(200);
  });

  it('the card shows from 2 s to the end − 2 s; a very short spot shows it throughout', () => {
    expect(ctaWindow(10)).toEqual({ start: 2, end: 8 });
    expect(ctaWindow(30)).toEqual({ start: 2, end: 28 });
    expect(ctaWindow(5)).toEqual({ start: 0, end: 5 });
  });

  it('the ffmpeg graph frosts the card area, fades in/out on that window, pulses four brackets', () => {
    const graph = ctaFilterGraph(ctaLayout(1080), 12);
    expect(graph).toContain('crop=300:168:72:836,boxblur');
    expect(graph).toContain('fade=t=in:st=2:d=0.35:alpha=1');
    expect(graph).toContain('fade=t=out:st=9.65:d=0.35:alpha=1');
    expect(graph.match(/eval=frame/g)).toHaveLength(4);
    expect(graph).toContain('hflip,vflip');
    expect(graph.endsWith('[out]')).toBe(true);
    // A photo's pre-scaled stream is named instead of [0:v].
    expect(ctaFilterGraph(ctaLayout(1080), 10, 'frame').startsWith('[frame]split=2')).toBe(true);
  });

  it("the card says « Scannez le code », escapes the advertiser's words, carries POWERED BY", () => {
    const html = ctaCardHtml(ctaLayout(1080), 'data:image/png;base64,AAAA', 'Promo <b>&</b>');
    expect(html).toContain('Scannez le code');
    expect(html).toContain('Promo &lt;b&gt;&amp;&lt;/b&gt;');
    expect(html).not.toContain('<b>&</b>');
    expect(html).toContain('POWERED BY');
    expect(html).toContain('data:image/png;base64,AAAA');
    expect(ctaBracketHtml(ctaLayout(1080))).toContain('#76E6AB');
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
