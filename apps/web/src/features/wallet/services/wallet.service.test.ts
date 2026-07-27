import { beforeEach, describe, expect, it, vi } from 'vitest';

// CF-M1 — pin the LIVE money wire: paths, verbs, bodies, and the blob facture download. The
// apiClient is stubbed with spies; these tests assert the service never drifts off the api routes
// (routes/recharges.ts) it repointed onto.
const spies = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  getBlob: vi.fn(),
  postForm: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ apiClient: spies }));

import { bonFilename, factureFilename, walletService } from './wallet.service';

beforeEach(() => {
  spies.get.mockReset();
  spies.post.mockReset();
  spies.getBlob.mockReset();
  spies.postForm.mockReset();
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

  it('FCT1 — createVirement → ONE multipart POST /recharges/virement?amount= with the file part only', async () => {
    const row = { id: 'r1', reference: 'VIR-AAAA1111', status: 'pending', method: 'virement' };
    spies.postForm.mockResolvedValue(row);
    const file = new File(['%PDF-1.4'], 'virement.pdf', { type: 'application/pdf' });
    await expect(walletService.createVirement(1000, file)).resolves.toEqual(row);
    expect(spies.postForm).toHaveBeenCalledTimes(1);
    const [path, form] = spies.postForm.mock.calls[0] as [string, FormData];
    expect(path).toBe('/recharges/virement?amount=1000');
    expect(form.get('file')).toBe(file);
    // The retired generic create is NEVER called (the api 410s it).
    expect(spies.post).not.toHaveBeenCalled();
  });

  it('FCT1 — createBon → POST /recharges/bon with {amount}', async () => {
    const row = { id: 'r2', reference: 'BC-AAAA1111', status: 'bon_issued' };
    spies.post.mockResolvedValue(row);
    await expect(walletService.createBon(2500)).resolves.toEqual(row);
    expect(spies.post).toHaveBeenCalledWith('/recharges/bon', { amount: 2500 });
  });

  it('FCT1 — downloadBon → the stored pdf as a blob from GET /recharges/:id/bon', async () => {
    const pdf = new Blob(['%PDF-1.3'], { type: 'application/pdf' });
    spies.getBlob.mockResolvedValue(pdf);
    await expect(walletService.downloadBon('r2')).resolves.toBe(pdf);
    expect(spies.getBlob).toHaveBeenCalledWith('/recharges/r2/bon');
  });

  it('FCT1 — uploadSignedBon → multipart POST /recharges/:id/signed-bon with the file part', async () => {
    const row = { id: 'r2', status: 'bon_returned', has_signed_bon: true };
    spies.postForm.mockResolvedValue(row);
    const file = new File(['%PDF-1.4'], 'bon-signe.pdf', { type: 'application/pdf' });
    await expect(walletService.uploadSignedBon('r2', file)).resolves.toEqual(row);
    const [path, form] = spies.postForm.mock.calls[0] as [string, FormData];
    expect(path).toBe('/recharges/r2/signed-bon');
    expect(form.get('file')).toBe(file);
  });

  it('FCT1 — getBankCoordinates → GET /recharges/bank-coordinates (the « Pour info » quartet)', async () => {
    const coords = { rib: '—', iban: '—', bic: '—', domiciliation: '—' };
    spies.get.mockResolvedValue(coords);
    await expect(walletService.getBankCoordinates()).resolves.toEqual(coords);
    expect(spies.get).toHaveBeenCalledWith('/recharges/bank-coordinates');
  });

  it('FCT1 — bonFilename mirrors the server content-disposition', () => {
    expect(bonFilename('BC-AAAA1111')).toBe('bon-commande-BC-AAAA1111.pdf');
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

  it('uploadJustificatif → multipart POST /recharges/:id/document with the file part (CF-M2)', async () => {
    const row = { id: 'r1', has_document: true };
    spies.postForm.mockResolvedValue(row);
    const file = new File(['%PDF-1.4'], 'virement.pdf', { type: 'application/pdf' });
    await expect(walletService.uploadJustificatif('r1', file)).resolves.toEqual(row);
    expect(spies.postForm).toHaveBeenCalledTimes(1);
    const [path, form] = spies.postForm.mock.calls[0] as [string, FormData];
    expect(path).toBe('/recharges/r1/document');
    expect(form.get('file')).toBe(file);
  });

  it('getJustificatifUrl → GET /recharges/:id/document-url (CF-M2 presigned view)', async () => {
    spies.get.mockResolvedValue({ url: 'https://minio/presigned' });
    await expect(walletService.getJustificatifUrl('r1')).resolves.toEqual({
      url: 'https://minio/presigned',
    });
    expect(spies.get).toHaveBeenCalledWith('/recharges/r1/document-url');
  });
});
