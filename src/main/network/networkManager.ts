import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  ChatBootstrap,
  ChatHistoryInput,
  ChatHistoryPage,
  ChatMessage,
  ChatResult,
  ClearChatHistoryResult,
  SendChatMessageInput,
  SendChatRollInput,
  SetMaxChatMessageCharactersInput,
} from '../../shared/chat';
import type {
  AcceptTrustInput,
  AuthenticateInput,
  AuthenticationChallenge,
  ConnectInput,
  ConnectStep,
  CreateManagedUserInput,
  DeleteHistoryInput,
  DeleteManagedUserInput,
  DrawingPreviewUpdate,
  HostStatus,
  ManagedUserView,
  MapPing,
  MeasurementUpdate,
  NetworkResult,
  RemotePlaySession,
  ResetManagedPasswordInput,
  SavedConnection,
  ServerSettingsView,
  ShapePreviewUpdate,
  SetServerPortInput,
  SetTransformPreviewRateInput,
  UpdateManagedUsernameInput,
} from '../../shared/network';
import { DEFAULT_SERVER_PORT } from '../../shared/network';
import { fail } from '../../shared/result';
import type {
  SceneTransformPreviewCancel,
  SceneTransformPreviewDelta,
  SceneTransformPreviewStart,
} from '../../shared/scenes';
import type { CampaignRuntimeRegistry } from '../campaignRuntime';
import type { CampaignNetworkSession } from './campaignNetworkSession';
import type { ConnectionHistoryRepository } from './connectionHistoryRepository';
import { HostedCampaignSession } from './hostedCampaignSession';
import { JoinedCampaignConnection } from './joinedCampaignConnection';

function failure<T>(
  code: 'campaign_not_found' | 'storage_error',
  message: string,
): NetworkResult<T> {
  return fail({ code, message });
}

interface NetworkManagerOptions {
  assetCacheRoot?: string;
  fetcher?: typeof fetch;
  historyRepository: ConnectionHistoryRepository;
  runtimes: CampaignRuntimeRegistry;
  warn?: (message: string, error?: unknown) => void;
}

/**
 * Main-process facade for network IPC. Hosted and joined behavior lives in
 * role-specific session owners selected once per campaign.
 */
export class NetworkManager extends EventEmitter {
  private configuredPort = DEFAULT_SERVER_PORT;
  private readonly fetcher: typeof fetch;
  private readonly historyRepository: ConnectionHistoryRepository;
  private host: HostedCampaignSession | null = null;
  private readonly joined: JoinedCampaignConnection;
  private readonly runtimes: CampaignRuntimeRegistry;
  private readonly warn: (message: string, error?: unknown) => void;

  constructor({
    assetCacheRoot = path.join(
      tmpdir(),
      'blackboxvtt-asset-cache',
      String(process.pid),
    ),
    fetcher = fetch,
    historyRepository,
    runtimes,
    warn = console.warn,
  }: NetworkManagerOptions) {
    super();
    this.fetcher = fetcher;
    this.historyRepository = historyRepository;
    this.runtimes = runtimes;
    this.warn = warn;
    this.joined = new JoinedCampaignConnection({
      assetCacheRoot: path.resolve(assetCacheRoot),
      events: {
        onAssetError: (event) => this.emit('asset-error', event),
        onAssetsChanged: (event) => this.emit('assets-changed', event),
        onAssetProgress: (event) => this.emit('asset-progress', event),
        onChatEvent: (event) => this.emit('chat-event', event),
        onClientStateChanged: (event) =>
          this.emit('client-state-changed', event),
        onDrawingPreview: (event) =>
          this.emit('drawing-preview', event),
        onMapPing: (event) => this.emit('map-ping', event),
        onJournalChanged: (event) => this.emit('journal-changed', event),
        onMeasurementUpdate: (event) =>
          this.emit('measurement-update', event),
        onShapePreview: (event) =>
          this.emit('shape-preview', event),
        onScenePresented: (campaignId) =>
          this.emit('scene-presented', { campaignId }),
        onSessionClosed: (event) => this.emit('session-closed', event),
      },
      historyRepository,
      runtimes,
    });
  }

