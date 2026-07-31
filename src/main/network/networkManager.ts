import { EventEmitter } from 'node:events';
import { rm } from 'node:fs/promises';
import { isIP } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import {
  type ChatBootstrap,
  type ChatEvent,
  type ChatHistoryInput,
  type ChatHistoryPage,
  type ChatIdentity,
  type ChatMessage,
  type ChatParticipantEvent,
  type ChatPrincipal,
  type ChatResult,
  type ClearChatHistoryResult,
  type SendChatMessageInput,
  type SetMaxChatMessageCharactersInput,
} from '../../shared/chat';
import {
  type AssetActor,
  type AssetChangedEvent,
  type AssetCapability,
  type AssetErrorEvent,
  type AssetManifest,
  type AssetNetworkSnapshot,
  type AssetProgressEvent,
  type AssetResult,
  type AssetView,
  type RenameAssetInput,
  type TrashAssetInput,
} from '../../shared/assets';
import type { CampaignRepository } from '../campaignRepository';
import { authenticatedAssetPolicy, getAssetCapabilities } from '../assetPolicy';
import { AssetRepository } from '../assetRepository';
import { SceneRepository } from '../sceneRepository';
import { ChatRepository } from '../chatRepository';
import type {
  SceneDrawing,
  SceneHistoryInput,
  SceneImage,
  SceneRecord,
  SceneResult,
  SetSceneObjectsInput,
  SceneTransformPreviewCancel,
  SceneTransformPreviewDelta,
  SceneTransformPreviewStart,
} from '../../shared/scenes';
import { fail } from '../../shared/result';
import {
  DEFAULT_SERVER_PORT,
  type AcceptTrustInput,
  type AuthenticateInput,
  type AuthenticationChallenge,
  type ClientStateEvent,
  type ConnectInput,
  type ConnectStep,
  type CreateManagedUserInput,
  type DeleteHistoryInput,
  type DeleteManagedUserInput,
  type DrawingPreviewEvent,
  type DrawingPreviewUpdate,
  type HostStatus,
  type ManagedUserView,
  type MapPing,
  type MeasurementEvent,
  type MeasurementUpdate,
  type NetworkResult,
  type RemotePlaySession,
  type ResetManagedPasswordInput,
  type SavedConnection,
  type ServerSettingsView,
  type SetServerPortInput,
  type SetTransformPreviewRateInput,
  type SessionClosedEvent,
  type UpdateManagedUsernameInput,
} from '../../shared/network';
import { CampaignIdentityRepository } from './campaignIdentity';
import { CampaignHostServer } from './campaignHostServer';
import { CampaignClient } from './campaignClient';
import { AssetCacheSyncError, RemoteAssetCache } from './assetCache';
import type { ConnectionHistoryRepository } from './connectionHistoryRepository';
import {
  ServerConfigRepository,
  type StoredManagedUser,
} from './serverConfigRepository';
import { ServerUserAdministration } from './serverUserAdministration';

const PUBLIC_ADDRESS_REFRESH_MS = 15 * 60_000;
const HOST_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000] as const;

function failure<T>(
  code: 'campaign_not_found' | 'storage_error',
  message: string,
): NetworkResult<T> {
  return fail({ code, message });
}

function getLocalAddresses(): string[] {
  const addresses = new Set<string>();
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const address of interfaces ?? []) {
      if (
        !address.internal &&
        (address.family === 'IPv4' || address.family === 'IPv6')
      ) {
        addresses.add(address.address);
      }
    }
  }
  return [...addresses].sort((left, right) =>
    left.localeCompare(right),
  );
}

async function lookupPublicAddress(
  url: string,
  fetcher: typeof fetch,
): Promise<string | null> {
  try {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return null;
    }
    const value: unknown = await response.json();
    const address =
      value && typeof value === 'object' && 'ip' in value
        ? (value as { ip?: unknown }).ip
        : null;
    return typeof address === 'string' && isIP(address) ? address : null;
  } catch {
    return null;
  }
}

interface NetworkManagerOptions {
  assetCacheRoot?: string;
  campaignRepository: CampaignRepository;
  fetcher?: typeof fetch;
  historyRepository: ConnectionHistoryRepository;
  getAssetRepository?: (
    campaignId: string,
  ) => Promise<AssetRepository | null>;
  getSceneRepository?: (
    campaignId: string,
  ) => Promise<SceneRepository | null>;
  warn?: (message: string, error?: unknown) => void;
}

export class NetworkManager extends EventEmitter {
  private readonly campaignRepository: CampaignRepository;
  private readonly chatRepositories = new Map<string, ChatRepository>();
  private chatSystemEvents: ChatParticipantEvent[] = [];
  private readonly assetCacheRoot: string;
  private readonly client: CampaignClient;
  private configuredPort = DEFAULT_SERVER_PORT;
  private readonly fetcher: typeof fetch;
  private readonly historyRepository: ConnectionHistoryRepository;
  private readonly getAssetRepositoryOverride?: NetworkManagerOptions['getAssetRepository'];
  private readonly getSceneRepositoryOverride?: NetworkManagerOptions['getSceneRepository'];
  private host: CampaignHostServer | null = null;
  private localChatCampaignId: string | null = null;
  private remoteActiveScene: SceneRecord | null = null;
  private readonly remoteTransformStarts = new Map<
    string,
    { base: SceneRecord; input: Omit<SceneTransformPreviewStart, 'campaignId'> }
  >();
  private readonly remoteTransformAnimations = new Map<
    string,
    {
      current: Omit<SceneTransformPreviewDelta, 'campaignId'>;
      lastAt: number;
      timers: Array<ReturnType<typeof setTimeout>>;
    }
  >();
  private hostRetryIndex = 0;
  private hostRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private publicAddresses: string[] = [];
  private readonly remoteCaches = new Map<string, RemoteAssetCache>();
  private remoteManifest: AssetManifest | null = null;
  private remoteCampaignCapabilities: AssetCapability | null = null;
  private remotePermissions = new Map<string, AssetCapability>();
  private remoteAssetSync: Promise<void> | null = null;
  private publicRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly users: ServerUserAdministration;
  private readonly warn: (message: string, error?: unknown) => void;

