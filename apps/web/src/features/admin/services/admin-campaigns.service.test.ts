import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: getMock, post: vi.fn() } }));

import { adminCampaignsService } from './admin-campaigns.service';

describe('adminCampaignsService.getReversements', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('GETs the admin reversements breakdown for a campaign', async () => {
    const body = {
      campaign_id: 'c1',
      lines: [],
      totals: {
        base_value_tnd: 0,
        sh_amount_tnd: 0,
        toodooh_amount_tnd: 0,
        agent_sh_amount_tnd: 0,
        agent_sc_amount_tnd: 0,
      },
    };
    getMock.mockResolvedValue(body);
    const result = await adminCampaignsService.getReversements('c1');
    expect(getMock).toHaveBeenCalledWith('/admin/campaigns/c1/reversements');
    expect(result).toEqual(body);
  });

  it('propagates apiClient errors', async () => {
    getMock.mockRejectedValue(new Error('boom'));
    await expect(adminCampaignsService.getReversements('c1')).rejects.toThrow('boom');
  });
});
