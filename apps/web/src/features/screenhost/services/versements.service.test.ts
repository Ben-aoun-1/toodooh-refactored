import { beforeEach, describe, expect, it, vi } from 'vitest';

// REV3 — the owner versements wire: FOUR frozen fields, and nothing that could leak a status or a
// coordinate onto « Mes Revenus ».
const spies = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: spies }));

import { type OwnerVersementRow, versementsService } from './versements.service';

beforeEach(() => {
  spies.get.mockReset();
});

const RIB = '12345678901234567890';
const IBAN = 'TN5912345678901234567890';

describe('versementsService (REV3 — the owner payment history)', () => {
  it('list → GET /screenhosts/versements', async () => {
    spies.get.mockResolvedValue([]);
    await versementsService.list();
    expect(spies.get).toHaveBeenCalledWith('/screenhosts/versements');
  });

  it('the row is EXACTLY the four frozen fields', async () => {
    const wire: OwnerVersementRow[] = [
      {
        designation: 'Facture juillet 2026',
        montant_ttc: 50.58,
        created_at: '2026-08-05T09:30:00.000Z',
        mode_label_masked: 'Virement bancaire — IBAN ••••7890',
      },
    ];
    spies.get.mockResolvedValue(wire);
    const rows = await versementsService.list();
    expect(Object.keys(rows[0]).sort()).toEqual([
      'created_at',
      'designation',
      'mode_label_masked',
      'montant_ttc',
    ]);
  });

  it('no status, no facture_id, and no bank coordinates ever appear on this surface', async () => {
    spies.get.mockResolvedValue([
      {
        designation: 'Facture juillet 2026',
        montant_ttc: 50.58,
        created_at: '2026-08-05T09:30:00.000Z',
        mode_label_masked: 'Virement bancaire — IBAN ••••7890',
      },
    ]);
    const serialized = JSON.stringify(await versementsService.list());
    for (const forbidden of ['status', 'facture_id', 'created_by', 'en_paiement', RIB, IBAN]) {
      expect(serialized).not.toContain(forbidden);
    }
    // The mode is a LABEL: no run of digits long enough to be a coordinate.
    expect(serialized).not.toMatch(/[0-9]{5,}/);
  });
});
