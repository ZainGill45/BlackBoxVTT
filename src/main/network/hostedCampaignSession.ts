import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import type {
  ChatBootstrap,
  ChatEvent,
  ChatHistoryPage,
  ChatMessage,
  ChatParticipantEvent,
  ChatResult,
  ClearChatHistoryResult,
} from '../../shared/chat';
import type { AssetErrorEvent } from '../../shared/assets';
import type {
  CreateManagedUserInput,
  DrawingPreviewEvent,
  HostStatus,
  ManagedUserView,
  MapPing,
  MeasurementEvent,
  NetworkResult,
  ServerSettingsView,
  ShapePreviewEvent,
} from '../../shared/network';
import type {
  SceneTransformPreviewCancel,
  SceneTransformPreviewDelta,
  SceneTransformPreviewStart,
} from '../../shared/scenes';
import type { LocalCampaignWorkspace } from '../campaignWorkspace';
import type {
  CampaignNetworkSession,
  SessionChatHistoryInput,
  SessionChatMessageInput,
  SessionDrawingPreview,
  SessionFogPreview,
  SessionMapPing,
  SessionMeasurementUpdate,
  SessionShapePreview,
} from './campaignNetworkSession';
import { CampaignHostServer } from './campaignHostServer';
import type { CampaignIdentity } from './campaignIdentity';
import { ServerUserAdministration } from './serverUserAdministration';

const PUBLIC_ADDRESS_REFRESH_MS = 15 * 60_000;
const HOST_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000] as const;

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

export interface HostedCampaignSessionEvents {
  onAssetError: (event: AssetErrorEvent) => void;
  onChatEvent: (event: ChatEvent) => void;
  onDrawingPreview: (event: DrawingPreviewEvent) => void;
  onMapPing: (event: MapPing) => void;
  onMeasurementUpdate: (event: MeasurementEvent) => void;
  onShapePreview: (event: ShapePreviewEvent) => void;
  onScenePresented: (campaignId: string) => void;
  onStatusChanged: (status: HostStatus) => void;
  onTransformCancelled: (event: SceneTransformPreviewCancel) => void;
  onTransformPreview: (event: SceneTransformPreviewDelta) => void;
  onTransformStarted: (event: SceneTransformPreviewStart) => void;
}

interface HostedCampaignSessionOptions {
  events: HostedCampaignSessionEvents;
  fetcher?: typeof fetch;
  warn?: (message: string, error?: unknown) => void;
  workspace: LocalCampaignWorkspace;
}

interface InitializedHostedCampaignSessionOptions
  extends HostedCampaignSessionOptions {
  configuredPort: number;
  identity: CampaignIdentity;
  transformPreviewRate: number;
}

/** Owns every network capability for one locally hosted campaign. */
export class HostedCampaignSession implements CampaignNetworkSession {
  readonly campaignId: string;
  readonly kind = 'hosted' as const;
  private chatSystemEvents: ChatParticipantEvent[] = [];
  private configuredPort: number;
  private readonly events: HostedCampaignSessionEvents;
  private readonly fetcher: typeof fetch;
  private hostRetryIndex = 0;
  private hostRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private publicAddresses: string[] = [];
  private publicRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly server: CampaignHostServer;
  private readonly users: ServerUserAdministration;