  async openHost(campaignId: string): Promise<NetworkResult<HostStatus>> {
    await this.stopHost();
    const workspace = await this.runtimes.getLocalWorkspace(campaignId);
    if (!workspace) {
      return failure('campaign_not_found', 'Campaign could not be found.');
    }

    try {
      const host = await HostedCampaignSession.open({
        events: {
          onAssetError: (event) => this.emit('asset-error', event),
          onChatEvent: (event) => this.emit('chat-event', event),
          onDrawingPreview: (event) =>
            this.emit('drawing-preview', event),
          onMapPing: (event) => this.emit('map-ping', event),
          onJournalChanged: (event) => this.emit('journal-changed', event),
          onMeasurementUpdate: (event) =>
            this.emit('measurement-update', event),
          onShapePreview: (event) =>
            this.emit('shape-preview', event),
          onScenePresented: (activeCampaignId) =>
            this.emit('scene-presented', {
              campaignId: activeCampaignId,
            }),
          onStatusChanged: (status) =>
            this.emit('host-status-changed', status),
          onTransformCancelled: (event) =>
            this.emit('transform-cancelled', event),
          onTransformPreview: (event) =>
            this.emit('transform-preview', event),
          onTransformStarted: (event) =>
            this.emit('transform-started', event),
        },
        fetcher: this.fetcher,
        warn: this.warn,
        workspace,
      });
      this.host = host;
      const status = host.status;
      this.configuredPort = status.effectivePort;
      return { ok: true, value: status };
    } catch (error) {
      this.warn('Campaign host could not be initialized.', error);
      return failure('storage_error', 'Campaign server could not be initialized.');
    }
  }

  async stopHost(): Promise<void> {
    const host = this.host;
    this.host = null;
    if (host) {
      await host.stop();
      this.emit('campaign-closed', { campaignId: host.campaignId });
    }
    this.emitHostStatus();
  }

  async stopHostForCampaign(campaignId: string): Promise<void> {
    if (this.hostFor(campaignId)) {
      await this.stopHost();
    }
    await this.runtimes.closeLocal(campaignId);
  }

  getHostStatus(): HostStatus {
    return (
      this.host?.status ?? {
        boundFamilies: [],
        certificateFingerprint: null,
        connectedPlayerCount: 0,
        effectivePort: this.configuredPort,
        localAddresses: [],
        publicAddresses: [],
        state: 'offline',
      }
    );
  }

  async retryHostNow(): Promise<void> {
    await this.host?.retryNow();
  }

  async getServerSettings(
    campaignId: string,
  ): Promise<NetworkResult<ServerSettingsView>> {
    const host = this.hostFor(campaignId);
    return host
      ? host.getServerSettings()
      : failure('campaign_not_found', 'Campaign could not be found.');
  }

  async setPort(input: SetServerPortInput): Promise<NetworkResult<number>> {
    const host = this.hostFor(input.campaignId);
    if (!host) {
      return failure('campaign_not_found', 'Campaign could not be found.');
    }
    const result = await host.setPort(input.port);
    if (result.ok) {
      this.configuredPort = result.value;
    }
    return result;
  }

  async setTransformPreviewRate(
    input: SetTransformPreviewRateInput,
  ): Promise<NetworkResult<number>> {
    const host = this.hostFor(input.campaignId);
    return host
      ? host.setTransformPreviewRate(input.transformPreviewRate)
      : failure('campaign_not_found', 'Campaign could not be found.');
  }

