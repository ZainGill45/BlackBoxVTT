import { describe, expect, it, vi } from 'vitest';
import {
  campaignIpcChannels,
  type CampaignResult,
  type CampaignSummary,
} from '../shared/campaigns';
import { createCampaignApi } from './campaignApi';

describe('createCampaignApi', () => {
  it('exposes only list, create, and trash invocation methods', async () => {
    const response: CampaignResult<CampaignSummary[]> = {
      ok: true,
      value: [],
    };
    const invoke = vi.fn(async () => response);
    const api = createCampaignApi(invoke);

    await api.list();
    await api.create({ name: 'Iron Meridian' });
    await api.trash({ id: '8ef0e899-f66d-4a0b-9bd6-03c0f90c3325' });

    expect(Object.keys(api).sort()).toEqual(['create', 'list', 'trash']);
    expect(invoke).toHaveBeenNthCalledWith(1, campaignIpcChannels.list);
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      campaignIpcChannels.create,
      { name: 'Iron Meridian' },
    );
    expect(invoke).toHaveBeenNthCalledWith(
      3,
      campaignIpcChannels.trash,
      { id: '8ef0e899-f66d-4a0b-9bd6-03c0f90c3325' },
    );
  });
});