  private constructor({
    configuredPort,
    events,
    fetcher = fetch,
    identity,
    transformPreviewRate,
    warn = console.warn,
    workspace,
  }: InitializedHostedCampaignSessionOptions) {
    this.campaignId = workspace.manifest.id;
    this.configuredPort = configuredPort;
    this.events = events;
    this.fetcher = fetcher;
    this.server = new CampaignHostServer({
      assetRepository: workspace.assetRepository,
      campaignId: workspace.manifest.id,
      campaignName: workspace.manifest.name,
      chatRepository: workspace.chatRepository,
      configRepository: workspace.configRepository,
      identity,
      onAssetSyncError: (playerName, assetName, reason) => {
        this.events.onAssetError({
          campaignId: this.campaignId,
          code: 'sync_error',
          message: `${playerName} could not synchronize ${assetName}. ${reason}`,
          playerName,
          title: 'Player asset synchronization failed',
        });
      },
      onChatEvent: (event) => this.recordChatEvent(event),
      onDrawingPreview: this.events.onDrawingPreview,
      onMapPing: this.events.onMapPing,
      onMeasurementUpdate: this.events.onMeasurementUpdate,
      onShapePreview: this.events.onShapePreview,
      onSceneChanged: () =>
        this.events.onScenePresented(this.campaignId),
      onStatusChanged: () => this.emitStatus(),
      onTransformCancelled: this.events.onTransformCancelled,
      onTransformPreview: this.events.onTransformPreview,
      onTransformStarted: this.events.onTransformStarted,
      sceneRepository: workspace.sceneRepository,
      transformPreviewRate,
      warn,
    });
    this.users = new ServerUserAdministration({
      emitHostStatus: () => this.emitStatus(),
      host: this.server,
      repository: workspace.configRepository,
    });
  }

  static async open(
    options: HostedCampaignSessionOptions,
  ): Promise<HostedCampaignSession> {
    const [config, identity] = await Promise.all([
      options.workspace.configRepository.load(),
      options.workspace.identityRepository.loadOrCreate(),
    ]);
    const session = new HostedCampaignSession({
      ...options,
      configuredPort: config.port,
      identity,
      transformPreviewRate: config.transformPreviewRate,
    });
    const started = await session.server.start(config.port);
    if (!started) {
      session.scheduleRetry();
    }
    void session.refreshPublicAddresses();
    session.publicRefreshTimer = setInterval(() => {
      void session.refreshPublicAddresses();
    }, PUBLIC_ADDRESS_REFRESH_MS);
    session.emitStatus();
    return session;
  }

  get status(): HostStatus {
    return this.server.toStatus(
      this.configuredPort,
      getLocalAddresses(),
      this.publicAddresses,
    );
  }

  async stop(): Promise<void> {
    if (this.hostRetryTimer) {
      clearTimeout(this.hostRetryTimer);
      this.hostRetryTimer = null;
    }
    if (this.publicRefreshTimer) {
      clearInterval(this.publicRefreshTimer);
      this.publicRefreshTimer = null;
    }
    this.publicAddresses = [];
    this.hostRetryIndex = 0;
    this.chatSystemEvents = [];
    await this.server.stop();
    this.emitStatus();
  }

  async retryNow(): Promise<void> {
    if (this.server.isOnline) {
      return;
    }
    if (this.hostRetryTimer) {
      clearTimeout(this.hostRetryTimer);
      this.hostRetryTimer = null;
    }
    const started = await this.server.start(this.configuredPort);
    if (started) {
      this.hostRetryIndex = 0;
    } else {
      this.scheduleRetry();
    }
  }

  getServerSettings(): Promise<NetworkResult<ServerSettingsView>> {
    return this.server.configRepository.getView((userId) =>
      this.server.isUserConnected(userId),
    );
  }

  async setPort(port: number): Promise<NetworkResult<number>> {
    const result = await this.server.switchPort(port, () =>
      this.server.configRepository.setPort(port),
    );
    if (result.ok) {
      this.configuredPort = result.value;
      if (!this.server.isOnline) {
        this.scheduleRetry();
      }
    }
    this.emitStatus();
    return result;
  }

  async setTransformPreviewRate(rate: number): Promise<NetworkResult<number>> {
    const result =
      await this.server.configRepository.setTransformPreviewRate(rate);
    if (result.ok) {
      this.server.setTransformPreviewRate(result.value);
    }
    return result;
  }

  async setMaxChatMessageCharacters(
    maxMessageCharacters: number,
  ): Promise<NetworkResult<number>> {
    const result =
      await this.server.configRepository.setMaxChatMessageCharacters(
        maxMessageCharacters,
      );
    if (result.ok) {
      this.server.setMaxChatMessageCharacters(result.value);
    }
    return result;
  }

