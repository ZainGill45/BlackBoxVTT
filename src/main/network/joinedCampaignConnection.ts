import type {
  ChatBootstrap,
  ChatEvent,
  ChatParticipantEvent,
  ChatResult,
} from '../../shared/chat';
import type {
  AssetChangedEvent,
  AssetErrorEvent,
  AssetProgressEvent,
} from '../../shared/assets';
import type {
  AcceptTrustInput,
  AuthenticateInput,
  AuthenticationChallenge,
  ClientStateEvent,
  ConnectInput,
  ConnectStep,
  DrawingPreviewEvent,
  FogBrushPreviewEvent,
  MapPing,
  MeasurementEvent,
  NetworkResult,
  RemotePlaySession,
  SessionClosedEvent,
  ShapePreviewEvent,
} from '../../shared/network';
import type { CampaignRuntimeRegistry } from '../campaignRuntime';
import type { CampaignNetworkSession } from './campaignNetworkSession';
import { CampaignClient } from './campaignClient';
import type { ConnectionHistoryRepository } from './connectionHistoryRepository';
import { JoinedAssetSession } from './joinedAssetSession';
import { JoinedSceneSession } from './joinedSceneSession';

export interface JoinedCampaignConnectionEvents {
  onAssetError: (event: AssetErrorEvent) => void;
  onAssetsChanged: (event: AssetChangedEvent) => void;
  onAssetProgress: (event: AssetProgressEvent) => void;
  onChatEvent: (event: ChatEvent) => void;
  onClientStateChanged: (event: ClientStateEvent) => void;
  onDrawingPreview: (event: DrawingPreviewEvent) => void;
  onFogPreview: (event: FogBrushPreviewEvent) => void;
  onMapPing: (event: MapPing) => void;
  onMeasurementUpdate: (event: MeasurementEvent) => void;
  onShapePreview: (event: ShapePreviewEvent) => void;
  onScenePresented: (campaignId: string) => void;
  onSessionClosed: (event: SessionClosedEvent) => void;
}

interface JoinedCampaignConnectionOptions {
  assetCacheRoot: string;
  events: JoinedCampaignConnectionEvents;
  historyRepository: ConnectionHistoryRepository;
  runtimes: CampaignRuntimeRegistry;
}

/** Owns connection lifecycle and composes one joined campaign's capabilities. */
export class JoinedCampaignConnection {
  private activeSession: CampaignNetworkSession | null = null;
  private readonly assets: JoinedAssetSession;
  private chatSystemEvents: ChatParticipantEvent[] = [];
  private readonly client: CampaignClient;
  private readonly events: JoinedCampaignConnectionEvents;
  private joinedCampaignId: string | null = null;
  private readonly runtimes: CampaignRuntimeRegistry;
  private readonly scenes: JoinedSceneSession;

  constructor({
    assetCacheRoot,
    events,
    historyRepository,
    runtimes,
  }: JoinedCampaignConnectionOptions) {
    this.events = events;
    this.runtimes = runtimes;
    this.client = new CampaignClient({
      historyRepository,
      onAssetsChanged: (manifest) => this.assets.handleManifest(manifest),
      onChatEvent: (event) => this.recordChatEvent(event),
      onDrawingPreview: (input) => {
        const campaignId = this.client.getSession()?.campaignId;
        if (campaignId) {
          this.events.onDrawingPreview({ ...input, campaignId });
        }
      },
      onFogPreview: (input) => {
        const campaignId = this.client.getSession()?.campaignId;
        if (campaignId) {
          this.events.onFogPreview({ ...input, campaignId });
        }
      },
      onMapPing: (input) => {
        const campaignId = this.client.getSession()?.campaignId;
        if (campaignId) {
          this.events.onMapPing({ ...input, campaignId });
        }
      },
      onMeasurementUpdate: (input) => {
        const campaignId = this.client.getSession()?.campaignId;
        if (campaignId) {
          this.events.onMeasurementUpdate({ ...input, campaignId });
        }
      },
      onShapePreview: (input) => {
        const campaignId = this.client.getSession()?.campaignId;
        if (campaignId) {
          this.events.onShapePreview({ ...input, campaignId });
        }
      },
      onScenePresented: (scene) => this.scenes.present(scene),
      onSessionClosed: (code, message) => {
        this.endSession();
        this.events.onSessionClosed({ code, message });
      },
      onStateChanged: (state) =>
        this.events.onClientStateChanged({ state }),
      onTransformCancelled: (input) =>
        this.scenes.cancelIncomingTransform(input),
      onTransformPreview: (input) => this.scenes.animateTransform(input),
      onTransformStarted: (input) => this.scenes.beginTransform(input),
    });
    this.assets = new JoinedAssetSession({
      cacheRoot: assetCacheRoot,
      client: this.client,
      events: {
        onChanged: events.onAssetsChanged,
        onError: events.onAssetError,
        onFatalFailure: (message) => {
          this.endSession();
          this.events.onSessionClosed({ code: 'storage_error', message });
        },
        onProgress: events.onAssetProgress,
      },
      historyRepository,
    });
    this.scenes = new JoinedSceneSession({
      client: this.client,
      onChanged: () => {
        const campaignId = this.client.getSession()?.campaignId;
        if (campaignId) {
          this.events.onScenePresented(campaignId);
        }
      },
    });
  }

