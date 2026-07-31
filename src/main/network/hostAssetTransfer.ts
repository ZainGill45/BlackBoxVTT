import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ASSET_CHUNK_BYTES, MAX_ASSET_BYTES } from '../../shared/assets';
import type { AssetRepository } from '../assetRepository';
import { getAssetCapabilities, type AssetPolicy } from '../assetPolicy';
import { actorFor, type HostClient } from './hostClient';
import { writeEnvelope } from './tcpProtocol';

export interface HostAssetTransferOptions {
  assetPolicy: AssetPolicy;
  assetRepository: AssetRepository;
  /** Re-sends the manifest to every ready client after a successful import. */
  broadcastAssetsChanged: () => Promise<void>;
  onAssetSyncError: (
    playerName: string,
    assetName: string,
    message: string,
  ) => void;
}

/**
 * Serves asset reads and accepts asset writes for connected players. Split out
 * of CampaignHostServer, which owns connection lifecycle rather than transfer:
 * everything here works from a client's socket plus the campaign's asset
 * repository, and touches no other host state.
 */
export class HostAssetTransfer {
  private readonly assetPolicy: AssetPolicy;
  private readonly assetRepository: AssetRepository;
  private readonly broadcastAssetsChanged: () => Promise<void>;
  private readonly onAssetSyncError: HostAssetTransferOptions['onAssetSyncError'];

  constructor({
    assetPolicy,
    assetRepository,
    broadcastAssetsChanged,
    onAssetSyncError,
  }: HostAssetTransferOptions) {
    this.assetPolicy = assetPolicy;
    this.assetRepository = assetRepository;
    this.broadcastAssetsChanged = broadcastAssetsChanged;
    this.onAssetSyncError = onAssetSyncError;
  }

  async sendAssetManifest(
    client: HostClient,
    requestId?: string,
  ): Promise<void> {
    writeEnvelope(
      client.socket as unknown as Socket,
      'server.asset_manifest',
      this.snapshotFor(client, await this.assetRepository.readManifest()),
      requestId,
    );
  }

  snapshotFor(
    client: HostClient,
    manifest: Awaited<ReturnType<AssetRepository['readManifest']>>,
  ) {
    const subject = actorFor(client);
    return {
      campaignCapabilities: getAssetCapabilities(
        this.assetPolicy,
        subject,
      ),
      manifest,
      permissions: manifest.assets.map((asset) => ({
        assetId: asset.id,
        capabilities: getAssetCapabilities(
          this.assetPolicy,
          subject,
          asset,
        ),
      })),
    };
  }

  async sendAssetChunk(
    client: HostClient,
    assetId: string,
    index: number,
    requestId?: string,
  ): Promise<void> {
    const manifest = await this.assetRepository.readManifest();
    const asset = manifest.assets.find((candidate) => candidate.id === assetId);
    if (!asset || index >= asset.chunkHashes.length) {
      this.sendAssetError(
        client,
        'not_found',
        'The requested asset chunk does not exist.',
        requestId,
        assetId,
      );
      return;
    }
    try {
      const handle = await open(this.assetRepository.resolveAssetPath(asset), 'r');
      let data: Buffer;
      try {
        const length = Math.min(
          ASSET_CHUNK_BYTES,
          asset.sizeBytes - index * ASSET_CHUNK_BYTES,
        );
        data = Buffer.allocUnsafe(length);
        const read = await handle.read(
          data,
          0,
          length,
          index * ASSET_CHUNK_BYTES,
        );
        data = data.subarray(0, read.bytesRead);
      } finally {
        await handle.close();
      }
      const hash = createHash('sha256').update(data).digest('hex');
      if (hash !== asset.chunkHashes[index]) {
        throw new Error('Host asset chunk failed integrity verification.');
      }
      writeEnvelope(
        client.socket as unknown as Socket,
        'server.asset_chunk',
        {
          assetId,
          data: data.toString('base64'),
          hash,
          index,
        },
        requestId,
      );
    } catch {
      this.sendAssetError(
        client,
        'unavailable',
        `${asset.displayName} is unavailable on the host.`,
        requestId,
        assetId,
      );
      this.onAssetSyncError(
        client.user?.username ?? 'Unknown player',
        asset.displayName,
        'The host file is missing or corrupt.',
      );
    }
  }

