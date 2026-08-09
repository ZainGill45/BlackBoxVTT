import { createHash, X509Certificate } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import tls, { type TLSSocket } from 'node:tls';
import { isDeepStrictEqual } from 'node:util';
import {
  CHAT_SEND_TIMEOUT_MS,
  type ChatBootstrap,
  type ChatErrorCode,
  type ChatEvent,
  type ChatHistoryInput,
  type ChatHistoryPage,
  type ChatMessage,
  type ChatResult,
  type SendChatMessageInput,
  type SendChatRollInput,
} from '../../shared/chat';
import { CHAT_ROLL_SEND_TIMEOUT_MS } from '../../shared/chatRoll';
import {
  ASSET_CHUNK_BYTES,
  type AssetError,
  type AssetKind,
  type AssetNetworkSnapshot,
  type AssetProgressEvent,
  type AssetRecord,
  type AssetResult,
} from '../../shared/assets';
import {
  NETWORK_PROTOCOL_VERSION,
  type AuthenticationChallenge,
  type ClientConnectionState,
  type ConnectInput,
  type ConnectStep,
  type DrawingPreviewEvent,
  type DrawingPreviewUpdate,
  type MapPing,
  type MeasurementEvent,
  type MeasurementUpdate,
  type NetworkErrorCode,
  type NetworkResult,
  type RemotePlaySession,
  type ShapePreviewEvent,
  type ShapePreviewUpdate,
} from '../../shared/network';
import type {
  SceneError,
  SceneHistoryInput,
  SceneManifest,
  SceneObjectState,
  ScenePatch,
  SceneRecord,
  SceneResult,
  SceneTransformPreviewCancel,
  SceneTransformPreviewDelta,
  SceneTransformPreviewStart,
  SetSceneObjectsInput,
} from '../../shared/scenes';
import { fail } from '../../shared/result';
import { ClientNetworkSession } from './clientNetworkSession';
import { associateUdp } from './udpAssociation';
import { TcpClientChannel } from './tcpClientChannel';
import type {
  ConnectionHistoryRepository,
  StoredConnection,
} from './connectionHistoryRepository';
import { parsePayload, ProtocolVersionMismatchError } from './tcpProtocol';
import { deserializeUdpCredentials } from './udpProtocol';
import type { CampaignSystemState } from '../../shared/gameSystems';
import { parseCampaignSystemState } from '../../systems/catalog';
import type {
  DeleteJournalTargetInput,
  JournalChangedEvent,
  JournalAssetDependent,
  JournalDeletePreview,
  JournalDeleteResult,
  JournalEntry,
  JournalManifest,
  JournalPage,
  JournalResult,
  MoveJournalEntryInput,
  MoveJournalPageInput,
  NoteEntry,
  PageEditLease,
  ReorderJournalEntriesInput,
  ReorderJournalGroupInput,
  ReorderJournalPagesInput,
  UpdateJournalEntryDataInput,
  UpdateJournalNotePermissionsInput,
  UpdateJournalEntryPermissionsInput,
  UpdateJournalPagePermissionsInput,
} from '../../shared/journal';
import type {
  PermissionSubject,
} from '../../shared/permissions';
import type { ProtocolMessageType } from './tcpProtocol';

const TCP_CONNECT_TIMEOUT_MS = 10_000;
const UDP_ASSOCIATION_TIMEOUT_MS = 10_000;

function failure<T>(
  code: NetworkErrorCode,
  message: string,
): NetworkResult<T> {
  return fail({ code, message });
}

function chatFailure<T>(
  code: ChatErrorCode,
  message: string,
): ChatResult<T> {
  return fail({ code, message });
}

interface ClientAttempt {
  campaignId: string;
  campaignName: string;
  channel: TcpClientChannel;
  fingerprint: string;
  history: StoredConnection | null;
  host: string;
  id: string;
  pendingTrust: boolean;
  port: number;
  system: CampaignSystemState;
}


interface CampaignClientOptions {
  historyRepository: ConnectionHistoryRepository;
  onChatEvent?: (event: ChatEvent) => void;
  onSessionClosed: (
    code: NetworkErrorCode,
    message: string,
  ) => void;
  onAssetsChanged?: (snapshot: AssetNetworkSnapshot) => void;
  onDrawingPreview?: (
    input: Omit<DrawingPreviewEvent, 'campaignId'>
  ) => void;
  onMapPing?: (input: Omit<MapPing, 'campaignId'>) => void;
  onJournalChanged?: (event: Omit<JournalChangedEvent, 'campaignId'>) => void;
  onMeasurementUpdate?: (
    input: Omit<MeasurementEvent, 'campaignId'>
  ) => void;
  onShapePreview?: (
    input: Omit<ShapePreviewEvent, 'campaignId'>
  ) => void;
  onScenePresented?: (scene: SceneRecord | null) => void;
  onScenesChanged?: () => void;
  onTransformCancelled?: (input: Omit<SceneTransformPreviewCancel, 'campaignId'>) => void;
  onTransformPreview?: (input: Omit<SceneTransformPreviewDelta, 'campaignId'>) => void;
  onTransformStarted?: (input: Omit<SceneTransformPreviewStart, 'campaignId'>) => void;
  onStateChanged: (state: ClientConnectionState) => void;
}

