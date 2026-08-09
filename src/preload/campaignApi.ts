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
    export: (input) =>
      invoke(campaignIpcChannels.export, input) as ReturnType<
        CampaignApi['export']
      >,
    import: () =>
      invoke(campaignIpcChannels.import) as ReturnType<CampaignApi['import']>,
    list: () =>
      invoke(campaignIpcChannels.list) as ReturnType<CampaignApi['list']>,
    salvage: (input) =>
      invoke(campaignIpcChannels.salvage, input) as ReturnType<
        CampaignApi['salvage']
      >,
    trash: (input) =>
      invoke(campaignIpcChannels.trash, input) as ReturnType<
        CampaignApi['trash']
      >,
  };
}
