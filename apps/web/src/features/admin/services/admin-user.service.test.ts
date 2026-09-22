import { describe, it, expect, vi, beforeEach } from 'vitest';

// F-docs Commit 4 — pin the admin doc-review service contract. Mock the apiClient and assert the
// exact route shapes. The load-bearing claim: getDocumentUrlById presigns via the uuid
// `/:ref/url` route, NEVER the legacy `/:ref` category shim (which collapses to the lowest
// position and loses recto-vs-verso). A regression there is a real risk flagged in review.
const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: getMock } }));

import { adminUserService } from './admin-user.service';

describe('adminUserService document review', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('getDocumentUrlById hits the uuid /:ref/url route, NOT the legacy /:ref shim', async () => {
    getMock.mockResolvedValue({ url: 'https://signed.example/doc' });

    const url = await adminUserService.getDocumentUrlById('user-1', 'doc-uuid-9');

    expect(getMock).toHaveBeenCalledWith('/admin/users/user-1/documents/doc-uuid-9/url');
    // Guard the regression explicitly: the called path must end in /url (the uuid route), and must
    // not be the bare category shim.
    const calledWith = getMock.mock.calls[0][0] as string;
    expect(calledWith.endsWith('/url')).toBe(true);
    expect(calledWith).not.toBe('/admin/users/user-1/documents/doc-uuid-9');
    expect(url).toBe('https://signed.example/doc');
  });

  it('getUserDocuments reads the grouped listing and returns the documents map', async () => {
    const documents = { rne: [], complementaire: [], bank: [] };
    getMock.mockResolvedValue({ documents });

    const result = await adminUserService.getUserDocuments('user-1');

    expect(getMock).toHaveBeenCalledWith('/admin/users/user-1/documents');
    expect(result).toBe(documents);
  });
});
