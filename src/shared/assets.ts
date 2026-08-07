import type { Result } from './result';

export const MAX_ASSET_BYTES = 1024 ** 3;
export const ASSET_CHUNK_BYTES = 512 * 1024;
export const MAX_EMBEDDED_IMAGE_BYTES = 32 * 1024 * 1024;

export const assetIpcChannels = {
  changed: 'assets:changed',
  error: 'assets:error',
  getPreview: 'assets:get-preview',
  list: 'assets:list',
  importImageBytes: 'assets:import-image-bytes',
  pickImages: 'assets:pick-images',
  pickAndImport: 'assets:pick-and-import',
  prepareRemote: 'assets:prepare-remote',
  progress: 'assets:progress',
  releasePreview: 'assets:release-preview',
  rename: 'assets:rename',
  trash: 'assets:trash',
} as const;

export type AssetKind = 'audio' | 'document' | 'image';
export const CANVAS_IMAGE_DRAG_TYPE = 'application/x-blackboxvtt-image';
export type AssetFormat =
  | 'gif'
  | 'jpeg'
  | 'm4a'
  | 'markdown'
  | 'mp3'
  | 'ogg'
  | 'pdf'
  | 'png'
  | 'text'
  | 'wav'
  | 'webp';

export type AssetAction =
  | 'delete'
  | 'import'
  | 'list'
  | 'preview'
  | 'read'
  | 'rename';

export type AssetCapability = Record<AssetAction, boolean>;

export interface AssetActor {
  id: string;
  role: 'gm' | 'player';
}

export interface AssetRecord {
  chunkHashes: string[];
  createdAt: string;
  createdBy: string;
  displayName: string;
  extension: string;
  fileModifiedAtMs: number;
  format: AssetFormat;
  id: string;
  kind: AssetKind;
  lastModifiedAt: string;
  lastModifiedBy: string;
  mimeType: string;
  originalFilename: string;
  revision: number;
  sha256: string;
  sizeBytes: number;
}

export interface AssetManifest {
  assets: AssetRecord[];
  revision: number;
}

export interface AssetPermissionEntry {
  assetId: string;
  capabilities: AssetCapability;
}

export interface AssetNetworkSnapshot {
  campaignCapabilities: AssetCapability;
  manifest: AssetManifest;
  permissions: AssetPermissionEntry[];
}

export interface AssetView extends AssetRecord {
  available: boolean;
  capabilities: AssetCapability;
  syncState: 'ready' | 'syncing' | 'unavailable';
}

export type AssetErrorCode =
  | 'conflict'
  | 'invalid_input'
  | 'not_found'
  | 'permission_denied'
  | 'storage_error'
  | 'sync_error'
  | 'unavailable';

export interface AssetError {
  assetId?: string;
  code: AssetErrorCode;
  message: string;
}

export type AssetResult<T> = Result<T, AssetError>;

export interface AssetCampaignInput {
  campaignId: string;
}

export interface RenameAssetInput extends AssetCampaignInput {
  assetId: string;
  displayName: string;
  expectedRevision: number;
}

export interface TrashAssetInput extends AssetCampaignInput {
  assetId: string;
  expectedRevision: number;
}

export interface AssetPreviewInput extends AssetCampaignInput {
  assetId: string;
}

export interface AssetPreview {
  assetId: string;
  displayName: string;
  format: AssetFormat;
  kind: AssetKind;
  mimeType: string;
  token: string;
  url: string;
}

export interface ReleaseAssetPreviewInput {
  token: string;
}

export interface ImportImageBytesInput extends AssetCampaignInput {
  bytesBase64: string;
  filename: string;
  mimeType: 'image/gif' | 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface AssetProgressEvent {
  assetId?: string;
  completedBytes: number;
  currentName?: string;
  phase: 'checking' | 'downloading' | 'hashing' | 'importing' | 'removing';
  scope: 'import' | 'preview' | 'sync';
  totalBytes: number | null;
}

export interface AssetChangedEvent {
  assets: AssetView[];
  campaignId: string;
  revision: number;
}

export interface AssetErrorEvent extends AssetError {
  campaignId?: string;
  playerName?: string;
  title: string;
}

export interface AssetApi {
  getPreview(input: AssetPreviewInput): Promise<AssetResult<AssetPreview>>;
  list(input: AssetCampaignInput): Promise<AssetResult<AssetView[]>>;
  importImageBytes(input: ImportImageBytesInput): Promise<AssetResult<AssetView[]>>;
  onChanged(listener: (event: AssetChangedEvent) => void): () => void;
  onError(listener: (event: AssetErrorEvent) => void): () => void;
  onProgress(listener: (event: AssetProgressEvent) => void): () => void;
  pickAndImport(input: AssetCampaignInput): Promise<AssetResult<AssetView[]>>;
  pickImages(input: AssetCampaignInput): Promise<AssetResult<AssetView[]>>;
  prepareRemote(input: AssetCampaignInput): Promise<AssetResult<AssetView[]>>;
  releasePreview(input: ReleaseAssetPreviewInput): Promise<void>;
  rename(input: RenameAssetInput): Promise<AssetResult<AssetView>>;
  trash(input: TrashAssetInput): Promise<AssetResult<null>>;
}

export type JournalAssetApi = Pick<
  AssetApi,
  'getPreview' | 'importImageBytes' | 'list' | 'pickImages' | 'releasePreview'
>;
