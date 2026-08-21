import type { Result } from './result';
import type {
  PermissionConfiguration,
  PermissionSubject,
} from './permissions';

export const MAX_ASSET_BYTES = 1024 ** 3;
export const ASSET_CHUNK_BYTES = 512 * 1024;
export const MAX_EMBEDDED_IMAGE_BYTES = 32 * 1024 * 1024;
export const MAX_ASSET_PERMISSION_OVERRIDES = 20;

export const assetIpcChannels = {
  changed: 'assets:changed',
  error: 'assets:error',
  getPreview: 'assets:get-preview',
  list: 'assets:list',
  listUsers: 'assets:list-users',
  importImageBytes: 'assets:import-image-bytes',
  pickImages: 'assets:pick-images',
  pickAndImport: 'assets:pick-and-import',
  preparePreviews: 'assets:prepare-previews',
  prepareRemote: 'assets:prepare-remote',
  progress: 'assets:progress',
  releasePreview: 'assets:release-preview',
  rename: 'assets:rename',
  reorder: 'assets:reorder',
  trash: 'assets:trash',
  updatePermissions: 'assets:update-permissions',
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
  /* Campaign-level rather than per-asset, and only ever the Game Master's. */
  | 'managePermissions'
  | 'preview'
  | 'read'
  | 'rename'
  /* List-level rather than per-asset: it orders the shared library, so it is
     reported on every asset but only ever granted to the Game Master. */
  | 'reorder';

export type AssetCapability = Record<AssetAction, boolean>;

/**
 * What a player may do with one asset in the Storage library.
 *
 * This curates the library rather than sealing a file: `read` stays open to any
 * authenticated player so that a map image, an embedded Journal image, or any
 * other asset referenced by content they can already see still renders. No
 * access means the asset is absent from their Storage panel, not that its bytes
 * are unreachable.
 */
export type AssetAccessLevel = 'edit' | 'none' | 'view';

export const ASSET_ACCESS_LEVELS: readonly AssetAccessLevel[] = [
  'none',
  'view',
  'edit',
];

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
  permissionRevision: number;
  /** Only the Game Master receives a configuration to edit. */
  permissions: PermissionConfiguration<AssetAccessLevel> | null;
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

/**
 * Ordering is scoped to one kind group because that is how Storage presents it.
 *
 * There is no expected-revision field. Reordering touches no asset, so no asset
 * revision moves, and the manifest revision never reaches the renderer — the
 * `revision` on AssetChangedEvent is the highest asset revision, not the
 * manifest's. The guard instead is that `orderedAssetIds` must match the kind
 * group exactly, which rejects the changes that would corrupt an order (an
 * asset imported or deleted underneath the caller) and lets the harmless one
 * through as last-write-wins (two clients reordering the same set).
 */
export interface ReorderAssetsInput extends AssetCampaignInput {
  kind: AssetKind;
  orderedAssetIds: string[];
}

export interface AssetPreviewInput extends AssetCampaignInput {
  assetId: string;
}

export interface UpdateAssetPermissionsInput extends AssetCampaignInput {
  assetId: string;
  expectedPermissionRevision: number;
  permissions: PermissionConfiguration<AssetAccessLevel>;
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

/** Successfully retained preview grants plus assets that could not be warmed. */
export interface PreparedAssetPreviews {
  failedAssetIds: string[];
  previews: AssetPreview[];
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
  campaignId?: string;
  completedBytes: number;
  completedItems?: number;
  currentName?: string;
  phase:
    | 'caching'
    | 'checking'
    | 'downloading'
    | 'hashing'
    | 'importing'
    | 'removing';
  scope: 'import' | 'preload' | 'preview' | 'sync';
  totalBytes: number | null;
  totalItems?: number;
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
  listUsers(input: AssetCampaignInput): Promise<AssetResult<PermissionSubject[]>>;
  importImageBytes(input: ImportImageBytesInput): Promise<AssetResult<AssetView[]>>;
  onChanged(listener: (event: AssetChangedEvent) => void): () => void;
  onError(listener: (event: AssetErrorEvent) => void): () => void;
  onProgress(listener: (event: AssetProgressEvent) => void): () => void;
  pickAndImport(input: AssetCampaignInput): Promise<AssetResult<AssetView[]>>;
  pickImages(input: AssetCampaignInput): Promise<AssetResult<AssetView[]>>;
  preparePreviews(
    input: AssetCampaignInput,
  ): Promise<AssetResult<PreparedAssetPreviews>>;
  prepareRemote(input: AssetCampaignInput): Promise<AssetResult<AssetView[]>>;
  releasePreview(input: ReleaseAssetPreviewInput): Promise<void>;
  rename(input: RenameAssetInput): Promise<AssetResult<AssetView>>;
  reorder(input: ReorderAssetsInput): Promise<AssetResult<AssetView[]>>;
  trash(input: TrashAssetInput): Promise<AssetResult<null>>;
  updatePermissions(input: UpdateAssetPermissionsInput): Promise<AssetResult<AssetView>>;
}

export type JournalAssetApi = Pick<
  AssetApi,
  'getPreview' | 'importImageBytes' | 'list' | 'pickImages' | 'releasePreview'
>;
