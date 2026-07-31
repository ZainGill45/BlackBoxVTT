import {
  campaignIpcChannels,
  type CampaignApi,
  type CampaignIdInput,
  type CreateCampaignInput,
} from '../shared/campaigns';

type IpcInvoke = (
  channel: string,
  input?: CreateCampaignInput | CampaignIdInput,
) => Promise<unknown>;

export function createCampaignApi(invoke: IpcInvoke): CampaignApi {
  return {
    create: (input) =>
      invoke(campaignIpcChannels.create, input) as ReturnType<
        CampaignApi['create']
      >,
    list: () =>
      invoke(campaignIpcChannels.list) as ReturnType<CampaignApi['list']>,
    trash: (input) =>
      invoke(campaignIpcChannels.trash, input) as ReturnType<
        CampaignApi['trash']
      >,
  };
}
