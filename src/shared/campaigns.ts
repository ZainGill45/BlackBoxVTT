import type { Result } from './result';
import type { CampaignSystemState } from './gameSystems';

export const campaignIpcChannels = {
  create: 'campaigns:create',
  export: 'campaigns:export',
  import: 'campaigns:import',
  list: 'campaigns:list',
  trash: 'campaigns:trash',
} as const;

export type CampaignErrorCode =
  | 'duplicate_name'
  | 'invalid_archive'
  | 'invalid_name'
  | 'not_found'
  | 'storage_error'
  | 'unsupported_archive'
  | 'unsupported_system';

export interface CampaignError {
  code: CampaignErrorCode;
  message: string;
}

export interface CampaignManifest {
  createdAt: string;
  id: string;
  name: string;
  system: CampaignSystemState;
  updatedAt: string;
}

export interface UnavailableCampaignSummary {
  id: string;
  name: string;
  unavailableReason: 'unsupported_data';
  updatedAt: string;
}

export type CampaignSummary = CampaignManifest | UnavailableCampaignSummary;

export function isUnavailableCampaignSummary(
  campaign: CampaignSummary,
): campaign is UnavailableCampaignSummary {
  return 'unavailableReason' in campaign;
}

export interface CreateCampaignInput {
  name: string;
  systemId?: string;
}

export interface CampaignIdInput {
  id: string;
}

export interface CampaignExportReceipt {
  fileName: string;
}

export interface CampaignImportReport {
  sourceRelease: string;
  warnings: string[];
}

export interface CampaignImportReceipt {
  campaign: CampaignManifest;
  report: CampaignImportReport;
}

export type CampaignResult<T> = Result<T, CampaignError>;

export interface CampaignApi {
  create(
    input: CreateCampaignInput,
  ): Promise<CampaignResult<CampaignManifest>>;
  export(
    input: CampaignIdInput,
  ): Promise<CampaignResult<CampaignExportReceipt | null>>;
  import(): Promise<CampaignResult<CampaignImportReceipt | null>>;
  list(): Promise<CampaignResult<CampaignSummary[]>>;
  trash(input: CampaignIdInput): Promise<CampaignResult<null>>;
}
