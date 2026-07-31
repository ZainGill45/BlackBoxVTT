import { describe, expect, it, vi } from 'vitest';
import {
  CAMPAIGN_SCHEMA_VERSION,
  campaignIpcChannels,
  type CampaignSummary,
} from '../shared/campaigns';
import {
  registerCampaignIpcHandlers,
  type CampaignIpcRegistrar,
  type CampaignRepositoryContract,
} from './campaignIpc';

const campaign: CampaignSummary = {
  createdAt: '2026-07-26T05:00:00.000Z',
  id: '8ef0e899-f66d-4a0b-9bd6-03c0f90c3325',
  name: 'Shattered Coast',
  schemaVersion: CAMPAIGN_SCHEMA_VERSION,
  updatedAt: '2026-07-26T05:00:00.000Z',
};

describe('registerCampaignIpcHandlers', () => {
  it('registers narrow handlers and forwards validated repository inputs', async () => {
    const handlers = new Map<
      string,
      (event: unknown, input?: unknown) => unknown
    >();
    const ipc: CampaignIpcRegistrar = {
      handle: vi.fn((channel, listener) => {
        handlers.set(channel, listener);
      }),
      removeHandler: vi.fn((channel) => {
        handlers.delete(channel);
      }),
    };
    const repository: CampaignRepositoryContract = {
      create: vi.fn(async () => ({ ok: true as const, value: campaign })),
      list: vi.fn(async () => ({
        ok: true as const,
        value: [campaign],
      })),
      trash: vi.fn(async () => ({ ok: true as const, value: null })),
    };

    const unregister = registerCampaignIpcHandlers(ipc, repository);
    const createInput = { name: 'Shattered Coast' };
    const trashInput = { id: campaign.id };

    await handlers.get(campaignIpcChannels.list)?.({});
    await handlers.get(campaignIpcChannels.create)?.({}, createInput);
    await handlers.get(campaignIpcChannels.trash)?.({}, trashInput);

    expect(repository.list).toHaveBeenCalledWith();
    expect(repository.create).toHaveBeenCalledWith(createInput);
    expect(repository.trash).toHaveBeenCalledWith(trashInput);
    expect(handlers).toHaveLength(3);

    unregister();
    expect(handlers).toHaveLength(0);
  });
});
