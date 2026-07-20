import { beforeEach, describe, expect, it, vi } from 'vitest';

// CF-M2 — pin the admin justificatif wire + the review modal's render-mode decision. Same
// apiClient-stub pattern as wallet.service.test.ts.
const spies = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({ apiClient: spies }));

import { adminRechargesService, documentDisplayMode } from './admin-recharges.service';

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