  constructor({
    assetCacheRoot = path.join(
      tmpdir(),
      'blackboxvtt-asset-cache',
      String(process.pid),
    ),
    campaignRepository,
    fetcher = fetch,
    getAssetRepository,
    getSceneRepository,
    historyRepository,
    warn = console.warn,
  }: NetworkManagerOptions) {
    super();
    this.assetCacheRoot = path.resolve(assetCacheRoot);
    this.campaignRepository = campaignRepository;
    this.fetcher = fetcher;
    this.historyRepository = historyRepository;
    this.getAssetRepositoryOverride = getAssetRepository;
    this.getSceneRepositoryOverride = getSceneRepository;
    this.warn = warn;
    this.users = new ServerUserAdministration({
      emitHostStatus: () => this.emitHostStatus(),
      getConfigRepository: (campaignId) =>
        this.getConfigRepository(campaignId),
      getHost: () => this.host,
    });
    this.client = new CampaignClient({
      historyRepository,
      onChatEvent: (event) => {
        this.recordChatEvent(event);
      },
      onAssetsChanged: (manifest) => {
        void this.synchronizeRemoteManifest(manifest, true);
      },
      onDrawingPreview: (input) => {
        const session = this.client.getSession();
        if (session) {
          this.emit('drawing-preview', {
            ...input,
            campaignId: session.campaignId,
          } satisfies DrawingPreviewEvent);
        }
      },
      onMapPing: (input) => {
        const session = this.client.getSession();
        if (session) {
          this.emit('map-ping', {
            ...input,
            campaignId: session.campaignId,
          } satisfies MapPing);
        }
      },
      onMeasurementUpdate: (input) => {
        const session = this.client.getSession();
        if (session) {
          this.emit('measurement-update', {
            ...input,
            campaignId: session.campaignId,
          } satisfies MeasurementEvent);
        }
      },
      onScenePresented: (scene) => {
        this.clearRemoteTransformAnimations();
        this.remoteActiveScene = scene;
        this.remoteTransformStarts.clear();
        const session = this.client.getSession();
        if (session) {
          this.emit('scene-presented', { campaignId: session.campaignId });
        }
      },
      onTransformStarted: (input) => {
        if (
          this.remoteActiveScene?.id === input.sceneId &&
          this.remoteActiveScene.revision === input.revision
        ) {
          this.remoteTransformStarts.set(input.operationId, {
            base: structuredClone(this.remoteActiveScene),
            input,
          });
          this.remoteTransformAnimations.set(input.operationId, {
            current: {
              ...(input.startingTransforms.length === 1
                ? { absolute: input.startingTransforms[0].transform }
                : {}),
              dx: 0,
              dy: 0,
              operationId: input.operationId,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
            },
            lastAt: Date.now(),
            timers: [],
          });
        }
      },
      onTransformCancelled: (input) => {
        const active = this.remoteTransformStarts.get(input.operationId);
        if (active?.base.id === input.sceneId) {
          this.clearRemoteTransformAnimation(input.operationId);
          this.remoteActiveScene = active.base;
          this.remoteTransformStarts.delete(input.operationId);
          this.emitRemoteSceneChanged();
        }
      },
      onTransformPreview: (input) => {
        const active = this.remoteTransformStarts.get(input.operationId);
        if (!active) {
          return;
        }
        const animation = this.remoteTransformAnimations.get(input.operationId);
        const now = Date.now();
        const start = animation?.current ?? {
          dx: 0,
          dy: 0,
          operationId: input.operationId,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
        };
        for (const timer of animation?.timers ?? []) {
          clearTimeout(timer);
        }
        const duration = Math.max(
          8,
          Math.min(34, animation ? now - animation.lastAt : 16),
        );
        const nextAnimation = {
          current: start,
          lastAt: now,
          timers: [] as Array<ReturnType<typeof setTimeout>>,
        };
        for (let step = 1; step <= 2; step += 1) {
          const progress = step / 2;
          nextAnimation.timers.push(
            setTimeout(() => {
              if (this.remoteTransformStarts.get(input.operationId) !== active) {
                return;
              }
              const value = {
                ...(input.absolute
                  ? { absolute: input.absolute }
                  : {}),
                dx: start.dx + (input.dx - start.dx) * progress,
                dy: start.dy + (input.dy - start.dy) * progress,
                operationId: input.operationId,
                rotation:
                  start.rotation +
                  (input.rotation - start.rotation) * progress,
                scaleX:
                  start.scaleX + (input.scaleX - start.scaleX) * progress,
                scaleY:
                  start.scaleY + (input.scaleY - start.scaleY) * progress,
              };
              nextAnimation.current = value;
              this.applyRemoteTransform(active, value);
            }, (duration * step) / 2),
          );
        }
        this.remoteTransformAnimations.set(
          input.operationId,
          nextAnimation,
        );
      },
      onSessionClosed: (code, message) => {
        this.clearRemoteTransformAnimations();
        this.remoteManifest = null;
        this.remoteActiveScene = null;
        this.remoteCampaignCapabilities = null;
        this.remotePermissions.clear();
        this.emit('session-closed', {
          code,
          message,
        } satisfies SessionClosedEvent);
      },
      onStateChanged: (state) => {
        this.emit('client-state-changed', {
          state,
        } satisfies ClientStateEvent);
      },
    });
  }