  async setMaxChatMessageCharacters(
    input: SetMaxChatMessageCharactersInput,
  ): Promise<NetworkResult<number>> {
    const host = this.hostFor(input.campaignId);
    return host
      ? host.setMaxChatMessageCharacters(input.maxMessageCharacters)
      : fail({
          code: 'permission_denied',
          message: 'Only Game Master can change chat settings.',
        });
  }

  async createUser(
    input: CreateManagedUserInput,
  ): Promise<NetworkResult<ManagedUserView>> {
    const host = this.hostFor(input.campaignId);
    return host
      ? host.createUser(input)
      : failure('campaign_not_found', 'Campaign could not be found.');
  }

  async updateUsername(
    input: UpdateManagedUsernameInput,
  ): Promise<NetworkResult<ManagedUserView>> {
    const host = this.hostFor(input.campaignId);
    return host
      ? host.updateUsername(input.userId, input.username)
      : failure('campaign_not_found', 'Campaign could not be found.');
  }

  resetPassword(
    input: ResetManagedPasswordInput,
  ): Promise<NetworkResult<null>> {
    const host = this.hostFor(input.campaignId);
    return host
      ? host.resetPassword(input.userId, input.password)
      : Promise.resolve(
          failure('campaign_not_found', 'Campaign could not be found.'),
        );
  }

  async deleteUser(
    input: DeleteManagedUserInput,
  ): Promise<NetworkResult<null>> {
    const host = this.hostFor(input.campaignId);
    return host
      ? host.deleteUser(input.userId)
      : failure('campaign_not_found', 'Campaign could not be found.');
  }

  connect(input: ConnectInput): Promise<NetworkResult<ConnectStep>> {
    return this.joined.connect(input);
  }

  acceptTrust(
    input: AcceptTrustInput,
  ): Promise<NetworkResult<AuthenticationChallenge>> {
    return this.joined.acceptTrust(input);
  }

  authenticate(
    input: AuthenticateInput,
  ): Promise<NetworkResult<RemotePlaySession>> {
    return this.joined.authenticate(input);
  }

  cancelConnection(attemptId?: string): Promise<void> {
    return this.joined.cancel(attemptId);
  }

  async disconnect(): Promise<void> {
    const campaignId = this.joined.session?.campaignId;
    await this.joined.disconnect();
    if (campaignId) this.emit('campaign-closed', { campaignId });
  }

  listHistory(): Promise<NetworkResult<SavedConnection[]>> {
    return this.historyRepository.list();
  }

  async deleteHistory(input: DeleteHistoryInput): Promise<NetworkResult<null>> {
    const result = await this.historyRepository.delete(input.campaignId);
    if (result.ok) {
      await this.joined.clearCachedCampaign(input.campaignId);
    }
    return result;
  }

  async getChatBootstrap(
    campaignId: string,
  ): Promise<ChatResult<ChatBootstrap>> {
    const session = this.sessionFor(campaignId);
    return session
      ? session.getChatBootstrap()
      : this.inactiveChat();
  }

  async getChatHistory(
    input: ChatHistoryInput,
  ): Promise<ChatResult<ChatHistoryPage>> {
    const session = this.sessionFor(input.campaignId);
    return session
      ? session.getChatHistory({
          direction: input.direction,
          generation: input.generation,
          sequence: input.sequence,
        })
      : this.inactiveChat();
  }

  async sendChatMessage(
    input: SendChatMessageInput,
  ): Promise<ChatResult<ChatMessage>> {
    const session = this.sessionFor(input.campaignId);
    return session
      ? session.sendChatMessage({
          clientMessageId: input.clientMessageId,
          content: input.content,
          recipient: input.recipient,
        })
      : this.inactiveChat();
  }

