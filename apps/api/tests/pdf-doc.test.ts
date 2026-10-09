import { describe, expect, it } from 'vitest';

import { buildBonDeCommandeHtml } from '../src/lib/bon-de-commande.js';
import { buildFactureHtml } from '../src/lib/facture.js';
import { buildMonthlyInvoiceHtml } from '../src/lib/monthly-invoice-pdf.js';
import { docTnd, renderDocHtml } from '../src/lib/pdf-doc/document.js';
import { logoDataUri } from '../src/lib/pdf-doc/logo.js';
import { buildScreenhostFactureHtml } from '../src/lib/screenhost-facture-pdf.js';

// Operator 2026-10-09 — every Toodooh document follows the screenhost report's charter with the
// REAL logo: financial documents on white paper under the deep-green band (they are printed,
// signed, stamped), reports on the deep-green paper.

const issuedAt = new Date('2026-10-01T09:00:00Z');
const count = (html: string, re: RegExp): number => html.match(re)?.length ?? 0;

describe('pdf-doc — the shared document charter', () => {
  it('both logo variants are committed assets (never the typed wordmark fallback)', () => {
    expect(logoDataUri('onDark')).toMatch(/^data:image\/png;base64,/);
    expect(logoDataUri('onLight')).toMatch(/^data:image\/png;base64,/);
    expect(logoDataUri('onDark')).not.toBe(logoDataUri('onLight'));
  });

  it('a light document: band with the light logo, footer with the dark one, report tokens', () => {
    const html = renderDocHtml({
      paper: 'light',
      kicker: 'Facture',
      title: 'Café Nord',
      meta: [{ label: 'Référence', value: 'FS-1' }],
      body: '<p>corps</p>',
    });
    expect(html).toContain('class="paper-light"');
    expect(html).toContain(`<img class="band__logo" src="${logoDataUri('onDark') ?? ''}"`);
    expect(html).toContain(`<img class="footer__logo" src="${logoDataUri('onLight') ?? ''}"`);
    expect(html).toContain('>FACTURE<');
    expect(html).toContain('--paper:#0D2B1F');
    expect(html).toContain('--mint:#76E6AB');
    expect(html).toContain('family=Geist');
    expect(html).not.toContain('tood<b>oo</b>h'); // the text fallback only when an asset is missing
  });

  it('an array body lays out fixed sheets with « page x / N »; later sheets carry the running header', () => {
    const html = renderDocHtml({
      paper: 'dark',
      kicker: 'Rapport de clôture',
      title: 'Soldes',
      meta: [],
      body: ['<p>un</p>', '<p>deux</p>'],
    });
    expect(count(html, /class="page page--fixed"/g)).toBe(2);
    expect(count(html, /class="band"/g)).toBe(1);
    expect(count(html, /class="runhead"/g)).toBe(1);
    expect(html).toContain('page 1 / 2');
    expect(html).toContain('page 2 / 2');
  });

  it('escapes user data (venue/advertiser names are free text)', () => {
    const html = renderDocHtml({
      paper: 'light',
      kicker: 'Facture',
      title: '<script>x</script>',
      meta: [],
      body: '',
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('docTnd keeps the literal money format', () => {
    expect(docTnd(1011.8)).toBe('1011.80 TND');
  });
});

describe('the four financial documents — white paper, real logo, content kept', () => {
  it('the screenhost facture: both parties, TTC lines, the money trio, a signature/stamp box — no split rate', () => {
    const html = buildScreenhostFactureHtml({
      reference: 'FS-102A8472',
      month: '2026-09',
      venueName: 'Café Nord',
      ownerName: 'QA Screenhost',
      lines: [
        { source: 'campaign', amountTtcTnd: 45 },
        { source: 'event', amountTtcTnd: 3.3 },
      ],
      subtotalHtTnd: 40.59,
      tvaTnd: 7.71,
      totalTtcTnd: 48.3,
      issuedAt,
    });
    expect(html).toContain('class="paper-light"');
    for (const text of ['Émetteur', 'Client', 'TOODOOH', 'Montant TTC', '45.00 TND', '48.30 TND']) {
      expect(html).toContain(text);
    }
    expect(html).toContain('class="sign__box"');
    // The visible text never discloses the reversement split (CSS percentages aside).
    const visible = html.replace(/<style[\s\S]*?<\/style>/, '').replace('TVA (19 %)', '');
    expect(visible).not.toContain('%');
  });

  it('the récapitulatif, the bon de commande and the monthly invoice keep their HT/TVA/TTC block', () => {
    const recap = buildFactureHtml({
      reference: 'RC-1',
      amountTnd: 1500,
      advertiserName: 'Café Mariem',
      issuedAt,
      bank: { beneficiary: 'TOODOOH', bankName: 'BIAT', rib: 'RIB', iban: 'IBAN' },
    });
    expect(recap).toContain('RÉCAPITULATIF DE COMMANDE');
    expect(recap).toContain('1785.00 TND');
    expect(recap).toContain('Coordonnées bancaires pour le virement');

    const bon = buildBonDeCommandeHtml({
      reference: 'BC-1',
      amountTnd: 1500,
      advertiserName: 'Café Mariem',
      issuedAt,
    });
    expect(bon).toContain('BON DE COMMANDE');
    expect(bon).toContain('class="sign__box"');

    const invoice = buildMonthlyInvoiceHtml({
      reference: 'FM-1',
      month: '2026-09',
      advertiserName: 'Café Mariem',
      totalHt: 100,
      tvaTnd: 19,
      totalTtc: 119,
      issuedAt,
    });
    expect(invoice).toContain('>FACTURE<');
    expect(invoice).toContain('119.00 TND');
    for (const html of [recap, bon, invoice]) expect(html).toContain('class="paper-light"');
  });
});
