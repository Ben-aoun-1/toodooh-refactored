import { beforeEach, describe, expect, it, vi } from 'vitest';

// CF-M2 — pin the admin justificatif wire + the review modal's render-mode decision. Same
// apiClient-stub pattern as wallet.service.test.ts.
const spies = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ apiClient: spies }));

import {
  adminRechargesService,
  computeRechargeStats,
  documentDisplayMode,
  type AdminRecharge,
} from './admin-recharges.service';

const row = (over: Partial<AdminRecharge> = {}): AdminRecharge => ({
  id: 'r1',
  advertiser_id: 'a1',
  amount_tnd: 1000,
  status: 'pending',
  reference: 'VIR-AAAA1111',
  reject_reason: null,
  confirmed_at: null,
  confirmed_by: null,
  created_at: '2026-07-20T10:00:00.000Z',
  updated_at: '2026-07-20T10:00:00.000Z',
  has_document: true,
  document_uploaded_at: '2026-07-20T10:00:00.000Z',
  document_mime: 'application/pdf',
  method: 'virement',
  has_bon: false,
  has_signed_bon: false,
  signed_bon_mime: null,
  signed_bon_deposited_at: null,
  cancelled_at: null,
  ...over,
});

beforeEach(() => {
  spies.get.mockReset();
  spies.post.mockReset();
});

describe('adminRechargesService.documentUrl (CF-M2 — the admin presigned view)', () => {
  it('→ GET /admin/recharges/:id/document-url', async () => {
    spies.get.mockResolvedValue({ url: 'https://minio/presigned' });
    await expect(adminRechargesService.documentUrl('r1')).resolves.toEqual({
      url: 'https://minio/presigned',
    });
    expect(spies.get).toHaveBeenCalledWith('/admin/recharges/r1/document-url');
  });

  it('FCT1 — bonUrl / signedBonUrl ride the same presign posture', async () => {
    spies.get.mockResolvedValue({ url: 'https://minio/presigned' });
    await adminRechargesService.bonUrl('r1');
    expect(spies.get).toHaveBeenCalledWith('/admin/recharges/r1/bon-url');
    await adminRechargesService.signedBonUrl('r1');
    expect(spies.get).toHaveBeenCalledWith('/admin/recharges/r1/signed-bon-url');
  });
});

describe('documentDisplayMode (image inline vs PDF open-in-tab)', () => {
  it.each(['image/jpeg', 'image/png'] as const)('%s → image (renders inline)', (mime) => {
    expect(documentDisplayMode(mime)).toBe('image');
  });

  it('application/pdf → pdf (open-in-tab)', () => {
    expect(documentDisplayMode('application/pdf')).toBe('pdf');
  });

  it('null (no document / unknown) falls back to pdf — never an <img> with a broken src', () => {
    expect(documentDisplayMode(null)).toBe('pdf');
  });
});

describe('computeRechargeStats (FCT1 — « En attente » counts the ACTIONABLE rows)', () => {
  it('bon_returned rows count as awaiting alongside pending; confirmed/rejected stay apart', () => {
    const stats = computeRechargeStats([
      row({ id: 'r1', status: 'pending', amount_tnd: 500 }),
      row({
        id: 'r2',
        status: 'bon_returned',
        method: 'bon_de_commande',
        reference: 'BC-AAAA1111',
        amount_tnd: 1000,
      }),
      row({ id: 'r3', status: 'confirmed', amount_tnd: 2000 }),
      row({ id: 'r4', status: 'rejected', amount_tnd: 4000 }),
    ]);
    expect(stats).toEqual({
      total_recharges: 4,
      pending_count: 2,
      confirmed_count: 1,
      rejected_count: 1,
      total_amount: 7500,
      pending_amount: 1500,
      confirmed_amount: 2000,
    });
  });
});
