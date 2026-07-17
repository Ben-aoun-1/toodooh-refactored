import { beforeEach, describe, expect, it, vi } from 'vitest';

// CF-M1 — pin the LIVE money wire: paths, verbs, bodies, and the blob facture download. The
// apiClient is stubbed with spies; these tests assert the service never drifts off the api routes
// (routes/recharges.ts) it repointed onto.
const spies = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  getBlob: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ apiClient: spies }));

import { factureFilename, walletService } from './wallet.service';

beforeEach(() => {
  spies.get.mockReset();
  spies.post.mockReset();
  spies.getBlob.mockReset();
});

describe('walletService (CF-M1 — the live money wire)', () => {
  it('getBalance → GET /wallet/balance (the derived balance shape)', async () => {
    const balance = { balance_tnd: 760, credited_tnd: 1000, debited_tnd: 240, currency: 'TND' };
    spies.get.mockResolvedValue(balance);
    await expect(walletService.getBalance()).resolves.toEqual(balance);
    expect(spies.get).toHaveBeenCalledWith('/wallet/balance');
  });

  it('listMyRecharges → GET /recharges/mine', async () => {
    spies.get.mockResolvedValue([]);
    await walletService.listMyRecharges();
    expect(spies.get).toHaveBeenCalledWith('/recharges/mine');
  });

  it('createRecharge → POST /recharges with {amount} ONLY (bank-transfer flow takes no method)', async () => {
    const row = { id: 'r1', reference: 'FCT-AAAA1111', status: 'pending', amount_tnd: 1000 };
    spies.post.mockResolvedValue(row);
    await expect(walletService.createRecharge(1000)).resolves.toEqual(row);
    expect(spies.post).toHaveBeenCalledWith('/recharges', { amount: 1000 });
  });

  it('downloadFacture → the SERVER pdf as a blob from GET /recharges/:id/facture', async () => {
    const pdf = new Blob(['%PDF-1.3'], { type: 'application/pdf' });
    spies.getBlob.mockResolvedValue(pdf);
    await expect(walletService.downloadFacture('r1')).resolves.toBe(pdf);
    expect(spies.getBlob).toHaveBeenCalledWith('/recharges/r1/facture');
  });

  it('factureFilename mirrors the server content-disposition', () => {
    expect(factureFilename('FCT-AAAA1111')).toBe('facture-FCT-AAAA1111.pdf');
  });
});