  async openHost(campaignId: string): Promise<NetworkResult<HostStatus>> {
    await this.stopHost();
    const container = await this.campaignRepository.getContainer(campaignId);
    if (!container) {
      return failure('campaign_not_found', 'Campaign could not be found.');
    }
    this.localChatCampaignId = campaignId;
    this.chatSystemEvents = [];

    try {
      const configRepository = new ServerConfigRepository(
        container.directory,
      );
      const config = await configRepository.load();
      const identity = await new CampaignIdentityRepository(
        container.directory,
        container.manifest.id,
        container.manifest.name,
      ).loadOrCreate();
      const assetRepository = await this.getAssetRepository(campaignId);
      if (!assetRepository) {
        throw new Error('Campaign asset storage could not be initialized.');
      }
      const sceneRepository = await this.getSceneRepository(campaignId);
      if (!sceneRepository) {
        throw new Error('Campaign scene storage could not be initialized.');
      }
      const chatRepository = await this.getChatRepository(campaignId);
      if (!chatRepository) {
        throw new Error('Campaign chat storage could not be initialized.');
      }
      this.configuredPort = config.port;
      const host = new CampaignHostServer({
        assetRepository,
        campaignId: container.manifest.id,
        campaignName: container.manifest.name,
        chatRepository,
        configRepository,
        identity,
        onAssetSyncError: (playerName, assetName, reason) => {
          this.emit('asset-error', {
            campaignId,
            code: 'sync_error',
            message: `${playerName} could not synchronize ${assetName}. ${reason}`,
            playerName,
            title: 'Player asset synchronization failed',
          } satisfies AssetErrorEvent);
        },
        onMapPing: (input) => {
          this.emit('map-ping', input);
        },
        onChatEvent: (event) => {
          this.recordChatEvent(event);
        },
        onDrawingPreview: (input) => {
          this.emit('drawing-preview', input);
        },
        onMeasurementUpdate: (input) => {
          this.emit('measurement-update', input);
        },
        onSceneChanged: () => {
          this.emit('scene-presented', { campaignId });
        },
        onStatusChanged: () => this.emitHostStatus(),
        onTransformCancelled: (input) => {
          this.emit('transform-cancelled', input);
        },
        onTransformPreview: (input) => {
          this.emit('transform-preview', input);
        },
        onTransformStarted: (input) => {
          this.emit('transform-started', input);
        },
        sceneRepository,
        transformPreviewRate: config.transformPreviewRate,
        warn: this.warn,
      });
      this.host = host;
      const started = await host.start(config.port);
      if (!started) {
        this.scheduleHostRetry();
      }
      void this.refreshPublicAddresses();
      this.publicRefreshTimer = setInterval(() => {
        void this.refreshPublicAddresses();
      }, PUBLIC_ADDRESS_REFRESH_MS);
      const status = this.getHostStatus();
      this.emitHostStatus();
      return { ok: true, value: status };
    } catch (error) {
      this.warn('Campaign host could not be initialized.', error);
      return failure('storage_error', 'Campaign server could not be initialized.');
    }
  }

  async stopHost(clearLocalChatSession = true): Promise<void> {
    if (this.hostRetryTimer) {
      clearTimeout(this.hostRetryTimer);
      this.hostRetryTimer = null;
    }
    if (this.publicRefreshTimer) {
      clearInterval(this.publicRefreshTimer);
      this.publicRefreshTimer = null;
    }
    const host = this.host;
    this.host = null;
    this.publicAddresses = [];
    this.hostRetryIndex = 0;
    if (clearLocalChatSession) {
      // Revoke local chat authority before waiting for sockets and SQLite so
      // no late renderer request can reopen a campaign being closed/trashed.
      this.localChatCampaignId = null;
      this.chatSystemEvents = [];
    }
    if (host) {
      await host.stop();
      await host.chatRepository.close();
    }
    this.emitHostStatus();
  }

  async stopHostForCampaign(campaignId: string): Promise<void> {
    if (this.host?.campaignId === campaignId) {
      await this.stopHost();
    }
    await this.closeChatForCampaign(campaignId);
  }

  getHostStatus(): HostStatus {
    if (!this.host) {
      return {
        boundFamilies: [],
        certificateFingerprint: null,
        connectedPlayerCount: 0,
        effectivePort: this.configuredPort,
        localAddresses: [],
        publicAddresses: [],
        state: 'offline',
      };
    }

    return this.host.toStatus(
      this.configuredPort,
      getLocalAddresses(),
      this.publicAddresses,
    );
  }

  async retryHostNow(): Promise<void> {
    if (!this.host || this.host.isOnline) {
      return;
    }
    if (this.hostRetryTimer) {
      clearTimeout(this.hostRetryTimer);
      this.hostRetryTimer = null;
    }
    const started = await this.host.start(this.configuredPort);
    if (started) {
      this.hostRetryIndex = 0;
    } else {
      this.scheduleHostRetry();
    }
  }

  async getServerSettings(
    campaignId: string,
  ): Promise<NetworkResult<ServerSettingsView>> {
    const repository = await this.getConfigRepository(campaignId);
    if (!repository) {
      return failure('campaign_not_found', 'Campaign could not be found.');
    }
    return repository.getView((userId) =>
      this.host?.campaignId === campaignId
        ? this.host.isUserConnected(userId)
        : false,
    );
  }

  async setPort(input: SetServerPortInput): Promise<NetworkResult<number>> {
    const repository = await this.getConfigRepository(input.campaignId);
    if (!repository) {
      return failure('campaign_not_found', 'Campaign could not be found.');
    }

    if (this.host?.campaignId === input.campaignId) {
      const result = await this.host.switchPort(input.port, () =>
        repository.setPort(input.port),
      );
      if (result.ok) {
        this.configuredPort = result.value;
        if (!this.host.isOnline) {
          this.scheduleHostRetry();
        }
      }
      this.emitHostStatus();
      return result;
    }

    return repository.setPort(input.port);
  }

  private emitRemoteSceneChanged(): void {
    const session = this.client.getSession();
    if (session) {
      this.emit('scene-presented', { campaignId: session.campaignId });
    }
  }

  async setTransformPreviewRate(
    input: SetTransformPreviewRateInput,
  ): Promise<NetworkResult<number>> {
    const repository = await this.getConfigRepository(input.campaignId);
    if (!repository) {
      return failure('campaign_not_found', 'Campaign could not be found.');
    }
    const result = await repository.setTransformPreviewRate(
      input.transformPreviewRate,
    );
    if (result.ok && this.host?.campaignId === input.campaignId) {
      this.host.setTransformPreviewRate(result.value);
    }
    return result;
  }

