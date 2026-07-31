import type { Result } from './result';

export const CAMPAIGN_SCHEMA_VERSION = 1 as const;

export const campaignIpcChannels = {
  create: 'campaigns:create',
  list: 'campaigns:list',
  trash: 'campaigns:trash',
} as const;

export type CampaignErrorCode =
  | 'duplicate_name'
  | 'invalid_name'
  | 'not_found'
  | 'storage_error';

export interface CampaignError {
  code: CampaignErrorCode;
  message: string;
}

export interface CampaignManifest {
  createdAt: string;
  id: string;
  name: string;
  schemaVersion: typeof CAMPAIGN_SCHEMA_VERSION;
  updatedAt: string;
}

export type CampaignSummary = CampaignManifest;

export interface CreateCampaignInput {
  name: string;
}

export interface CampaignIdInput {
  id: string;
}

export type CampaignResult<T> = Result<T, CampaignError>;

export interface CampaignApi {
  create(
    input: CreateCampaignInput,
  ): Promise<CampaignResult<CampaignSummary>>;
  list(): Promise<CampaignResult<CampaignSummary[]>>;
  trash(input: CampaignIdInput): Promise<CampaignResult<null>>;
}