  async sendMutationResult(
    client: HostClient,
    result: {
      error?: {
        assetId?: string;
        code: string;
        message: string;
      };
      ok: boolean;
      value?: unknown;
    },
    requestId?: string,
  ): Promise<void> {
    if (!result.ok && result.error) {
      this.sendAssetError(
        client,
        result.error.code as Parameters<
          HostAssetTransfer['sendAssetError']
        >[1],
        result.error.message,
        requestId,
        result.error.assetId,
      );
      return;
    }
    const manifest = await this.assetRepository.readManifest();
    writeEnvelope(
      client.socket as unknown as Socket,
      'server.asset_mutation',
      {
        asset:
          result.value &&
          typeof result.value === 'object' &&
          !Array.isArray(result.value) &&
          'id' in result.value
            ? result.value
            : undefined,
        imported: Array.isArray(result.value) ? result.value : undefined,
        revision: manifest.revision,
      },
      requestId,
    );
  }

  sendAssetError(
    client: HostClient,
    code:
      | 'conflict'
      | 'invalid_input'
      | 'not_found'
      | 'permission_denied'
      | 'storage_error'
      | 'sync_error'
      | 'unavailable',
    message: string,
    requestId?: string,
    assetId?: string,
  ): void {
    writeEnvelope(
      client.socket as unknown as Socket,
      'server.asset_error',
      { assetId, code, message },
      requestId,
    );
  }

  async startAssetUpload(
    client: HostClient,
    input: {
      displayName: string;
      originalFilename: string;
      sizeBytes: number;
    },
    requestId?: string,
  ): Promise<void> {
    if (input.sizeBytes > MAX_ASSET_BYTES) {
      this.sendAssetError(
        client,
        'invalid_input',
        'The selected file exceeds the 1 GiB limit.',
        requestId,
      );
      return;
    }
    const uploadId = randomUUID();
    const directory = await mkdtemp(path.join(tmpdir(), 'blackbox-upload-'));
    const extension = path.extname(path.basename(input.originalFilename));
    const filePath = path.join(directory, `${uploadId}${extension}`);
    await mkdir(directory, { recursive: true });
    const handle = await open(filePath, 'w');
    await handle.close();
    client.uploads.set(uploadId, {
      directory,
      displayName: input.displayName,
      filePath,
      originalFilename: path.basename(input.originalFilename),
      receivedBytes: 0,
      sizeBytes: input.sizeBytes,
    });
    writeEnvelope(
      client.socket as unknown as Socket,
      'server.asset_import_ready',
      { uploadId },
      requestId,
    );
  }

  async receiveAssetUploadChunk(
    client: HostClient,
    input: {
      data: string;
      hash: string;
      index: number;
      uploadId: string;
    },
    requestId?: string,
  ): Promise<void> {
    const upload = client.uploads.get(input.uploadId);
    if (!upload || input.index * ASSET_CHUNK_BYTES !== upload.receivedBytes) {
      this.sendAssetError(
        client,
        'invalid_input',
        'The asset upload is no longer active.',
        requestId,
      );
      return;
    }
    const data = Buffer.from(input.data, 'base64');
    if (
      data.length > ASSET_CHUNK_BYTES ||
      createHash('sha256').update(data).digest('hex') !== input.hash ||
      upload.receivedBytes + data.length > upload.sizeBytes
    ) {
      this.sendAssetError(
        client,
        'sync_error',
        'An uploaded asset chunk failed validation.',
        requestId,
      );
      return;
    }
    const handle = await open(upload.filePath, 'a');
    try {
      await handle.write(data);
    } finally {
      await handle.close();
    }
    upload.receivedBytes += data.length;
    writeEnvelope(
      client.socket as unknown as Socket,
      'server.asset_import_ready',
      { uploadId: input.uploadId },
      requestId,
    );
  }

  async commitAssetUpload(
    client: HostClient,
    uploadId: string,
    requestId?: string,
  ): Promise<void> {
    const upload = client.uploads.get(uploadId);
    if (!upload) {
      this.sendAssetError(
        client,
        'invalid_input',
        'The asset upload is no longer active.',
        requestId,
      );
      return;
    }
    try {
      if ((await stat(upload.filePath)).size !== upload.sizeBytes) {
        throw new Error('The asset upload is incomplete.');
      }
      const result = await this.assetRepository.importFiles(
        [
          {
            displayName: upload.displayName,
            originalFilename: upload.originalFilename,
            sourcePath: upload.filePath,
          },
        ],
        actorFor(client),
      );
      await this.sendMutationResult(client, result, requestId);
      if (result.ok) {
        await this.broadcastAssetsChanged();
      }
    } catch (error) {
      this.sendAssetError(
        client,
        'storage_error',
        error instanceof Error
          ? error.message
          : 'The asset could not be imported.',
        requestId,
      );
    } finally {
      client.uploads.delete(uploadId);
      await rm(upload.directory, { force: true, recursive: true });
    }
  }

}