  async setMaxChatMessageCharacters(
    input: SetMaxChatMessageCharactersInput,
  ): Promise<NetworkResult<number>> {
    if (
      this.client.getSession()?.campaignId === input.campaignId ||
      this.localChatCampaignId !== input.campaignId
    ) {
      return {
        error: {
          code: 'permission_denied',
          message: 'Only Game Master can change chat settings.',
        },
        ok: false,
      };
    }
    const repository = await this.getConfigRepository(input.campaignId);
    if (!repository) {
      return failure('campaign_not_found', 'Campaign could not be found.');
    }
    const result = await repository.setMaxChatMessageCharacters(
      input.maxMessageCharacters,
    );
    if (result.ok && this.host?.campaignId === input.campaignId) {
      this.host.setMaxChatMessageCharacters(result.value);
    } else if (
      result.ok &&
      this.localChatCampaignId === input.campaignId
    ) {
      this.recordChatEvent({
        campaignId: input.campaignId,
        maxMessageCharacters: result.value,
        type: 'limit_changed',
      });
    }
    return result;
  }

  async createUser(
    input: CreateManagedUserInput,
  ): Promise<NetworkResult<ManagedUserView>> {
    const result = await this.users.createUser(input);
    if (result.ok && this.host?.campaignId === input.campaignId) {
      await this.host.broadcastChatDirectory();
    }
    return result;
  }

  async updateUsername(
    input: UpdateManagedUsernameInput,
  ): Promise<NetworkResult<ManagedUserView>> {
    const result = await this.users.updateUsername(input);
    if (result.ok && this.host?.campaignId === input.campaignId) {
      await this.host.broadcastChatDirectory();
    }
    return result;
  }

  resetPassword(
    input: ResetManagedPasswordInput,
  ): Promise<NetworkResult<null>> {
    return this.users.resetPassword(input);
  }

  async deleteUser(
    input: DeleteManagedUserInput,
  ): Promise<NetworkResult<null>> {
    const result = await this.users.deleteUser(input);
    if (result.ok && this.host?.campaignId === input.campaignId) {
      await this.host.broadcastChatDirectory();
    }
    return result;
  }

  connect(input: ConnectInput): Promise<NetworkResult<ConnectStep>> {
    this.localChatCampaignId = null;
    this.chatSystemEvents = [];
    this.remoteManifest = null;
    this.remoteCampaignCapabilities = null;
    this.remotePermissions.clear();
    return this.client.connect(input);
  }

  acceptTrust(
    input: AcceptTrustInput,
  ): Promise<NetworkResult<AuthenticationChallenge>> {
    return this.client.acceptTrust(input.attemptId);
  }

  authenticate(
    input: AuthenticateInput,
  ): Promise<NetworkResult<RemotePlaySession>> {
    return this.client.authenticate(input);
  }

  cancelConnection(attemptId?: string): Promise<void> {
    return this.client.cancel(attemptId);
  }

  async disconnect(): Promise<void> {
    this.remoteManifest = null;
    this.remoteCampaignCapabilities = null;
    this.remotePermissions.clear();
    await this.client.disconnect();
    this.chatSystemEvents = [];
  }

  listHistory(): Promise<NetworkResult<SavedConnection[]>> {
    return this.historyRepository.list();
  }

  async deleteHistory(input: DeleteHistoryInput): Promise<NetworkResult<null>> {
    const result = await this.historyRepository.delete(input.campaignId);
    if (result.ok) {
      const cache = this.remoteCaches.get(input.campaignId);
      this.remoteCaches.delete(input.campaignId);
      if (cache) {
        await cache.clear();
      } else {
        await rm(path.join(this.assetCacheRoot, input.campaignId), {
          force: true,
          recursive: true,
        });
      }
    }
    return result;
  }

  async getChatBootstrap(
    campaignId: string,
  ): Promise<ChatResult<ChatBootstrap>> {
    const remoteSession = this.client.getSession();
    if (remoteSession?.campaignId === campaignId) {
      const result = await this.client.getChatBootstrap();
      if (!result.ok) {
        return result;
      }
      return {
        ok: true,
        value: {
          ...result.value,
          systemEvents: this.chatSystemEvents.filter(
            (event) => event.generation === result.value.generation,
          ),
        },
      };
    }
    if (this.localChatCampaignId !== campaignId) {
      return {
        error: {
          code: 'permission_denied',
          message: 'Campaign chat is not active.',
        },
        ok: false,
      };
    }
    if (this.host?.campaignId === campaignId) {
      return this.host.getGmChatBootstrap(this.chatSystemEvents);
    }
    const repository = await this.getChatRepository(campaignId);
    const configRepository = await this.getConfigRepository(campaignId);
    if (!repository || !configRepository) {
      return this.chatUnavailable();
    }
    try {
      const config = await configRepository.load();
      return repository.bootstrap(
        { kind: 'gm' },
        this.chatDirectory(config.users),
        config.maxChatMessageCharacters,
        this.chatSystemEvents,
      );
    } catch {
      return this.chatUnavailable();
    }
  }

  async getChatHistory(
    input: ChatHistoryInput,
  ): Promise<ChatResult<ChatHistoryPage>> {
    const remoteSession = this.client.getSession();
    const request = {
      direction: input.direction,
      generation: input.generation,
      sequence: input.sequence,
    };
    if (remoteSession?.campaignId === input.campaignId) {
      return this.client.getChatHistory(request);
    }
    if (this.localChatCampaignId !== input.campaignId) {
      return {
        error: {
          code: 'permission_denied',
          message: 'Campaign chat is not active.',
        },
        ok: false,
      };
    }
    if (this.host?.campaignId === input.campaignId) {
      return this.host.getGmChatHistory(request);
    }
    const repository = await this.getChatRepository(input.campaignId);
    return repository
      ? repository.history({ kind: 'gm' }, request)
      : this.chatUnavailable();
  }

