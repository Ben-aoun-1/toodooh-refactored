import { beforeEach, describe, expect, it, vi } from 'vitest';

// REV2 — pin the owner factures wire: the paths (unchanged plumbing), the download filename, the
// deposit multipart, and the ABSENCE of `status` from the row the surfaces consume.
const spies = vi.hoisted(() => ({
  get: vi.fn(),
  getBlob: vi.fn(),
  postForm: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ apiClient: spies }));

import {
  SIGNED_DEPOSIT_ACCEPT,
  factureFilename,
  facturesService,
  type OwnerFactureRow,
} from './factures.service';

beforeEach(() => {
  spies.get.mockReset();
  spies.getBlob.mockReset();
  spies.postForm.mockReset();
});

describe('facturesService (REV2 — the owner factures wire)', () => {
  it('list → GET /screenhosts/statements (the path is plumbing, not vocabulary)', async () => {
    spies.get.mockResolvedValue([]);
    await facturesService.list();
    expect(spies.get).toHaveBeenCalledWith('/screenhosts/statements');
  });

  it('the list row carries the designation + FS- reference + deposit date — and NO status', async () => {
    const wire: OwnerFactureRow[] = [
      {
        id: 'f1',
        screenhost_id: 'v1',
        screenhost_name: 'Café Lac 2',
        month: '2026-07',
        total_sh_tnd: 42.5,
        reference: 'FS-AAAA1111',
        created_at: '2026-08-01T06:00:00.000Z',
        deposited_at: null,
        designation: 'Facture juillet 2026',
      },
    ];
    spies.get.mockResolvedValue(wire);
    const rows = await facturesService.list();
    expect(Object.keys(rows[0])).not.toContain('status');
    expect(JSON.stringify(rows)).not.toContain('status');
    expect(rows[0].designation).toBe('Facture juillet 2026');
    expect(rows[0].reference).toMatch(/^FS-[0-9A-F]{8}$/);
  });

  it('download → the STORED pdf as a blob from GET /screenhosts/statements/:id/pdf', async () => {
    const pdf = new Blob(['%PDF-1.3'], { type: 'application/pdf' });
    spies.getBlob.mockResolvedValue(pdf);
    await expect(facturesService.download('f1')).resolves.toBe(pdf);
    expect(spies.getBlob).toHaveBeenCalledWith('/screenhosts/statements/f1/pdf');
  });

  it('factureFilename mirrors the server content-disposition', () => {
    expect(factureFilename('FS-AAAA1111')).toBe('facture-FS-AAAA1111.pdf');
  });

  it('depositSigned POSTs multipart to the CHOSEN facture', async () => {
    spies.postForm.mockResolvedValue({ id: 'f2', deposited: true });
    const file = new File(['%PDF-1.3'], 'signee.pdf', { type: 'application/pdf' });
    await facturesService.depositSigned('f2', file);
    const [path, form] = spies.postForm.mock.calls[0] as [string, FormData];
    expect(path).toBe('/screenhosts/statements/f2/signed-deposit');
    expect(form.get('file')).toBe(file);
  });

  it('a re-deposit is the SAME call against the same id — the api replaces in place', async () => {
    spies.postForm.mockResolvedValue({ id: 'f2', deposited: true });
    const first = new File(['%PDF-1.3'], 'v1.pdf', { type: 'application/pdf' });
    const second = new File(['%PDF-1.4'], 'v2.pdf', { type: 'application/pdf' });
    await facturesService.depositSigned('f2', first);
    await facturesService.depositSigned('f2', second);
    const paths = spies.postForm.mock.calls.map((c) => c[0] as string);
    // One key per facture id server-side, so both deposits target one identical route: there is no
    // version parameter to get wrong and no orphan object left behind.
    expect(paths).toEqual([
      '/screenhosts/statements/f2/signed-deposit',
      '/screenhosts/statements/f2/signed-deposit',
    ]);
    const lastForm = spies.postForm.mock.calls[1][1] as FormData;
    expect(lastForm.get('file')).toBe(second);
  });

  it('the drop zone accepts exactly the document types the api sniffs', () => {
    expect(SIGNED_DEPOSIT_ACCEPT).toBe('application/pdf,image/jpeg,image/png');
  });
});