  async sendChatRoll(input: SendChatRollInput): Promise<ChatResult<ChatMessage>> {
    const session = this.sessionFor(input.campaignId);
    if (!session) {
      return this.inactiveChat();
    }
    const result = await session.sendChatRoll({
      clientMessageId: input.clientMessageId,
      definition: input.definition,
      recipient: input.recipient,
    });
    if (result.ok) {
      // TCP broadcasts intentionally exclude their sender. Chat's composer can
      // merge the response itself, but character actions submit through the
      // same API without owning Chat state, so surface the acknowledged card
      // through the normal local event stream as well. Consumers merge by ID.
      this.emit('chat-event', {
        campaignId: input.campaignId,
        message: result.value,
        type: 'message',
      });
    }
    return result;
  }

  async clearChatHistory(
    campaignId: string,
  ): Promise<ChatResult<ClearChatHistoryResult>> {
    const session = this.sessionFor(campaignId);
    return session
      ? session.clearChatHistory()
      : fail({
          code: 'permission_denied',
          message: 'Only Game Master can clear chat history.',
        });
  }

  async notifyAssetsChanged(campaignId: string): Promise<void> {
    await this.hostFor(campaignId)?.notifyAssetsChanged();
  }

  async notifyScenePresented(campaignId: string): Promise<void> {
    await this.hostFor(campaignId)?.notifyScenePresented();
  }

  async notifyJournalChanged(event: {
    campaignId: string;
    entryId?: string;
    pageId?: string;
    type: 'content' | 'deleted' | 'permissions' | 'structure';
  }): Promise<void> {
    await this.hostFor(event.campaignId)?.notifyJournalChanged(event);
  }

  async sendMapPing(input: MapPing): Promise<void> {
    await this.sessionFor(input.campaignId)?.sendMapPing({
      id: input.id,
      pullPlayers: input.pullPlayers,
      sceneId: input.sceneId,
      x: input.x,
      y: input.y,
    });
  }

  async sendMeasurementUpdate(input: MeasurementUpdate): Promise<void> {
    await this.sessionFor(input.campaignId)?.sendMeasurementUpdate({
      active: input.active,
      measurementId: input.measurementId,
      points: input.points,
      sceneId: input.sceneId,
      updateSequence: input.updateSequence,
    });
  }

  async sendDrawingPreview(input: DrawingPreviewUpdate): Promise<void> {
    await this.sessionFor(input.campaignId)?.sendDrawingPreview({
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
  }

  async sendShapePreview(input: ShapePreviewUpdate): Promise<void> {
    await this.sessionFor(input.campaignId)?.sendShapePreview({
      layer: input.layer,
      operationId: input.operationId,
      phase: input.phase,
      ...(input.reliable ? { reliable: true } : {}),
      sceneId: input.sceneId,
      sequence: input.sequence,
      shape: input.shape,
    });
  }

  async notifyTransformStarted(
    input: SceneTransformPreviewStart,
  ): Promise<void> {
    await this.hostFor(input.campaignId)?.notifyTransformStarted(input);
  }

  async notifyTransformPreview(
    input: SceneTransformPreviewDelta,
  ): Promise<void> {
    this.hostFor(input.campaignId)?.notifyTransformPreview(input);
  }

  async notifyTransformCancelled(
    input: SceneTransformPreviewCancel,
  ): Promise<void> {
    this.hostFor(input.campaignId)?.notifyTransformCancelled(input);
  }

  async shutdown(): Promise<void> {
    await Promise.all([this.stopHost(), this.disconnect()]);
    await this.runtimes.closeAll();
    this.historyRepository.close();
  }

  private sessionFor(campaignId: string): CampaignNetworkSession | null {
    const joined = this.joined.session;
    if (joined?.campaignId === campaignId) {
      return joined;
    }
    return this.hostFor(campaignId);
  }

  private hostFor(campaignId: string): HostedCampaignSession | null {
    return this.host?.campaignId === campaignId ? this.host : null;
  }

  private inactiveChat<T>(): ChatResult<T> {
    return fail({
      code: 'permission_denied',
      message: 'Campaign chat is not active.',
    });
  }

  private emitHostStatus(): void {
    this.emit('host-status-changed', this.getHostStatus());
  }
}
