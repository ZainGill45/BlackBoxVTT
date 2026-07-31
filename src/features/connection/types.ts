import type {
  CampaignResult,
  CampaignSummary,
} from '../../shared/campaigns';
import type {
  NetworkApi,
  RemotePlaySession,
} from '../../shared/network';

export type ConnectionTab = 'join' | 'create';

export interface JoinCampaignDraft {
  host: string;
  port: string;
}

export interface CreateCampaignDraft {
  name: string;
}

type CampaignLoadState = 'error' | 'loading' | 'ready';

export interface ConnectionScreenProps {
  campaignLoadError: string | null;
  campaignLoadState: CampaignLoadState;
  campaigns: readonly CampaignSummary[];
  connectionNotice?: string | null;
  networkApi: NetworkApi;
  onRemoteAuthenticated: (session: RemotePlaySession) => void;
  onCreate: (
    draft: CreateCampaignDraft,
  ) => Promise<CampaignResult<CampaignSummary>>;
  onDeleteCampaign: (id: string) => Promise<CampaignResult<null>>;
  onOpenCampaign: (id: string) => void;
}