  async sendChatMessage(
    input: SendChatMessageInput,
  ): Promise<ChatResult<ChatMessage>> {
    const remoteSession = this.client.getSession();
    const request = {
      clientMessageId: input.clientMessageId,
      content: input.content,
      recipient: input.recipient,
    };
    if (remoteSession?.campaignId === input.campaignId) {
      return this.client.sendChatMessage(request);
    }
    if (this.localChatCampaignId !== input.campaignId) {
      return {
        error: {
          code: 'permission_denied',
          message: 'Campaign chat is not active.',
        },
        ok: false,
      };
    }
    if (this.host?.campaignId === input.campaignId) {
      return this.host.sendGmChat(request);
    }
    const repository = await this.getChatRepository(input.campaignId);
    const configRepository = await this.getConfigRepository(
      input.campaignId,
    );
    if (!repository || !configRepository) {
      return this.chatUnavailable();
    }
    try {
      return configRepository.withChatConfiguration(
        async (configuration) => {
          const recipient = this.resolveChatIdentity(
            input.recipient,
            configuration.users,
          );
          if (!recipient.ok) {
            return recipient;
          }
          const result = await repository.send({
            clientMessageId: input.clientMessageId,
            content: input.content,
            maxMessageCharacters: configuration.maxMessageCharacters,
            recipient: recipient.value,
            sender: {
              displayName: 'Game Master',
              kind: 'gm',
            },
          });
          return result.ok
            ? { ok: true, value: result.value.message }
            : result;
        },
      );
    } catch {
      return this.chatUnavailable();
    }
  }

  async clearChatHistory(
    campaignId: string,
  ): Promise<ChatResult<ClearChatHistoryResult>> {
    if (
      this.client.getSession()?.campaignId === campaignId ||
      this.localChatCampaignId !== campaignId
    ) {
      return {
        error: {
          code: 'permission_denied',
          message: 'Only Game Master can clear chat history.',
        },
        ok: false,
      };
    }
    if (this.host?.campaignId === campaignId) {
      return this.host.clearChatHistory();
    }
    const repository = await this.getChatRepository(campaignId);
    if (!repository) {
      return this.chatUnavailable();
    }
    const result = await repository.clear();
    if (result.ok) {
      this.recordChatEvent({
        campaignId,
        generation: result.value.generation,
        type: 'history_cleared',
      });
    }
    return result;
  }

  getRemoteAssetActor(campaignId: string): AssetActor | null {
    const session = this.client.getSession();
    return session?.campaignId === campaignId
      ? { id: session.userId, role: 'player' }
      : null;
  }

  async listRemoteAssets(
    campaignId: string,
  ): Promise<AssetResult<AssetView[]>> {
    if (!this.getRemoteAssetActor(campaignId)) {
      return {
        error: {
          code: 'sync_error',
          message: 'The remote campaign connection is not active.',
        },
        ok: false,
      };
    }
    const cache = this.getRemoteCache(campaignId);
    const manifest =
      this.remoteManifest ?? (await cache.getManifest());
    return {
      ok: true,
      value: await Promise.all(
        manifest.assets.map(async (record) => {
          const available = (await cache.getAssetPath(record)) !== null;
          return {
            ...record,
            available,
            capabilities:
              this.remotePermissions.get(record.id) ??
              this.remoteCampaignCapabilities ??
              getAssetCapabilities(
                authenticatedAssetPolicy,
                this.getRemoteAssetActor(campaignId)!,
                record,
              ),
            syncState: available
              ? ('ready' as const)
              : ('syncing' as const),
          };
        }),
      ),
    };
  }

  async prepareRemoteAssets(
    campaignId: string,
    onProgress: (event: AssetProgressEvent) => void,
  ): Promise<AssetResult<AssetView[]>> {
    if (!this.getRemoteAssetActor(campaignId)) {
      return {
        error: {
          code: 'sync_error',
          message: 'The remote campaign connection is not active.',
        },
        ok: false,
      };
    }
    const manifestResult = await this.client.getAssetManifest();
    if (!manifestResult.ok) {
      await this.disconnectRemoteForAssetFailure(
        campaignId,
        manifestResult.error.message,
        manifestResult.error.assetId,
      );
      return manifestResult;
    }
    try {
      await this.synchronizeRemoteManifest(
        manifestResult.value,
        false,
        onProgress,
      );
      return this.listRemoteAssets(campaignId);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Campaign assets could not be synchronized.';
      await this.disconnectRemoteForAssetFailure(
        campaignId,
        message,
        error instanceof AssetCacheSyncError ? error.assetId : undefined,
      );
      return {
        error: { code: 'sync_error', message },
        ok: false,
      };
    }
  }

  async getRemotePreviewPath(
    campaignId: string,
    assetId: string,
  ): Promise<string | null> {
    const cache = this.getRemoteCache(campaignId);
    const asset = (await cache.getManifest()).assets.find(
      (candidate) => candidate.id === assetId,
    );
    return asset ? cache.getAssetPath(asset) : null;
  }

  async importRemoteAssets(
    campaignId: string,
    sourcePaths: string[],
    onProgress: (event: AssetProgressEvent) => void,
  ): Promise<AssetResult<AssetView[]>> {
    if (!this.getRemoteAssetActor(campaignId)) {
      return {
        error: {
          code: 'sync_error',
          message: 'The remote campaign connection is not active.',
        },
        ok: false,
      };
    }
    const uploaded = await this.client.uploadAssets(sourcePaths, onProgress);
    if (!uploaded.ok) {
      return uploaded;
    }
    return this.prepareRemoteAssets(campaignId, onProgress);
  }

  async renameRemoteAsset(
    input: RenameAssetInput,
  ): Promise<AssetResult<AssetView>> {
    const actor = this.getRemoteAssetActor(input.campaignId);
    if (!actor) {
      return {
        error: {
          assetId: input.assetId,
          code: 'sync_error',
          message: 'The remote campaign connection is not active.',
        },
        ok: false,
      };
    }
    const result = await this.client.renameAsset(input);
    if (!result.ok) {
      return result;
    }
    return {
      ok: true,
      value: {
        ...result.value,
        available: true,
        capabilities:
          this.remotePermissions.get(result.value.id) ??
          this.remoteCampaignCapabilities ??
          getAssetCapabilities(
            authenticatedAssetPolicy,
            actor,
            result.value,
          ),
        syncState: 'ready',
      },
    };
  }

  async trashRemoteAsset(
    input: TrashAssetInput,
  ): Promise<AssetResult<null>> {
    return this.client.trashAsset(input);
  }

  async notifyAssetsChanged(campaignId: string): Promise<void> {
    if (this.host?.campaignId === campaignId) {
      await this.host.broadcastAssetsChanged();
    }
  }