export class CampaignClient {
  private active: ClientNetworkSession | null = null;
  private attempt: ClientAttempt | null = null;
  private readonly historyRepository: ConnectionHistoryRepository;
  private readonly onAssetsChanged: NonNullable<
    CampaignClientOptions['onAssetsChanged']
  >;
  private readonly onDrawingPreview: NonNullable<
    CampaignClientOptions['onDrawingPreview']
  >;
  private readonly onChatEvent: NonNullable<
    CampaignClientOptions['onChatEvent']
  >;
  private readonly onMapPing: NonNullable<CampaignClientOptions['onMapPing']>;
  private readonly onJournalChanged: NonNullable<CampaignClientOptions['onJournalChanged']>;
  private readonly onMeasurementUpdate: NonNullable<
    CampaignClientOptions['onMeasurementUpdate']
  >;
  private readonly onScenePresented: NonNullable<
    CampaignClientOptions['onScenePresented']
  >;
  private readonly onScenesChanged: NonNullable<
    CampaignClientOptions['onScenesChanged']
  >;
  private readonly onShapePreview: NonNullable<
    CampaignClientOptions['onShapePreview']
  >;
  private readonly onSessionClosed: CampaignClientOptions['onSessionClosed'];
  private readonly onTransformCancelled: NonNullable<CampaignClientOptions['onTransformCancelled']>;
  private readonly onTransformPreview: NonNullable<CampaignClientOptions['onTransformPreview']>;
  private readonly onTransformStarted: NonNullable<CampaignClientOptions['onTransformStarted']>;
  private readonly onStateChanged: CampaignClientOptions['onStateChanged'];
  private remoteSession: RemotePlaySession | null = null;

  constructor({
    historyRepository,
    onChatEvent = () => undefined,
    onAssetsChanged = () => undefined,
    onDrawingPreview = () => undefined,
    onMapPing = () => undefined,
    onJournalChanged = () => undefined,
    onMeasurementUpdate = () => undefined,
    onScenePresented = () => undefined,
    onScenesChanged = () => undefined,
    onShapePreview = () => undefined,
    onTransformCancelled = () => undefined,
    onTransformPreview = () => undefined,
    onTransformStarted = () => undefined,
    onSessionClosed,
    onStateChanged,
  }: CampaignClientOptions) {
    this.historyRepository = historyRepository;
    this.onChatEvent = onChatEvent;
    this.onAssetsChanged = onAssetsChanged;
    this.onDrawingPreview = onDrawingPreview;
    this.onMapPing = onMapPing;
    this.onJournalChanged = onJournalChanged;
    this.onMeasurementUpdate = onMeasurementUpdate;
    this.onScenePresented = onScenePresented;
    this.onScenesChanged = onScenesChanged;
    this.onShapePreview = onShapePreview;
    this.onTransformCancelled = onTransformCancelled;
    this.onTransformPreview = onTransformPreview;
    this.onTransformStarted = onTransformStarted;
    this.onSessionClosed = onSessionClosed;
    this.onStateChanged = onStateChanged;
  }

  async connect(input: ConnectInput): Promise<NetworkResult<ConnectStep>> {
    await this.disconnect();
    this.onStateChanged('connecting');

    try {
      const socket = await this.connectTls(input.host, input.port);
      const channel = new TcpClientChannel(socket);
      const helloEnvelope = await channel.waitFor(['server.hello'], 10_000);
      const hello = parsePayload('server.hello', helloEnvelope.payload);

      if (hello.protocolVersion !== NETWORK_PROTOCOL_VERSION) {
        channel.close();
        return failure(
          'protocol_mismatch',
          'The campaign uses an incompatible protocol version.',
        );
      }
      if (
        input.expectedCampaignId &&
        input.expectedCampaignId !== hello.campaignId
      ) {
        channel.close();
        return failure(
          'connection_failed',
          'The saved endpoint now serves a different campaign.',
        );
      }
      const system = parseCampaignSystemState(hello.system);
      if (!system) {
        channel.close();
        return failure(
          'unsupported_system',
          'This build does not support the campaign game system.',
        );
      }

      const peer = socket.getPeerCertificate(true);
      if (!peer.raw) {
        channel.close();
        return failure(
          'connection_failed',
          'The campaign did not provide a certificate.',
        );
      }
      const fingerprint = new X509Certificate(peer.raw).fingerprint256;
      const history = await this.historyRepository.find(hello.campaignId);
      const attempt: ClientAttempt = {
        campaignId: hello.campaignId,
        campaignName: hello.campaignName,
        channel,
        fingerprint,
        history,
        host: input.host.trim(),
        id: crypto.randomUUID(),
        pendingTrust: history?.certificateFingerprint !== fingerprint,
        port: input.port,
        system,
      };
      this.attempt = attempt;

      if (attempt.pendingTrust) {
        this.onStateChanged('trust_required');
        return {
          ok: true,
          value: {
            state: 'trust_required',
            challenge: {
              attemptId: attempt.id,
              campaignId: attempt.campaignId,
              campaignName: attempt.campaignName,
              kind: history ? 'changed' : 'first_use',
              newFingerprint: fingerprint,
              oldFingerprint: history?.certificateFingerprint ?? null,
              system: attempt.system,
            },
          },
        };
      }

      const challenge = await this.continueAfterTrust(attempt);
      return {
        ok: true,
        value: { state: 'authentication_required', challenge },
      };
    } catch (error) {
      await this.disconnect();
      if (error instanceof ProtocolVersionMismatchError) {
        return failure(
          'protocol_mismatch',
          'The campaign uses an incompatible protocol version.',
        );
      }
      return failure(
        'connection_failed',
        'The campaign server could not be reached.',
      );
    }
  }

