import { describe, it, expect, vi, beforeEach } from 'vitest';

// ADM-SCR1 — the listing is on the toodooh API. Mock apiClient and pin the wire shape.
const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: getMock } }));

import { adminScreensService, buildAdminScreenhostsQuery } from './admin-screens.service';

describe('buildAdminScreenhostsQuery', () => {
  it('always carries pagination and only the filters that are set', () => {
    expect(buildAdminScreenhostsQuery({ page: 1, per_page: 20 })).toBe('?page=1&per_page=20');
    expect(
      buildAdminScreenhostsQuery({
        page: 3,
        per_page: 50,
        status: 'no_screens',
        owner_id: 'owner-1',
        search: ' Café Alpha ',
      }),
    ).toBe('?page=3&per_page=50&status=no_screens&owner_id=owner-1&search=Caf%C3%A9+Alpha');
  });

  it('treats an empty / whitespace search as no search', () => {
    expect(buildAdminScreenhostsQuery({ page: 1, per_page: 10, search: '   ' })).toBe(
      '?page=1&per_page=10',
    );
  });
});

describe('adminScreensService', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('list GETs /admin/screenhosts with the built query and returns the page verbatim', async () => {
    const page = { locations: [], total: 0, page: 2, per_page: 10 };
    getMock.mockResolvedValue(page);
    const result = await adminScreensService.list({ page: 2, per_page: 10, status: 'active' });
    expect(getMock).toHaveBeenCalledWith('/admin/screenhosts?page=2&per_page=10&status=active');
    expect(result).toBe(page);
  });

  it('owners GETs /admin/screenhosts/owners and unwraps the list', async () => {
    getMock.mockResolvedValue({ owners: [{ id: 'o1', business_name: 'Alpha' }] });
    await expect(adminScreensService.owners()).resolves.toEqual([
      { id: 'o1', business_name: 'Alpha' },
    ]);
    expect(getMock).toHaveBeenCalledWith('/admin/screenhosts/owners');
  });
});
