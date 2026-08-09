import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ASSET_CHUNK_BYTES, MAX_ASSET_BYTES } from '../../shared/assets';
import type { AssetRepository } from '../assetRepository';
import { getAssetCapabilities, type AssetPolicy } from '../assetPolicy';
import { actorFor, type HostClient } from './hostClient';
import {
  parsePayload,
  writeEnvelope,
  type TcpEnvelope,
} from './tcpProtocol';

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
    const access = this.assetRepository.accessByAsset(subject);
    /* The manifest stays whole. A client only downloads what its manifest
       lists, so withholding rows here would stop a map image or an embedded
       Journal image from ever reaching the player who can already see the
       content using it. What each asset carries instead is the access the
       Game Master gave: `list` is what keeps it out of their Storage library,
       and rename and delete are refused here as well as hidden there. */
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
          access.get(asset.id),
        ),
      })),
    };
  }

  /** The subject's access to one asset, for authorizing a single request. */
  private accessTo(client: HostClient, assetId: string) {
    return this.assetRepository.accessByAsset(actorFor(client)).get(assetId);
  }

  /** Routes authenticated asset protocol requests away from host transport. */
  async handleRequest(
    client: HostClient,
    envelope: TcpEnvelope,
  ): Promise<boolean> {
    if (envelope.type === 'client.asset_manifest') {
      if (!this.assetPolicy.authorize({
        action: 'list',
        subject: actorFor(client),
      })) {
        this.sendAssetError(
          client,
          'permission_denied',
          'You cannot view campaign assets.',
          envelope.requestId,
        );
        return true;
      }
      parsePayload('client.asset_manifest', envelope.payload);
      await this.sendAssetManifest(client, envelope.requestId);
      return true;
    }
    if (envelope.type === 'client.asset_chunk_request') {
      const input = parsePayload(
        'client.asset_chunk_request',
        envelope.payload,
      );
      const asset = (await this.assetRepository.readManifest()).assets.find(
        (candidate) => candidate.id === input.assetId,
      );
      if (!this.assetPolicy.authorize({
        action: 'read',
        asset,
        subject: actorFor(client),
      })) {
        this.sendAssetError(
          client,
          'permission_denied',
          'You cannot read this campaign asset.',
          envelope.requestId,
          input.assetId,
        );
        return true;
      }
      await this.sendAssetChunk(
        client,
        input.assetId,
        input.index,
        envelope.requestId,
      );
      return true;
    }
    if (envelope.type === 'client.asset_rename') {
      const input = parsePayload('client.asset_rename', envelope.payload);
      const asset = (await this.assetRepository.readManifest()).assets.find(
        (candidate) => candidate.id === input.assetId,
      );
      if (!this.assetPolicy.authorize({
        access: this.accessTo(client, input.assetId),
        action: 'rename',
        asset,
        subject: actorFor(client),
      })) {
        this.sendAssetError(
          client,
          'permission_denied',
          'You cannot rename this campaign asset.',
          envelope.requestId,
          input.assetId,
        );
        return true;
      }
      const result = await this.assetRepository.renameAsset(
        input.assetId,
        input.displayName,
        input.expectedRevision,
        actorFor(client),
      );
      await this.sendMutationResult(client, result, envelope.requestId);
      if (result.ok) {
        await this.broadcastAssetsChanged();
      }
      return true;
    }
    if (envelope.type === 'client.asset_reorder') {
      const input = parsePayload('client.asset_reorder', envelope.payload);
      /* No asset passed: ordering belongs to the list, and the policy grants
         it to the Game Master alone. */
      if (!this.assetPolicy.authorize({
        action: 'reorder',
        subject: actorFor(client),
      })) {
        this.sendAssetError(
          client,
          'permission_denied',
          'You cannot reorder campaign assets.',
          envelope.requestId,
        );
        return true;
      }
      const result = await this.assetRepository.reorderAssets(
        input.kind,
        input.orderedAssetIds,
      );
      await this.sendMutationResult(client, result, envelope.requestId);
      if (result.ok) {
        await this.broadcastAssetsChanged();
      }
      return true;
    }
    if (envelope.type === 'client.asset_delete') {
      const input = parsePayload('client.asset_delete', envelope.payload);
      const asset = (await this.assetRepository.readManifest()).assets.find(
        (candidate) => candidate.id === input.assetId,
      );
      if (!this.assetPolicy.authorize({
        access: this.accessTo(client, input.assetId),
        action: 'delete',
        asset,
        subject: actorFor(client),
      })) {
        this.sendAssetError(
          client,
          'permission_denied',
          'You cannot delete this campaign asset.',
          envelope.requestId,
          input.assetId,
        );
        return true;
      }
      const result = await this.assetRepository.trashAsset(
        input.assetId,
        input.expectedRevision,
      );
      await this.sendMutationResult(client, result, envelope.requestId);
      if (result.ok) {
        await this.broadcastAssetsChanged();
      }
      return true;
    }
    if (envelope.type === 'client.asset_import_start') {
      const input = parsePayload(
        'client.asset_import_start',
        envelope.payload,
      );
      if (!this.assetPolicy.authorize({
        action: 'import',
        subject: actorFor(client),
      })) {
        this.sendAssetError(
          client,
          'permission_denied',
          'You cannot add campaign assets.',
          envelope.requestId,
        );
        return true;
      }
      await this.startAssetUpload(client, input, envelope.requestId);
      return true;
    }
    if (envelope.type === 'client.asset_import_chunk') {
      const input = parsePayload(
        'client.asset_import_chunk',
        envelope.payload,
      );
      await this.receiveAssetUploadChunk(client, input, envelope.requestId);
      return true;
    }
    if (envelope.type === 'client.asset_import_commit') {
      const input = parsePayload(
        'client.asset_import_commit',
        envelope.payload,
      );
      await this.commitAssetUpload(
        client,
        input.uploadId,
        envelope.requestId,
      );
      return true;
    }
    if (envelope.type === 'client.asset_sync_error') {
      const input = parsePayload(
        'client.asset_sync_error',
        envelope.payload,
      );
      this.onAssetSyncError(
        client.user?.username ?? 'Unknown player',
        input.assetName,
        input.reason,
      );
      return true;
    }
    return false;
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