  async acceptTrust(
    attemptId: string,
  ): Promise<NetworkResult<AuthenticationChallenge>> {
    const attempt = this.attempt;
    if (!attempt || attempt.id !== attemptId) {
      return failure('invalid_input', 'Connection attempt is no longer active.');
    }

    try {
      const challenge = await this.continueAfterTrust(attempt);
      return { ok: true, value: challenge };
    } catch {
      await this.disconnect();
      return failure(
        'connection_failed',
        'The campaign closed the connection.',
      );
    }
  }

  async authenticate(input: {
    attemptId: string;
    password?: string;
    useSavedPassword: boolean;
    userId: string;
  }): Promise<NetworkResult<RemotePlaySession>> {
    const attempt = this.attempt;
    if (!attempt || attempt.id !== input.attemptId) {
      return failure('invalid_input', 'Connection attempt is no longer active.');
    }
    this.onStateChanged('authenticating');
    let udpStarted = false;

    let password = input.password;
    if (input.useSavedPassword) {
      try {
        password =
          (await this.historyRepository.getPassword(
            attempt.campaignId,
            input.userId,
          )) ?? undefined;
      } catch {
        return failure(
          'storage_error',
          'The saved password could not be decrypted.',
        );
      }
    }
    if (!password) {
      return failure('invalid_input', 'Password must not be empty.');
    }

    try {
      attempt.channel.send('client.authenticate', {
        password,
        userId: input.userId,
      });
      const response = await attempt.channel.waitFor([
        'server.auth_error',
        'server.udp_credentials',
      ]);
      if (response.type === 'server.auth_error') {
        const error = parsePayload('server.auth_error', response.payload);
        this.onStateChanged('authenticating');
        return failure(error.code, error.message);
      }

      const serializedCredentials = parsePayload(
        'server.udp_credentials',
        response.payload,
      );
      const credentials = deserializeUdpCredentials(serializedCredentials);
      udpStarted = true;
      this.onStateChanged('associating_udp');
      const udp = await associateUdp(
        attempt.channel.socket,
        attempt.port,
        credentials,
      );
      const readyEnvelope = await attempt.channel.waitFor(
        ['server.ready'],
        UDP_ASSOCIATION_TIMEOUT_MS,
      );
      const ready = parsePayload('server.ready', readyEnvelope.payload);
      const readySystem = parseCampaignSystemState(ready.system);
      if (!readySystem || !isDeepStrictEqual(readySystem, attempt.system)) {
        await this.disconnect();
        return failure(
          'unsupported_system',
          'The campaign game system changed during authentication.',
        );
      }
      const session: RemotePlaySession = {
        campaignId: ready.campaignId,
        campaignName: ready.campaignName,
        host: attempt.host,
        port: attempt.port,
        role: 'player',
        source: 'remote',
        system: readySystem,
        userId: ready.userId,
        username: ready.username,
      };
      const active = new ClientNetworkSession({
        campaignId: ready.campaignId,
        channel: attempt.channel,
        onAssetsChanged: this.onAssetsChanged,
        onChatEvent: this.onChatEvent,
        onDrawingPreview: this.onDrawingPreview,
        onMapPing: this.onMapPing,
        onJournalChanged: this.onJournalChanged,
        onMeasurementUpdate: this.onMeasurementUpdate,
        onScenePresented: this.onScenePresented,
        onScenesChanged: this.onScenesChanged,
        onShapePreview: this.onShapePreview,
        onTransformCancelled: this.onTransformCancelled,
        onTransformPreview: this.onTransformPreview,
        onTransformStarted: this.onTransformStarted,
        onClosed: (code, message) => {
          if (this.active === active) {
            this.active = null;
            this.remoteSession = null;
            this.onStateChanged('idle');
            this.onSessionClosed(code, message);
          }
        },
        onStateChanged: this.onStateChanged,
        port: attempt.port,
        udp,
        updateRate: ready.updateRate,
      });
      this.active = active;
      this.remoteSession = session;
      this.attempt = null;
      active.start();
      this.onStateChanged('online');

      const historyResult =
        await this.historyRepository.commitSuccessfulConnection({
          campaignId: attempt.campaignId,
          campaignName: attempt.campaignName,
          certificateFingerprint: attempt.fingerprint,
          host: attempt.host,
          password,
          port: attempt.port,
          userId: ready.userId,
          username: ready.username,
        });
      if (!historyResult.ok) {
        if (this.active === active) {
          this.active = null;
        }
        active.close();
        this.onStateChanged('idle');
        return failure(
          historyResult.error.code,
          historyResult.error.message,
        );
      }
      if (active.isClosed) {
        return failure(
          'transport_lost',
          'The connection to the campaign was lost.',
        );
      }
      return { ok: true, value: session };
    } catch {
      await this.disconnect();
      return failure(
        udpStarted ? 'udp_failed' : 'connection_failed',
        udpStarted
          ? 'The encrypted UDP session could not be established.'
          : 'The campaign closed the TCP connection.',
      );
    }
  }

  async cancel(attemptId?: string): Promise<void> {
    if (attemptId && this.attempt?.id !== attemptId) {
      return;
    }
    await this.disconnect();
  }

  async disconnect(): Promise<void> {
    this.attempt?.channel.close();
    this.attempt = null;
    this.active?.close();
    this.active = null;
    this.remoteSession = null;
    this.onStateChanged('idle');
  }

  getSession(): RemotePlaySession | null {
    return this.remoteSession;
  }