  async notifyScenePresented(campaignId: string): Promise<void> {
    if (this.host?.campaignId === campaignId) {
      await this.host.broadcastActiveScene();
    }
  }

  async sendMapPing(input: MapPing): Promise<void> {
    const session = this.client.getSession();
    if (session?.campaignId === input.campaignId) {
      this.client.sendMapPing({
        id: input.id,
        pullPlayers: input.pullPlayers,
        sceneId: input.sceneId,
        x: input.x,
        y: input.y,
      });
      return;
    }
    if (this.host?.campaignId === input.campaignId) {
      await this.host.broadcastMapPing(input);
    }
  }

  async sendMeasurementUpdate(
    input: MeasurementUpdate,
  ): Promise<void> {
    const session = this.client.getSession();
    if (session?.campaignId === input.campaignId) {
      this.client.sendMeasurementUpdate({
        active: input.active,
        measurementId: input.measurementId,
        points: input.points,
        sceneId: input.sceneId,
        updateSequence: input.updateSequence,
      });
      return;
    }
    if (this.host?.campaignId === input.campaignId) {
      await this.host.broadcastMeasurementUpdate(input);
    }
  }

  async sendDrawingPreview(
    input: DrawingPreviewUpdate,
  ): Promise<void> {
    const session = this.client.getSession();
    if (session?.campaignId === input.campaignId) {
      this.client.sendDrawingPreview({
        active: input.active,
        closed: input.closed,
        kind: input.kind,
        layer: input.layer,
        operationId: input.operationId,
        points: input.points,
        ...(input.reliable ? { reliable: true } : {}),
        sceneId: input.sceneId,
        sequence: input.sequence,
        style: input.style,
      });
      return;
    }
    if (this.host?.campaignId === input.campaignId) {
      await this.host.broadcastDrawingPreview(input);
    }
  }

  async notifyTransformStarted(
    input: SceneTransformPreviewStart,
  ): Promise<void> {
    if (this.host?.campaignId === input.campaignId) {
      await this.host.broadcastTransformStarted(input);
    }
  }

  async notifyTransformPreview(
    input: SceneTransformPreviewDelta,
  ): Promise<void> {
    if (this.host?.campaignId === input.campaignId) {
      this.host.broadcastTransformPreview(input);
    }
  }

  async notifyTransformCancelled(
    input: SceneTransformPreviewCancel,
  ): Promise<void> {
    if (this.host?.campaignId === input.campaignId) {
      this.host.broadcastTransformCancelled(input);
    }
  }

  async setRemoteSceneObjects(
    input: SetSceneObjectsInput,
  ): Promise<SceneResult<SceneRecord>> {
    const session = this.client.getSession();
    if (session?.campaignId !== input.campaignId) {
      return {
        error: {
          code: 'permission_denied',
          message: 'The remote campaign is not active.',
        },
        ok: false,
      };
    }
    return this.client.setSceneObjects({
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
      sceneId: input.sceneId,
      state: input.state,
    });
  }

  undoSceneEdit(
    input: SceneHistoryInput,
  ): Promise<SceneResult<SceneRecord>> {
    return this.client.undoSceneEdit({ sceneId: input.sceneId });
  }

  redoSceneEdit(
    input: SceneHistoryInput,
  ): Promise<SceneResult<SceneRecord>> {
    return this.client.redoSceneEdit({ sceneId: input.sceneId });
  }

  async startRemoteTransform(
    input: SceneTransformPreviewStart,
  ): Promise<void> {
    await this.client.startSceneTransform({
      kind: input.kind,
      operationId: input.operationId,
      pivotX: input.pivotX,
      pivotY: input.pivotY,
      revision: input.revision,
      sceneId: input.sceneId,
      targets: input.targets,
    });
  }

  async updateRemoteTransform(
    input: SceneTransformPreviewDelta,
  ): Promise<void> {
    this.client.sendSceneTransformPreview({
      ...(input.absolute ? { absolute: input.absolute } : {}),
      dx: input.dx,
      dy: input.dy,
      operationId: input.operationId,
      rotation: input.rotation,
      scaleX: input.scaleX,
      scaleY: input.scaleY,
    });
  }

  async cancelRemoteTransform(
    input: SceneTransformPreviewCancel,
  ): Promise<void> {
    this.client.cancelSceneTransform({
      operationId: input.operationId,
      sceneId: input.sceneId,
    });
  }

  /** The scene the host is presenting, for campaigns joined as a player. */
  getRemoteActiveScene(campaignId: string): SceneRecord | null {
    const session = this.client.getSession();
    return session?.campaignId === campaignId ? this.remoteActiveScene : null;
  }

  isRemoteCampaign(campaignId: string): boolean {
    return this.client.getSession()?.campaignId === campaignId;
  }