  get session(): CampaignNetworkSession | null {
    return this.activeSession;
  }

  connect(input: ConnectInput): Promise<NetworkResult<ConnectStep>> {
    this.endSession();
    return this.client.connect(input);
  }

  acceptTrust(
    input: AcceptTrustInput,
  ): Promise<NetworkResult<AuthenticationChallenge>> {
    return this.client.acceptTrust(input.attemptId);
  }

  async authenticate(
    input: AuthenticateInput,
  ): Promise<NetworkResult<RemotePlaySession>> {
    const result = await this.client.authenticate(input);
    if (result.ok) {
      this.registerRuntime(result.value);
      this.activeSession = this.createSession(result.value.campaignId);
    }
    return result;
  }

  cancel(attemptId?: string): Promise<void> {
    return this.client.cancel(attemptId);
  }

  async disconnect(): Promise<void> {
    this.endSession();
    await this.client.disconnect();
  }

  clearCachedCampaign(campaignId: string): Promise<void> {
    return this.assets.clearCachedCampaign(campaignId);
  }

  private createSession(campaignId: string): CampaignNetworkSession {
    return {
      campaignId,
      clearChatHistory: async () => ({
        error: {
          code: 'permission_denied',
          message: 'Only Game Master can clear chat history.',
        },
        ok: false,
      }),
      getChatBootstrap: () => this.getChatBootstrap(),
      getChatHistory: (input) => this.client.getChatHistory(input),
      kind: 'joined',
      sendChatMessage: (input) => this.client.sendChatMessage(input),
      sendDrawingPreview: async (input) => {
        this.client.sendDrawingPreview(input);
      },
      sendFogPreview: async () => undefined,
      sendMapPing: async (input) => {
        this.client.sendMapPing(input);
      },
      sendMeasurementUpdate: async (input) => {
        this.client.sendMeasurementUpdate(input);
      },
      sendShapePreview: async (input) => {
        this.client.sendShapePreview(input);
      },
    };
  }

  private async getChatBootstrap(): Promise<ChatResult<ChatBootstrap>> {
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

  private registerRuntime(session: RemotePlaySession): void {
    const { campaignId, userId } = session;
    this.unregisterRuntime();
    this.joinedCampaignId = campaignId;
    this.scenes.activate(campaignId);
    this.runtimes.registerJoined({
      assets: this.assets.createTransport(campaignId, userId),
      campaignId,
      kind: 'joined',
      scenes: this.scenes.createTransport(campaignId),
    });
  }

  private unregisterRuntime(): void {
    if (this.joinedCampaignId) {
      this.runtimes.unregisterJoined(this.joinedCampaignId);
      this.joinedCampaignId = null;
    }
    this.activeSession = null;
  }

  private endSession(): void {
    this.unregisterRuntime();
    this.assets.reset();
    this.scenes.reset();
    this.chatSystemEvents = [];
  }

  private recordChatEvent(event: ChatEvent): void {
    const campaignId = this.client.getSession()?.campaignId;
    if (event.campaignId !== campaignId) {
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
    this.events.onChatEvent(event);
  }
}