  async getChatBootstrap(): Promise<ChatResult<ChatBootstrap>> {
    const active = this.active;
    if (!active || active.isClosed) {
      return chatFailure(
        'unavailable',
        'The campaign connection is not active.',
      );
    }
    try {
      const envelope = await active.request(
        'client.chat_bootstrap',
        {},
        ['server.chat_bootstrap', 'server.chat_error'],
      );
      if (envelope.type === 'server.chat_error') {
        return {
          error: parsePayload('server.chat_error', envelope.payload),
          ok: false,
        };
      }
      return {
        ok: true,
        value: parsePayload(
          'server.chat_bootstrap',
          envelope.payload,
        ),
      };
    } catch {
      return chatFailure(
        'unavailable',
        'Campaign chat could not be loaded.',
      );
    }
  }

  async getChatHistory(
    input: Omit<ChatHistoryInput, 'campaignId'>,
  ): Promise<ChatResult<ChatHistoryPage>> {
    const active = this.active;
    if (!active || active.isClosed) {
      return chatFailure(
        'unavailable',
        'The campaign connection is not active.',
      );
    }
    try {
      const envelope = await active.request(
        'client.chat_history',
        input,
        ['server.chat_history', 'server.chat_error'],
      );
      if (envelope.type === 'server.chat_error') {
        return {
          error: parsePayload('server.chat_error', envelope.payload),
          ok: false,
        };
      }
      return {
        ok: true,
        value: parsePayload('server.chat_history', envelope.payload),
      };
    } catch {
      return chatFailure(
        'unavailable',
        'Campaign chat history could not be loaded.',
      );
    }
  }

  async sendChatMessage(
    input: Omit<SendChatMessageInput, 'campaignId'>,
  ): Promise<ChatResult<ChatMessage>> {
    const active = this.active;
    if (!active || active.isClosed) {
      return chatFailure(
        'unavailable',
        'The campaign connection is not active.',
      );
    }
    try {
      const envelope = await active.request(
        'client.chat_send',
        input,
        ['server.chat_send_result', 'server.chat_error'],
        CHAT_SEND_TIMEOUT_MS,
      );
      if (envelope.type === 'server.chat_error') {
        return {
          error: parsePayload('server.chat_error', envelope.payload),
          ok: false,
        };
      }
      return {
        ok: true,
        value: parsePayload(
          'server.chat_send_result',
          envelope.payload,
        ),
      };
    } catch {
      return chatFailure(
        'timeout',
        'The host did not acknowledge this message.',
      );
    }
  }

  async sendChatRoll(
    input: Omit<SendChatRollInput, 'campaignId'>,
  ): Promise<ChatResult<ChatMessage>> {
    const active = this.active;
    if (!active || active.isClosed) {
      return chatFailure('unavailable', 'The campaign connection is not active.');
    }
    try {
      const envelope = await active.request(
        'client.chat_roll',
        input,
        ['server.chat_roll_result', 'server.chat_error'],
        CHAT_ROLL_SEND_TIMEOUT_MS,
      );
      if (envelope.type === 'server.chat_error') {
        return {
          error: parsePayload('server.chat_error', envelope.payload),
          ok: false,
        };
      }
      return {
        ok: true,
        value: parsePayload('server.chat_roll_result', envelope.payload),
      };
    } catch {
      return chatFailure('timeout', 'The host did not acknowledge this roll.');
    }
  }

  async getAssetManifest(): Promise<AssetResult<AssetNetworkSnapshot>> {
    const active = this.active;
    if (!active || active.isClosed) {
      return this.assetFailure('sync_error', 'The campaign connection is not active.');
    }
    try {
      const envelope = await active.request(
        'client.asset_manifest',
        {},
        ['server.asset_manifest', 'server.asset_error'],
      );
      if (envelope.type === 'server.asset_error') {
        return { ok: false, error: parsePayload('server.asset_error', envelope.payload) };
      }
      return {
        ok: true,
        value: parsePayload('server.asset_manifest', envelope.payload),
      };
    } catch {
      return this.assetFailure('sync_error', 'The campaign asset manifest could not be downloaded.');
    }
  }

  async getAssetChunk(
    asset: AssetRecord,
    index: number,
  ): Promise<AssetResult<{ data: Buffer; hash: string; index: number }>> {
    const active = this.active;
    if (!active || active.isClosed) {
      return this.assetFailure('sync_error', 'The campaign connection is not active.', asset.id);
    }
    try {
      const envelope = await active.request(
        'client.asset_chunk_request',
        { assetId: asset.id, index },
        ['server.asset_chunk', 'server.asset_error'],
      );
      if (envelope.type === 'server.asset_error') {
        return { ok: false, error: parsePayload('server.asset_error', envelope.payload) };
      }
      const chunk = parsePayload('server.asset_chunk', envelope.payload);
      return {
        ok: true,
        value: {
          data: Buffer.from(chunk.data, 'base64'),
          hash: chunk.hash,
          index: chunk.index,
        },
      };
    } catch {
      return this.assetFailure('sync_error', `${asset.displayName} could not be downloaded.`, asset.id);
    }
  }

  async renameAsset(input: {
    assetId: string;
    displayName: string;
    expectedRevision: number;
  }): Promise<AssetResult<AssetRecord>> {
    const response = await this.assetMutation('client.asset_rename', {
      assetId: input.assetId,
      displayName: input.displayName,
      expectedRevision: input.expectedRevision,
    });
    if (!response.ok) {
      return response;
    }
    return response.value.asset
      ? { ok: true, value: response.value.asset }
      : this.assetFailure('sync_error', 'The host did not return the renamed asset.', input.assetId);
  }

