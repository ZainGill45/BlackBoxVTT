import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  campaignIpcChannels,
  type CampaignResult,
  type CampaignSummary,
} from '../../../shared/campaigns';
import { createCampaignApi } from '../../../preload/campaignApi';

const campaignId = '8ef0e899-f66d-4a0b-9bd6-03c0f90c3325';

let invoke: ReturnType<typeof vi.fn>;
let api: ReturnType<typeof createCampaignApi>;

beforeEach(() => {
  const response: CampaignResult<CampaignSummary[]> = { ok: true, value: [] };
  invoke = vi.fn(async () => response);
  api = createCampaignApi(invoke);
});

describe('createCampaignApi', () => {
  it('exposes exactly the campaign operations', () => {
    // The preload bridge is the contextIsolation boundary; anything added here
    // becomes reachable from renderer code.
    expect(Object.keys(api).sort()).toEqual([
      'create',
      'export',
      'import',
      'list',
      'trash',
    ]);
  });

  it('sends a list request with no payload', async () => {
    await api.list();

    expect(invoke).toHaveBeenCalledWith(campaignIpcChannels.list);
  });

  it('sends a create request with the campaign name', async () => {
    await api.create({ name: 'Iron Meridian' });

    // A swapped channel constant still typechecks, so the pairing is asserted.
    expect(invoke).toHaveBeenCalledWith(campaignIpcChannels.create, {
      name: 'Iron Meridian',
    });
  });

  it('sends a trash request with the campaign id', async () => {
    await api.trash({ id: campaignId });

    expect(invoke).toHaveBeenCalledWith(campaignIpcChannels.trash, {
      id: campaignId,
    });
  });

  it('sends export and import requests over their dedicated channels', async () => {
    await api.export({ id: campaignId });
    await api.import();

    expect(invoke).toHaveBeenCalledWith(campaignIpcChannels.export, {
      id: campaignId,
    });
    expect(invoke).toHaveBeenCalledWith(campaignIpcChannels.import);
  });
});
