import { describe, expect, it } from 'vitest';

import { renderMonthlyReportPdf } from '../src/lib/report.js';

// pdfkit (compress:false) writes text as HEX tokens in the content stream; decode them to assert the
// report actually CONTAINS the figures (same approach as facture.test).
const pdfText = (pdf: Buffer): string => {
  const raw = pdf.toString('latin1');
  let out = '';
  for (const m of raw.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    const hex = m[1] ?? '';
    if (hex.length % 2 === 0) out += Buffer.from(hex, 'hex').toString('latin1');
  }
  return out;
};

describe('monthly report PDF builder', () => {
  it('renders a non-empty PDF containing the totals, venue, month and busiest day', async () => {
    const pdf = await renderMonthlyReportPdf({
      ownerName: 'Ahmed Ben Ali',
      venueName: 'Cafe Central',
      month: '2026-05',
      totalAudience: 12345,
      daily: [
        { date: '2026-05-01', audience: 400 },
        { date: '2026-05-02', audience: 611 },
        { date: '2026-05-03', audience: 520 },
      ],
      peakDayOfWeek: 6, // samedi
      peakHour: 19,
    });
    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const text = pdfText(pdf);
    expect(text).toContain('RAPPORT MENSUEL');
    expect(text).toContain('12345'); // total audience
    expect(text).toContain('Cafe Central'); // venue
    expect(text).toContain('2026-05'); // month
    expect(text).toContain('samedi'); // busiest day (peak_day_of_week 6)
    expect(text).toContain('2026-05-02'); // a per-day row
    expect(text).toContain('611'); // that day's audience
  });

  it('paginates a full month without throwing (31 day rows)', async () => {
    const daily = Array.from({ length: 31 }, (_, i) => ({
      date: `2026-03-${String(i + 1).padStart(2, '0')}`,
      audience: (i + 1) * 10,
    }));
    const pdf = await renderMonthlyReportPdf({
      ownerName: 'O',
      venueName: 'V',
      month: '2026-03',
      totalAudience: 4960,
      daily,
      peakDayOfWeek: 1,
      peakHour: 0,
    });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdfText(pdf)).toContain('2026-03-31'); // the last row rendered (after a page break)
  });
});