  /*
   * Resolves to the new manifest revision rather than a record: reordering
   * changes no asset, so the host has nothing per-asset to echo back. The
   * caller refreshes from the manifest broadcast that follows.
   */
  async reorderAssets(input: {
    kind: AssetKind;
    orderedAssetIds: string[];
  }): Promise<AssetResult<number>> {
    const response = await this.assetMutation('client.asset_reorder', {
      kind: input.kind,
      orderedAssetIds: input.orderedAssetIds,
    });
    return response.ok
      ? { ok: true, value: response.value.revision }
      : response;
  }

  async trashAsset(input: {
    assetId: string;
    expectedRevision: number;
  }): Promise<AssetResult<null>> {
    const response = await this.assetMutation('client.asset_delete', {
      assetId: input.assetId,
      expectedRevision: input.expectedRevision,
    });
    return response.ok ? { ok: true, value: null } : response;
  }

  async uploadAssets(
    sourcePaths: string[],
    onProgress: (event: AssetProgressEvent) => void,
  ): Promise<AssetResult<AssetRecord[]>> {
    const active = this.active;
    if (!active || active.isClosed) {
      return this.assetFailure('sync_error', 'The campaign connection is not active.');
    }
    const imported: AssetRecord[] = [];
    let totalBytes = 0;
    const files: Array<{ filePath: string; sizeBytes: number }> = [];
    try {
      for (const filePath of sourcePaths) {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) {
          continue;
        }
        totalBytes += fileStat.size;
        files.push({ filePath, sizeBytes: fileStat.size });
      }
      let completedBytes = 0;
      for (const file of files) {
        const originalFilename = path.basename(file.filePath);
        onProgress({
          completedBytes,
          currentName: originalFilename,
          phase: 'importing',
          scope: 'import',
          totalBytes,
        });
        const start = await active.request(
          'client.asset_import_start',
          {
            displayName: originalFilename,
            originalFilename,
            sizeBytes: file.sizeBytes,
          },
          ['server.asset_import_ready', 'server.asset_error'],
        );
        if (start.type === 'server.asset_error') {
          return { ok: false, error: parsePayload('server.asset_error', start.payload) };
        }
        const { uploadId } = parsePayload('server.asset_import_ready', start.payload);
        const handle = await open(file.filePath, 'r');
        try {
          const buffer = Buffer.allocUnsafe(ASSET_CHUNK_BYTES);
          let position = 0;
          let chunkIndex = 0;
          while (position < file.sizeBytes) {
            const read = await handle.read(
              buffer,
              0,
              Math.min(buffer.length, file.sizeBytes - position),
              position,
            );
            if (read.bytesRead === 0) {
              break;
            }
            const data = Buffer.from(buffer.subarray(0, read.bytesRead));
            const hash = createHash('sha256').update(data).digest('hex');
            const response = await active.request(
              'client.asset_import_chunk',
              {
                data: data.toString('base64'),
                hash,
                index: chunkIndex,
                uploadId,
              },
              ['server.asset_import_ready', 'server.asset_error'],
            );
            if (response.type === 'server.asset_error') {
              return {
                ok: false,
                error: parsePayload('server.asset_error', response.payload),
              };
            }
            position += read.bytesRead;
            completedBytes += read.bytesRead;
            chunkIndex += 1;
            onProgress({
              completedBytes,
              currentName: originalFilename,
              phase: 'importing',
              scope: 'import',
              totalBytes,
            });
          }
        } finally {
          await handle.close();
        }
        const commit = await active.request(
          'client.asset_import_commit',
          { uploadId },
          ['server.asset_mutation', 'server.asset_error'],
        );
        if (commit.type === 'server.asset_error') {
          return { ok: false, error: parsePayload('server.asset_error', commit.payload) };
        }
        imported.push(
          ...(parsePayload('server.asset_mutation', commit.payload).imported ?? []),
        );
      }
      return { ok: true, value: imported };
    } catch {
      return this.assetFailure('sync_error', 'The selected assets could not be uploaded.');
    }
  }

  reportAssetSyncError(
    assetName: string,
    reason: string,
    assetId?: string,
  ): void {
    const active = this.active;
    if (!active || active.isClosed) {
      return;
    }
    active.send('client.asset_sync_error', {
      assetId,
      assetName,
      reason,
    });
  }

  sendMapPing(input: Omit<MapPing, 'campaignId'>): void {
    const active = this.active;
    if (!active || active.isClosed) {
      return;
    }
    active.send('client.map_ping', input);
  }

  sendMeasurementUpdate(
    input: Omit<MeasurementUpdate, 'campaignId'>,
  ): void {
    const active = this.active;
    if (!active || active.isClosed) {
      return;
    }
    active.sendMeasurementUpdate(input);
  }

  sendDrawingPreview(
    input: Omit<DrawingPreviewUpdate, 'campaignId'>,
  ): void {
    const active = this.active;
    if (!active || active.isClosed) {
      return;
    }
    if (input.reliable) {
      active.send('client.scene_drawing_preview', input);
    } else {
      active.sendDrawingPreview(input);
    }
  }

  sendShapePreview(
    input: Omit<ShapePreviewUpdate, 'campaignId'>,
  ): void {
    const active = this.active;
    if (!active || active.isClosed) {
      return;
    }
    if (input.reliable) {
      active.dropPendingShapePreview(input.operationId);
      active.send('client.scene_shape_preview', input);
    } else {
      active.sendShapePreview(input);
    }
  }

  async setSceneObjects(input: {
    arrangement?: SetSceneObjectsInput['arrangement'];
    expectedRevision: number;
    operationId: string;
    sceneId: string;
    state: SceneObjectState;
  }): Promise<SceneResult<SceneRecord>> {
    return this.sceneMutation('client.scene_objects_set', input);
  }

  async undoSceneEdit(
    input: Omit<SceneHistoryInput, 'campaignId'>,
  ): Promise<SceneResult<SceneRecord>> {
    return this.sceneMutation('client.scene_undo', input);
  }

  async redoSceneEdit(
    input: Omit<SceneHistoryInput, 'campaignId'>,
  ): Promise<SceneResult<SceneRecord>> {
    return this.sceneMutation('client.scene_redo', input);
  }

  async startSceneTransform(
    input: Omit<SceneTransformPreviewStart, 'campaignId' | 'startingTransforms'>,
  ): Promise<boolean> {
    const active = this.active;
    if (!active || active.isClosed) {
      return false;
    }
    try {
      const envelope = await active.request(
        'client.scene_transform_start',
        input,
        ['server.scene_transform_granted', 'server.scene_error'],
      );
      return envelope.type === 'server.scene_transform_granted';
    } catch {
      return false;
    }
  }

  cancelSceneTransform(
    input: Omit<SceneTransformPreviewCancel, 'campaignId'>,
  ): void {
    const active = this.active;
    if (!active || active.isClosed) {
      return;
    }
    active.send('client.scene_transform_cancel', input);
  }

  sendSceneTransformPreview(
    input: Omit<SceneTransformPreviewDelta, 'campaignId'>,
  ): void {
    const active = this.active;
    if (!active || active.isClosed) {
      return;
    }
    active.sendTransformPreview(input);
  }

  listJournal(): Promise<JournalResult<JournalManifest>> {
    return this.journalRequest('client.journal_list', {}, 'server.journal_manifest',
      (payload) => parsePayload('server.journal_manifest', payload));
  }

  listJournalUsers(): Promise<JournalResult<PermissionSubject[]>> {
    return this.journalRequest('client.journal_list_users', {}, 'server.journal_users',
      (payload) => parsePayload('server.journal_users', payload).users);
  }

  getJournalNote(entryId: string): Promise<JournalResult<NoteEntry>> {
    return this.journalRequest('client.journal_get_note', { entryId }, 'server.journal_note',
      (payload) => parsePayload('server.journal_note', payload));
  }

  getJournalEntry(entryId: string): Promise<JournalResult<JournalEntry>> {
    return this.journalRequest('client.journal_get_entry', { entryId }, 'server.journal_entry',
      (payload) => parsePayload('server.journal_entry', payload));
  }

  getJournalPage(entryId: string, pageId: string): Promise<JournalResult<JournalPage>> {
    return this.journalRequest('client.journal_get_page', { entryId, pageId }, 'server.journal_page',
      (payload) => parsePayload('server.journal_page', payload));
  }

  findJournalAssetDependents(assetId: string): Promise<JournalResult<JournalAssetDependent[]>> {
    return this.journalRequest('client.journal_find_asset_dependents', { assetId }, 'server.journal_asset_dependents',
      (payload) => parsePayload('server.journal_asset_dependents', payload).dependents);
  }

  detachJournalAsset(assetId: string): Promise<JournalResult<null>> {
    return this.journalRequest('client.journal_detach_asset', { assetId }, 'server.journal_release_result', () => null);
  }

  createJournalNote(): Promise<JournalResult<NoteEntry>> {
    return this.journalRequest('client.journal_create_note', {}, 'server.journal_note',
      (payload) => parsePayload('server.journal_note', payload));
  }

  createJournalEntry(typeId: string): Promise<JournalResult<JournalEntry>> {
    return this.journalRequest('client.journal_create_entry', { typeId }, 'server.journal_entry',
      (payload) => parsePayload('server.journal_entry', payload));
  }

  renameJournalEntry(entryId: string, name: string, expectedRevision: number): Promise<JournalResult<JournalEntry>> {
    return this.journalRequest('client.journal_rename_entry', { entryId, expectedRevision, name }, 'server.journal_entry',
      (payload) => parsePayload('server.journal_entry', payload));
  }

  updateJournalEntryData(input: Omit<UpdateJournalEntryDataInput, 'campaignId'>): Promise<JournalResult<JournalEntry>> {
    return this.journalRequest('client.journal_update_entry_data', input, 'server.journal_entry',
      (payload) => parsePayload('server.journal_entry', payload));
  }

  updateJournalEntryPermissions(input: Omit<UpdateJournalEntryPermissionsInput, 'campaignId'>): Promise<JournalResult<JournalEntry>> {
    return this.journalRequest('client.journal_update_entry_permissions', input, 'server.journal_entry',
      (payload) => parsePayload('server.journal_entry', payload));
  }

  updateJournalNote(entryId: string, name: string, nameStyle: NoteEntry['nameStyle'], expectedRevision: number): Promise<JournalResult<NoteEntry>> {
    return this.journalRequest('client.journal_update_note', { entryId, expectedRevision, name, nameStyle }, 'server.journal_note',
      (payload) => parsePayload('server.journal_note', payload));
  }

  updateJournalNotePermissions(input: Omit<UpdateJournalNotePermissionsInput, 'campaignId'>): Promise<JournalResult<NoteEntry>> {
    return this.journalRequest('client.journal_update_note_permissions', input, 'server.journal_note',
      (payload) => parsePayload('server.journal_note', payload));
  }

  createJournalPage(entryId: string, expectedEntryRevision: number): Promise<JournalResult<JournalPage>> {
    return this.journalRequest('client.journal_create_page', { entryId, expectedEntryRevision }, 'server.journal_page',
      (payload) => parsePayload('server.journal_page', payload));
  }

  updateJournalPage(
    entryId: string,
    pageId: string,
    leaseId: string,
    title: string,
    titleStyle: JournalPage['titleStyle'],
    content: JournalPage['content'],
    expectedRevision: number,
  ): Promise<JournalResult<JournalPage>> {
    return this.journalRequest(
      'client.journal_update_page',
      { content, entryId, expectedRevision, leaseId, pageId, title, titleStyle },
      'server.journal_page',
      (payload) => parsePayload('server.journal_page', payload),
    );
  }

  updateJournalPagePermissions(input: Omit<UpdateJournalPagePermissionsInput, 'campaignId'>): Promise<JournalResult<JournalPage>> {
    return this.journalRequest('client.journal_update_page_permissions', input, 'server.journal_page',
      (payload) => parsePayload('server.journal_page', payload));
  }

  acquireJournalLease(entryId: string, pageId: string): Promise<JournalResult<PageEditLease>> {
    return this.journalRequest('client.journal_acquire_lease', { entryId, pageId }, 'server.journal_lease',
      (payload) => parsePayload('server.journal_lease', payload));
  }

  renewJournalLease(entryId: string, pageId: string, leaseId: string): Promise<JournalResult<PageEditLease>> {
    return this.journalRequest('client.journal_renew_lease', { entryId, leaseId, pageId }, 'server.journal_lease',
      (payload) => parsePayload('server.journal_lease', payload));
  }

  releaseJournalLease(entryId: string, pageId: string, leaseId: string): Promise<JournalResult<null>> {
    return this.journalRequest('client.journal_release_lease', { entryId, leaseId, pageId }, 'server.journal_release_result',
      () => null);
  }

  moveJournalNote(input: Omit<MoveJournalEntryInput, 'campaignId'>): Promise<JournalResult<JournalManifest>> {
    return this.journalRequest('client.journal_move_note', input, 'server.journal_manifest',
      (payload) => parsePayload('server.journal_manifest', payload));
  }

  moveJournalEntry(input: Omit<MoveJournalEntryInput, 'campaignId'>): Promise<JournalResult<JournalManifest>> {
    return this.journalRequest('client.journal_move_entry', input, 'server.journal_manifest',
      (payload) => parsePayload('server.journal_manifest', payload));
  }

  reorderJournalNotes(input: Omit<ReorderJournalEntriesInput, 'campaignId'>): Promise<JournalResult<JournalManifest>> {
    return this.journalRequest('client.journal_reorder_notes', input, 'server.journal_manifest',
      (payload) => parsePayload('server.journal_manifest', payload));
  }

  reorderJournalEntries(input: Omit<ReorderJournalGroupInput, 'campaignId'>): Promise<JournalResult<JournalManifest>> {
    return this.journalRequest('client.journal_reorder_entries', input, 'server.journal_manifest',
      (payload) => parsePayload('server.journal_manifest', payload));
  }

  moveJournalPage(input: Omit<MoveJournalPageInput, 'campaignId'>): Promise<JournalResult<NoteEntry>> {
    return this.journalRequest('client.journal_move_page', input, 'server.journal_note',
      (payload) => parsePayload('server.journal_note', payload));
  }

  reorderJournalPages(input: Omit<ReorderJournalPagesInput, 'campaignId'>): Promise<JournalResult<NoteEntry>> {
    return this.journalRequest('client.journal_reorder_pages', input, 'server.journal_note',
      (payload) => parsePayload('server.journal_note', payload));
  }

  prepareJournalDelete(target: DeleteJournalTargetInput['target']): Promise<JournalResult<JournalDeletePreview>> {
    return this.journalRequest('client.journal_prepare_delete', { target }, 'server.journal_delete_preview',
      (payload) => parsePayload('server.journal_delete_preview', payload));
  }

  deleteJournalTarget(input: Omit<DeleteJournalTargetInput, 'campaignId'>): Promise<JournalResult<JournalDeleteResult>> {
    const type = input.target.kind === 'entry'
      ? 'client.journal_delete_entry' as const
      : input.target.kind === 'note'
        ? 'client.journal_delete_note' as const
        : 'client.journal_delete_page' as const;
    return this.journalRequest(type, input, 'server.journal_delete_result',
      (payload) => parsePayload('server.journal_delete_result', payload));
  }

  private async journalRequest<T>(
    type: ProtocolMessageType,
    payload: unknown,
    successType: ProtocolMessageType,
    parseSuccess: (payload: unknown) => T,
  ): Promise<JournalResult<T>> {
    const active = this.active;
    if (!active || active.isClosed) {
      return { error: { code: 'unavailable', message: 'The campaign connection is not active.' }, ok: false };
    }
    try {
      const envelope = await active.request(type, payload, [successType, 'server.journal_error']);
      if (envelope.type === 'server.journal_error') {
        return { error: parsePayload('server.journal_error', envelope.payload), ok: false };
      }
      return { ok: true, value: parseSuccess(envelope.payload) };
    } catch {
      return { error: { code: 'unavailable', message: 'The Journal request could not be completed.' }, ok: false };
    }
  }

  private async assetMutation(
    type: 'client.asset_delete' | 'client.asset_rename' | 'client.asset_reorder',
    payload: unknown,
  ): Promise<
    AssetResult<{ asset?: AssetRecord; imported?: AssetRecord[]; revision: number }>
  > {
    const active = this.active;
    if (!active || active.isClosed) {
      return this.assetFailure('sync_error', 'The campaign connection is not active.');
    }
    try {
      const envelope = await active.request(
        type,
        payload,
        ['server.asset_mutation', 'server.asset_error'],
      );
      if (envelope.type === 'server.asset_error') {
        return { ok: false, error: parsePayload('server.asset_error', envelope.payload) };
      }
      return {
        ok: true,
        value: parsePayload('server.asset_mutation', envelope.payload),
      };
    } catch {
      return this.assetFailure('sync_error', 'The campaign asset could not be changed.');
    }
  }

  /** The caller's own scene library, as the host projects it for them. */
  async listScenes(): Promise<SceneResult<SceneManifest>> {
    const active = this.active;
    if (!active || active.isClosed) {
      return this.sceneFailure(
        'unavailable',
        'The campaign connection is not active.',
      );
    }
    try {
      const envelope = await active.request(
        'client.scene_list',
        {},
        ['server.scene_manifest', 'server.scene_error'],
      );
      if (envelope.type === 'server.scene_error') {
        return {
          error: parsePayload('server.scene_error', envelope.payload),
          ok: false,
        };
      }
      return {
        ok: true,
        value: parsePayload('server.scene_manifest', envelope.payload),
      };
    } catch {
      return this.sceneFailure(
        'unavailable',
        'The scene library could not be read.',
      );
    }
  }

  updateScene(input: {
    expectedRevision: number;
    patch: ScenePatch;
    sceneId: string;
  }): Promise<SceneResult<SceneRecord>> {
    return this.sceneMutation('client.scene_update', input);
  }

  async trashScene(input: {
    expectedRevision: number;
    sceneId: string;
  }): Promise<SceneResult<null>> {
    const active = this.active;
    if (!active || active.isClosed) {
      return this.sceneFailure(
        'unavailable',
        'The campaign connection is not active.',
      );
    }
    try {
      const envelope = await active.request(
        'client.scene_trash',
        input,
        ['server.scene_manifest', 'server.scene_error'],
      );
      if (envelope.type === 'server.scene_error') {
        return {
          error: parsePayload('server.scene_error', envelope.payload),
          ok: false,
        };
      }
      return { ok: true, value: null };
    } catch {
      return this.sceneFailure(
        'unavailable',
        'The scene could not be deleted.',
      );
    }
  }

  private async sceneMutation(
    type:
      | 'client.scene_objects_set'
      | 'client.scene_redo'
      | 'client.scene_undo'
      | 'client.scene_update',
    payload: unknown,
  ): Promise<SceneResult<SceneRecord>> {
    const active = this.active;
    if (!active || active.isClosed) {
      return this.sceneFailure(
        'unavailable',
        'The campaign connection is not active.',
      );
    }
    try {
      const envelope = await active.request(
        type,
        payload,
        ['server.scene_mutation', 'server.scene_error'],
      );
      if (envelope.type === 'server.scene_error') {
        return {
          error: parsePayload('server.scene_error', envelope.payload),
          ok: false,
        };
      }
      return {
        ok: true,
        value: parsePayload('server.scene_mutation', envelope.payload).scene,
      };
    } catch {
      return this.sceneFailure(
        'unavailable',
        'The scene could not be changed.',
      );
    }
  }

  private sceneFailure<T>(
    code: SceneError['code'],
    message: string,
  ): SceneResult<T> {
    return { error: { code, message }, ok: false };
  }

  private assetFailure<T>(
    code: AssetError['code'],
    message: string,
    assetId?: string,
  ): AssetResult<T> {
    return { error: { assetId, code, message }, ok: false };
  }

  private async continueAfterTrust(
    attempt: ClientAttempt,
  ): Promise<AuthenticationChallenge> {
    attempt.channel.send('client.trust_accepted', {});
    const usersEnvelope = await attempt.channel.waitFor(['server.users']);
    const users = parsePayload('server.users', usersEnvelope.payload).users;
    this.onStateChanged('authenticating');
    return {
      attemptId: attempt.id,
      campaignId: attempt.campaignId,
      campaignName: attempt.campaignName,
      system: attempt.system,
      users: users.map((user) => ({
        ...user,
        hasSavedPassword:
          attempt.history?.profiles.some(
            (profile) => profile.userId === user.id,
          ) ?? false,
      })),
    };
  }

  private connectTls(host: string, port: number): Promise<TLSSocket> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({
        host: host.trim(),
        maxVersion: 'TLSv1.3',
        minVersion: 'TLSv1.3',
        port,
        // Campaign hosts use local self-signed identities, so public-CA
        // validation cannot authenticate them. The client performs durable
        // trust-on-first-use fingerprint validation before
        // continueAfterTrust sends any client data or requests account data.
        rejectUnauthorized: false,
      });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('TCP connection timed out.'));
      }, TCP_CONNECT_TIMEOUT_MS);
      socket.once('secureConnect', () => {
        clearTimeout(timer);
        socket.setKeepAlive(true, 10_000);
        socket.setNoDelay(true);
        resolve(socket);
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }
}