  async createUser(
    input: Pick<CreateManagedUserInput, 'password' | 'username'>,
  ): Promise<NetworkResult<ManagedUserView>> {
    const result = await this.users.createUser(input.username, input.password);
    if (result.ok) {
      await this.server.broadcastChatDirectory();
    }
    return result;
  }

  async updateUsername(
    userId: string,
    username: string,
  ): Promise<NetworkResult<ManagedUserView>> {
    const result = await this.users.updateUsername(userId, username);
    if (result.ok) {
      await this.server.broadcastChatDirectory();
    }
    return result;
  }

  resetPassword(userId: string, password: string): Promise<NetworkResult<null>> {
    return this.users.resetPassword(userId, password);
  }

  async deleteUser(userId: string): Promise<NetworkResult<null>> {
    const result = await this.users.deleteUser(userId);
    if (result.ok) {
      await this.server.broadcastChatDirectory();
    }
    return result;
  }

  getChatBootstrap(): Promise<ChatResult<ChatBootstrap>> {
    return this.server.getGmChatBootstrap(this.chatSystemEvents);
  }

  getChatHistory(
    input: SessionChatHistoryInput,
  ): Promise<ChatResult<ChatHistoryPage>> {
    return this.server.getGmChatHistory(input);
  }

  sendChatMessage(
    input: SessionChatMessageInput,
  ): Promise<ChatResult<ChatMessage>> {
    return this.server.sendGmChat(input);
  }

  clearChatHistory(): Promise<ChatResult<ClearChatHistoryResult>> {
    return this.server.clearChatHistory();
  }

  sendMapPing(input: SessionMapPing): Promise<void> {
    return this.server.broadcastMapPing({ ...input, campaignId: this.campaignId });
  }

  sendDrawingPreview(input: SessionDrawingPreview): Promise<void> {
    return this.server.broadcastDrawingPreview({
      ...input,
      campaignId: this.campaignId,
    });
  }

  sendFogPreview(input: SessionFogPreview): Promise<void> {
    return this.server.broadcastFogPreview({
      ...input,
      campaignId: this.campaignId,
    });
  }

  sendShapePreview(input: SessionShapePreview): Promise<void> {
    return this.server.broadcastShapePreview({
      ...input,
      campaignId: this.campaignId,
    });
  }

  sendMeasurementUpdate(input: SessionMeasurementUpdate): Promise<void> {
    return this.server.broadcastMeasurementUpdate({
      ...input,
      campaignId: this.campaignId,
    });
  }

  notifyAssetsChanged(): Promise<void> {
    return this.server.broadcastAssetsChanged();
  }

  notifyScenePresented(): Promise<void> {
    return this.server.broadcastActiveScene();
  }

  notifyTransformStarted(input: SceneTransformPreviewStart): Promise<void> {
    return this.server.broadcastTransformStarted(input);
  }

  notifyTransformPreview(input: SceneTransformPreviewDelta): void {
    this.server.broadcastTransformPreview(input);
  }

  notifyTransformCancelled(input: SceneTransformPreviewCancel): void {
    this.server.broadcastTransformCancelled(input);
  }

  private scheduleRetry(): void {
    if (this.server.isOnline || this.hostRetryTimer) {
      return;
    }
    const delay =
      HOST_RETRY_DELAYS_MS[
        Math.min(this.hostRetryIndex, HOST_RETRY_DELAYS_MS.length - 1)
      ];
    this.hostRetryIndex += 1;
    this.hostRetryTimer = setTimeout(() => {
      this.hostRetryTimer = null;
      void this.retryNow();
    }, delay);
  }

  private async refreshPublicAddresses(): Promise<void> {
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
    this.emitStatus();
  }

  private recordChatEvent(event: ChatEvent): void {
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
    this.events.onChatEvent(event);
  }

  private emitStatus(): void {
    this.events.onStatusChanged(this.status);
  }
}
