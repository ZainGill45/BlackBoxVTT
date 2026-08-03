import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAMPAIGN_SCHEMA_VERSION,
  campaignIpcChannels,
  type CampaignSummary,
} from '../../../shared/campaigns';
import {
  registerCampaignIpcHandlers,
  type CampaignIpcRegistrar,
  type CampaignRepositoryContract,
} from '../../../main/campaignIpc';
import { TEST_CAMPAIGN_SYSTEM } from '../../support/gameSystems';

const campaign: CampaignSummary = {
  createdAt: '2026-07-26T05:00:00.000Z',
  id: '8ef0e899-f66d-4a0b-9bd6-03c0f90c3325',
  name: 'Shattered Coast',
  schemaVersion: CAMPAIGN_SCHEMA_VERSION,
  system: TEST_CAMPAIGN_SYSTEM,
  updatedAt: '2026-07-26T05:00:00.000Z',
};

let handlers: Map<string, (event: unknown, input?: unknown) => unknown>;
let repository: CampaignRepositoryContract;
let unregister: () => void;

beforeEach(() => {
  handlers = new Map();
  const ipc: CampaignIpcRegistrar = {
    handle: vi.fn((channel, listener) => {
      handlers.set(channel, listener);
    }),
    removeHandler: vi.fn((channel) => {
      handlers.delete(channel);
    }),
  };
  repository = {
    create: vi.fn(async () => ({ ok: true as const, value: campaign })),
    list: vi.fn(async () => ({ ok: true as const, value: [campaign] })),
    trash: vi.fn(async () => ({ ok: true as const, value: null })),
  };
  unregister = registerCampaignIpcHandlers(ipc, repository);
});

describe('registerCampaignIpcHandlers', () => {
  it('registers exactly the three campaign channels', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        campaignIpcChannels.create,
        campaignIpcChannels.list,
        campaignIpcChannels.trash,
      ].sort(),
    );
  });

  it('forwards a list request with no arguments', async () => {
    await handlers.get(campaignIpcChannels.list)?.({});

    expect(repository.list).toHaveBeenCalledWith();
  });

  it('forwards the create input to the repository', async () => {
    const createInput = { name: 'Shattered Coast' };

    await handlers.get(campaignIpcChannels.create)?.({}, createInput);

    expect(repository.create).toHaveBeenCalledWith(createInput);
  });

  it('forwards the trash input to the repository', async () => {
    const trashInput = { id: campaign.id };

    await handlers.get(campaignIpcChannels.trash)?.({}, trashInput);

    expect(repository.trash).toHaveBeenCalledWith(trashInput);
  });

  it('removes every handler on unregister', () => {
    unregister();

    expect(handlers).toHaveLength(0);
  });
});
