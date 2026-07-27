import { beforeEach, describe, expect, it, vi } from 'vitest';

// FCT2 — pin the relevés wire + the French designation (the mock jsPDF surface is retired).
const spies = vi.hoisted(() => ({
  get: vi.fn(),
  getBlob: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ apiClient: spies }));

import { releveFilename, statementDesignation, statementsService } from './statements.service';

beforeEach(() => {
  spies.get.mockReset();
  spies.getBlob.mockReset();
});

describe('statementsService (FCT2 — the owner relevés wire)', () => {
  it('list → GET /screenhosts/statements', async () => {
    spies.get.mockResolvedValue([]);
    await statementsService.list();
    expect(spies.get).toHaveBeenCalledWith('/screenhosts/statements');
  });

  it('download → the STORED pdf as a blob from GET /screenhosts/statements/:id/pdf', async () => {
    const pdf = new Blob(['%PDF-1.3'], { type: 'application/pdf' });
    spies.getBlob.mockResolvedValue(pdf);
    await expect(statementsService.download('s1')).resolves.toBe(pdf);
    expect(spies.getBlob).toHaveBeenCalledWith('/screenhosts/statements/s1/pdf');
  });

  it('releveFilename mirrors the server content-disposition', () => {
    expect(releveFilename('REL-AAAA1111')).toBe('releve-REL-AAAA1111.pdf');
  });

  it('statementDesignation renders « Relevé de reversement — <Mois> <Année> »', () => {
    expect(statementDesignation('2026-07')).toBe('Relevé de reversement — Juillet 2026');
    expect(statementDesignation('nope')).toBe('Relevé de reversement');
  });
});
