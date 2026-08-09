import type { Result } from './result';
import type { CampaignSystemState } from './gameSystems';

export const campaignIpcChannels = {
  create: 'campaigns:create',
  export: 'campaigns:export',
  import: 'campaigns:import',
  list: 'campaigns:list',
  salvage: 'campaigns:salvage',
  trash: 'campaigns:trash',
} as const;

export type CampaignErrorCode =
  | 'duplicate_name'
  | 'invalid_archive'
  | 'invalid_name'
  | 'not_found'
  | 'storage_error'
  | 'unsalvageable'
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

/**
 * A local campaign records no release, so salvage reports the archive format
 * its data was recognized as instead of where the data came from.
 */
export interface CampaignSalvageReport {
  detectedFormat: number;
  warnings: string[];
}

export interface CampaignSalvageReceipt {
  campaign: CampaignManifest;
  /** Whether the unreadable source was successfully moved to the trash. */
  originalTrashed: boolean;
  report: CampaignSalvageReport;
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
  salvage(
    input: CampaignIdInput,
  ): Promise<CampaignResult<CampaignSalvageReceipt>>;
  trash(input: CampaignIdInput): Promise<CampaignResult<null>>;
}