  private applyRemoteTransform(
    active: {
      base: SceneRecord;
      input: Omit<SceneTransformPreviewStart, 'campaignId'>;
    },
    delta: Omit<SceneTransformPreviewDelta, 'campaignId'>,
  ): void {
    const scene: SceneRecord = structuredClone(active.base);
    if (delta.absolute && active.input.targets.length === 1) {
      const targetId = active.input.targets[0];
      if (targetId === 'canonical-map' && scene.mapImage) {
        scene.mapImage = { ...scene.mapImage, ...delta.absolute };
      } else {
        for (const layer of Object.values(scene.images) as SceneImage[][]) {
          const image = layer.find((candidate) => candidate.id === targetId);
          if (image) {
            Object.assign(image, delta.absolute);
            break;
          }
        }
        for (const layer of Object.values(scene.drawings) as SceneDrawing[][]) {
          const drawing = layer.find((candidate) => candidate.id === targetId);
          if (drawing) {
            Object.assign(drawing, delta.absolute);
            break;
          }
        }
      }
      this.remoteActiveScene = scene;
      this.emitRemoteSceneChanged();
      return;
    }
    const radians = (delta.rotation * Math.PI) / 180;
    const apply = <
      T extends {
        height: number;
        rotation: number;
        width: number;
        x: number;
        y: number;
      },
    >(
      image: T,
    ): T => {
      const dx = (image.x - active.input.pivotX) * delta.scaleX;
      const dy = (image.y - active.input.pivotY) * delta.scaleY;
      return {
        ...image,
        height: image.height * delta.scaleY,
        rotation: image.rotation + delta.rotation,
        width: image.width * delta.scaleX,
        x:
          active.input.pivotX +
          Math.cos(radians) * dx -
          Math.sin(radians) * dy +
          delta.dx,
        y:
          active.input.pivotY +
          Math.sin(radians) * dx +
          Math.cos(radians) * dy +
          delta.dy,
      };
    };
    if (
      active.input.targets.includes('canonical-map') &&
      scene.mapImage
    ) {
      scene.mapImage = apply(scene.mapImage);
    }
    const targets = new Set(active.input.targets);
    for (const layer of Object.values(scene.images)) {
      for (let index = 0; index < layer.length; index += 1) {
        if (targets.has(layer[index].id)) {
          layer[index] = apply(layer[index]);
        }
      }
    }
    for (const layer of Object.values(scene.drawings)) {
      for (let index = 0; index < layer.length; index += 1) {
        const drawing = layer[index];
        if (!targets.has(drawing.id)) {
          continue;
        }
        const dx =
          (drawing.x - active.input.pivotX) * delta.scaleX;
        const dy =
          (drawing.y - active.input.pivotY) * delta.scaleY;
        layer[index] = {
          ...drawing,
          rotation: drawing.rotation + delta.rotation,
          scaleX: drawing.scaleX * delta.scaleX,
          scaleY: drawing.scaleY * delta.scaleY,
          x:
            active.input.pivotX +
            Math.cos(radians) * dx -
            Math.sin(radians) * dy +
            delta.dx,
          y:
            active.input.pivotY +
            Math.sin(radians) * dx +
            Math.cos(radians) * dy +
            delta.dy,
        };
      }
    }
    this.remoteActiveScene = scene;
    this.emitRemoteSceneChanged();
  }

  private clearRemoteTransformAnimation(operationId: string): void {
    const animation = this.remoteTransformAnimations.get(operationId);
    for (const timer of animation?.timers ?? []) {
      clearTimeout(timer);
    }
    this.remoteTransformAnimations.delete(operationId);
  }

