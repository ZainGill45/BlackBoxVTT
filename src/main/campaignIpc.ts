import {
  campaignIpcChannels,
  type CampaignResult,
  type CampaignSummary,
} from '../shared/campaigns';

export interface CampaignRepositoryContract {
  create(input: unknown): Promise<CampaignResult<CampaignSummary>>;
  list(): Promise<CampaignResult<CampaignSummary[]>>;
  trash(input: unknown): Promise<CampaignResult<null>>;
}

export interface CampaignIpcRegistrar {
  handle(
    channel: string,
    listener: (event: unknown, input?: unknown) => unknown,
  ): void;
  removeHandler(channel: string): void;
}

export function registerCampaignIpcHandlers(
  ipc: CampaignIpcRegistrar,
  repository: CampaignRepositoryContract,
  beforeTrash?: (input: unknown) => Promise<void>,
) {
  ipc.removeHandler(campaignIpcChannels.list);
  ipc.removeHandler(campaignIpcChannels.create);
  ipc.removeHandler(campaignIpcChannels.trash);

  ipc.handle(campaignIpcChannels.list, () => repository.list());
  ipc.handle(campaignIpcChannels.create, (_event, input) =>
    repository.create(input),
  );
  ipc.handle(campaignIpcChannels.trash, async (_event, input) => {
    await beforeTrash?.(input);
    return repository.trash(input);
  });

  return () => {
    ipc.removeHandler(campaignIpcChannels.list);
    ipc.removeHandler(campaignIpcChannels.create);
    ipc.removeHandler(campaignIpcChannels.trash);
  };
}