  private clearRemoteTransformAnimations(): void {
    for (const operationId of this.remoteTransformAnimations.keys()) {
      this.clearRemoteTransformAnimation(operationId);
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all([this.stopHost(), this.disconnect()]);
    await Promise.all(
      [...this.chatRepositories.values()].map((repository) =>
        repository.close(),
      ),
    );
    this.chatRepositories.clear();
  }

  async closeChatForCampaign(campaignId: string): Promise<void> {
    const repository = this.chatRepositories.get(campaignId);
    this.chatRepositories.delete(campaignId);
    await repository?.close();
    if (this.localChatCampaignId === campaignId) {
      this.localChatCampaignId = null;
      this.chatSystemEvents = [];
    }
  }

  private chatUnavailable<T>(): ChatResult<T> {
    return {
      error: {
        code: 'storage_error',
        message: 'Campaign chat is unavailable.',
      },
      ok: false,
    };
  }

  private chatDirectory(users: StoredManagedUser[]): ChatIdentity[] {
    return [
      { displayName: 'Game Master', kind: 'gm' },
      ...[...users]
        .sort(
          (left, right) =>
            left.username.localeCompare(right.username, 'en-US') ||
            left.id.localeCompare(right.id),
        )
        .map(
          (user): ChatIdentity => ({
            displayName: user.username,
            kind: 'player',
            userId: user.id,
          }),
        ),
    ];
  }

  private resolveChatIdentity(
    principal: ChatPrincipal | null,
    users: StoredManagedUser[],
  ): ChatResult<ChatIdentity | null> {
    if (!principal) {
      return { ok: true, value: null };
    }
    if (principal.kind === 'gm') {
      return { ok: true, value: { displayName: 'Game Master', kind: 'gm' } };
    }
    const user = users.find((candidate) => candidate.id === principal.userId);
    return user
      ? {
          ok: true,
          value: {
            displayName: user.username,
            kind: 'player',
            userId: user.id,
          },
        }
      : {
          error: {
            code: 'recipient_not_found',
            message: 'Whisper recipient could not be found.',
          },
          ok: false,
        };
  }

  private recordChatEvent(event: ChatEvent): void {
    const remoteCampaignId = this.client.getSession()?.campaignId;
    if (
      event.campaignId !== this.localChatCampaignId &&
      event.campaignId !== remoteCampaignId
    ) {
      return;
    }
    if (
      event.type === 'participant_joined' ||
      event.type === 'participant_left'
    ) {
      if (
        !this.chatSystemEvents.some(
          (candidate) => candidate.eventId === event.eventId,
        )
      ) {
        this.chatSystemEvents.push({
          eventId: event.eventId,
          generation: event.generation,
          identity: structuredClone(event.identity),
          occurredAt: event.occurredAt,
          type: event.type,
        });
      }
    } else if (event.type === 'history_cleared') {
      this.chatSystemEvents = [];
    }
    this.emit('chat-event', event);
  }

  private async getChatRepository(
    campaignId: string,
  ): Promise<ChatRepository | null> {
    let repository = this.chatRepositories.get(campaignId);
    if (repository) {
      return repository;
    }
    const container = await this.campaignRepository.getContainer(campaignId);
    if (!container) {
      return null;
    }
    repository = new ChatRepository({
      campaignDirectory: container.directory,
      touchCampaign: async () => {
        await this.campaignRepository.touch(campaignId);
      },
      warn: this.warn,
    });
    this.chatRepositories.set(campaignId, repository);
    return repository;
  }

  private getRemoteCache(campaignId: string): RemoteAssetCache {
    let cache = this.remoteCaches.get(campaignId);
    if (!cache) {
      cache = new RemoteAssetCache(this.assetCacheRoot, campaignId);
      this.remoteCaches.set(campaignId, cache);
    }
    return cache;
  }

  private async synchronizeRemoteManifest(
    snapshot: AssetNetworkSnapshot,
    background: boolean,
    onProgress: (event: AssetProgressEvent) => void = (event) => {
      this.emit('asset-progress', event);
    },
  ): Promise<void> {
    const session = this.client.getSession();
    if (!session) {
      return;
    }
    const manifest = snapshot.manifest;
    this.remoteManifest = manifest;
    this.remoteCampaignCapabilities = snapshot.campaignCapabilities;
    this.remotePermissions = new Map(
      snapshot.permissions.map((entry) => [
        entry.assetId,
        entry.capabilities,
      ]),
    );
    if (background) {
      const cache = this.getRemoteCache(session.campaignId);
      const announced = await Promise.all(
        manifest.assets.map(async (record) => {
          const available = (await cache.getAssetPath(record)) !== null;
          return {
            ...record,
            available,
            capabilities:
              this.remotePermissions.get(record.id) ??
              snapshot.campaignCapabilities,
            syncState: available
              ? ('ready' as const)
              : ('syncing' as const),
          };
        }),
      );
      this.emit('assets-changed', {
        assets: announced,
        campaignId: session.campaignId,
        revision: manifest.revision,
      } satisfies AssetChangedEvent);
    }
    const run = async () => {
      const cache = this.getRemoteCache(session.campaignId);
      await cache.synchronize(
        manifest,
        async (asset, index) => {
          const chunk = await this.client.getAssetChunk(asset, index);
          if (!chunk.ok) {
            throw new Error(chunk.error.message);
          }
          return chunk.value;
        },
        (event) => {
          onProgress(event);
          this.emit('asset-progress', event);
        },
      );
      const listed = await this.listRemoteAssets(session.campaignId);
      if (listed.ok) {
        this.emit('assets-changed', {
          assets: listed.value,
          campaignId: session.campaignId,
          revision: manifest.revision,
        } satisfies AssetChangedEvent);
      }
    };
    const previous = this.remoteAssetSync ?? Promise.resolve();
    const operation = previous.then(run);
    const queued = operation.finally(() => {
      if (this.remoteAssetSync === queued) {
        this.remoteAssetSync = null;
      }
    });
    this.remoteAssetSync = queued;
    try {
      await queued;
    } catch (error) {
      if (background) {
        const message =
          error instanceof Error
            ? error.message
            : 'A background asset could not be synchronized.';
        await this.disconnectRemoteForAssetFailure(
          session.campaignId,
          message,
          error instanceof AssetCacheSyncError ? error.assetId : undefined,
        );
      }
      throw error;
    }
  }

  private async disconnectRemoteForAssetFailure(
    campaignId: string,
    message: string,
    assetId?: string,
  ): Promise<void> {
    const cache = this.getRemoteCache(campaignId);
    const manifest = this.remoteManifest ?? (await cache.getManifest());
    const assetName =
      manifest.assets.find((asset) => asset.id === assetId)?.displayName ??
      'campaign asset';
    this.client.reportAssetSyncError(assetName, message, assetId);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await this.client.disconnect();
    this.remoteManifest = null;
    this.remoteCampaignCapabilities = null;
    this.remotePermissions.clear();
    const event: AssetErrorEvent = {
      assetId,
      campaignId,
      code: 'sync_error',
      message,
      title: 'Campaign asset synchronization failed',
    };
    this.emit('asset-error', event);
    this.emit('session-closed', {
      code: 'storage_error',
      message,
    } satisfies SessionClosedEvent);
  }

  private async getAssetRepository(
    campaignId: string,
  ): Promise<AssetRepository | null> {
    if (this.host?.campaignId === campaignId) {
      return this.host.assetRepository;
    }
    if (this.getAssetRepositoryOverride) {
      return this.getAssetRepositoryOverride(campaignId);
    }
    const container = await this.campaignRepository.getContainer(campaignId);
    return container
      ? new AssetRepository({
          campaignDirectory: container.directory,
          touchCampaign: async () => {
            const result = await this.campaignRepository.touch(campaignId);
            if (!result.ok) {
              throw new Error(result.error.message);
            }
          },
          trashItem: (targetPath) =>
            rm(targetPath, { force: true, recursive: true }),
        })
      : null;
  }

  private async getSceneRepository(
    campaignId: string,
  ): Promise<SceneRepository | null> {
    if (this.host?.campaignId === campaignId) {
      return this.host.sceneRepository;
    }
    if (this.getSceneRepositoryOverride) {
      return this.getSceneRepositoryOverride(campaignId);
    }
    const container = await this.campaignRepository.getContainer(campaignId);
    return container
      ? new SceneRepository({
          campaignDirectory: container.directory,
          touchCampaign: async () => {
            await this.campaignRepository.touch(campaignId);
          },
        })
      : null;
  }

  private async getConfigRepository(
    campaignId: string,
  ): Promise<ServerConfigRepository | null> {
    if (this.host?.campaignId === campaignId) {
      return this.host.configRepository;
    }
    const container = await this.campaignRepository.getContainer(campaignId);
    return container
      ? new ServerConfigRepository(container.directory)
      : null;
  }

  private scheduleHostRetry(): void {
    if (!this.host || this.host.isOnline || this.hostRetryTimer) {
      return;
    }
    const delay =
      HOST_RETRY_DELAYS_MS[
        Math.min(this.hostRetryIndex, HOST_RETRY_DELAYS_MS.length - 1)
      ];
    this.hostRetryIndex += 1;
    this.hostRetryTimer = setTimeout(() => {
      this.hostRetryTimer = null;
      void this.retryHostNow();
    }, delay);
  }

  private async refreshPublicAddresses(): Promise<void> {
    if (!this.host) {
      return;
    }
    const addresses = await Promise.all([
      lookupPublicAddress(
        'https://api.ipify.org?format=json',
        this.fetcher,
      ),
      lookupPublicAddress(
        'https://api6.ipify.org?format=json',
        this.fetcher,
      ),
    ]);
    this.publicAddresses = [
      ...new Set(addresses.filter((address): address is string => !!address)),
    ];
    this.emitHostStatus();
  }

  private emitHostStatus(): void {
    this.emit('host-status-changed', this.getHostStatus());
  }
}
