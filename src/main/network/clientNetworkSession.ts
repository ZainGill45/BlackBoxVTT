import type { AssetNetworkSnapshot } from '../../shared/assets';
import type { ChatEvent } from '../../shared/chat';
import type {
  ClientConnectionState,
  DrawingPreviewEvent,
  DrawingPreviewUpdate,
  FogBrushPreviewEvent,
  MapPing,
  MeasurementEvent,
  MeasurementUpdate,
  NetworkErrorCode,
  ShapePreviewEvent,
  ShapePreviewUpdate,
} from '../../shared/network';
import type {
  SceneRecord,
  SceneTransformPreviewCancel,
  SceneTransformPreviewDelta,
  SceneTransformPreviewStart,
} from '../../shared/scenes';
import { parsePayload, type ProtocolMessageType, type TcpEnvelope } from './tcpProtocol';
import { TcpClientChannel } from './tcpClientChannel';
import {
  decodeUdpPacket,
  deserializeUdpCredentials,
  encodeUdpPacket,
  udpMessageTypes,
} from './udpProtocol';
import { associateUdp, type AssociatedUdp } from './udpAssociation';
import {
  decodeServerMeasurement,
  encodeClientMeasurement,
} from './measurementProtocol';
import { LatestSnapshotRateLimiter } from './latestSnapshotRateLimiter';
import {
  decodeServerDrawingPreview,
  decodeServerFogPreview,
  decodeServerShapePreview,
  decodeTransformPreview,
  encodeClientDrawingPreview,
  encodeClientShapePreview,
  encodeTransformPreview,
} from './sceneRealtimeProtocol';

const UDP_HEARTBEAT_INTERVAL_MS = 5_000;
const UDP_RECOVERY_THRESHOLD_MS = 15_000;
const UDP_RECOVERY_LIMIT_MS = 60_000;

type InteractivePreview =
  | {
      input: Omit<DrawingPreviewUpdate, 'campaignId'>;
      kind: 'drawing';
    }
  | {
      input: Omit<MeasurementUpdate, 'campaignId'>;
      kind: 'measurement';
    }
  | {
      input: Omit<ShapePreviewUpdate, 'campaignId'>;
      kind: 'shape';
    }
  | {
      input: Omit<SceneTransformPreviewDelta, 'campaignId'>;
      kind: 'transform';
    };

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

interface ClientNetworkSessionOptions {
  campaignId: string;
  channel: TcpClientChannel;
  onChatEvent?: (event: ChatEvent) => void;
  onAssetsChanged: (snapshot: AssetNetworkSnapshot) => void;
  onClosed: (code: NetworkErrorCode, message: string) => void;
  onDrawingPreview?: (
    input: Omit<DrawingPreviewEvent, 'campaignId'>
  ) => void;
  onMapPing?: (input: Omit<MapPing, 'campaignId'>) => void;
  onMeasurementUpdate?: (
    input: Omit<MeasurementEvent, 'campaignId'>
  ) => void;
  onScenePresented: (scene: SceneRecord | null) => void;
  onShapePreview?: (
    input: Omit<ShapePreviewEvent, 'campaignId'>
  ) => void;
  onFogPreview?: (
    input: Omit<FogBrushPreviewEvent, 'campaignId'>
  ) => void;
  onTransformCancelled?: (input: Omit<SceneTransformPreviewCancel, 'campaignId'>) => void;
  onTransformPreview?: (input: Omit<SceneTransformPreviewDelta, 'campaignId'>) => void;
  onTransformStarted?: (input: Omit<SceneTransformPreviewStart, 'campaignId'>) => void;
  onStateChanged: (state: ClientConnectionState) => void;
  port: number;
  udp: AssociatedUdp;
  updateRate: number;
}

export class ClientNetworkSession {
  private readonly campaignId: string;
  private closed = false;
  private readonly channel: TcpClientChannel;
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onClosed: ClientNetworkSessionOptions['onClosed'];
  private readonly onDrawingPreview: NonNullable<
    ClientNetworkSessionOptions['onDrawingPreview']
  >;
  private readonly onFogPreview: NonNullable<
    ClientNetworkSessionOptions['onFogPreview']
  >;
  private readonly onChatEvent: NonNullable<
    ClientNetworkSessionOptions['onChatEvent']
  >;
  private readonly onAssetsChanged: ClientNetworkSessionOptions['onAssetsChanged'];
  private readonly onMapPing: NonNullable<ClientNetworkSessionOptions['onMapPing']>;
  private readonly onMeasurementUpdate: NonNullable<
    ClientNetworkSessionOptions['onMeasurementUpdate']
  >;
  private readonly onScenePresented: ClientNetworkSessionOptions['onScenePresented'];
  private readonly onShapePreview: NonNullable<
    ClientNetworkSessionOptions['onShapePreview']
  >;
  private readonly onStateChanged: ClientNetworkSessionOptions['onStateChanged'];
  private readonly onTransformCancelled: NonNullable<ClientNetworkSessionOptions['onTransformCancelled']>;
  private readonly onTransformPreview: NonNullable<ClientNetworkSessionOptions['onTransformPreview']>;
  private readonly onTransformStarted: NonNullable<ClientNetworkSessionOptions['onTransformStarted']>;
  private readonly port: number;
  private recovering: Promise<void> | null = null;
  private readonly remoteMeasurements = new Map<
    string,
    Omit<MeasurementEvent, 'campaignId'>
  >();
  private readonly remoteMeasurementSequences = new Map<string, number>();
  private readonly remoteDrawingSequences = new Map<
    string,
    Omit<DrawingPreviewEvent, 'campaignId'>
  >();
  private readonly remoteFogSequences = new Map<
    string,
    Omit<FogBrushPreviewEvent, 'campaignId'>
  >();
  private readonly remoteShapeSequences = new Map<
    string,
    Omit<ShapePreviewEvent, 'campaignId'>
  >();
  private readonly cancelledShapeSequences = new Map<string, number>();
  private readonly interactiveRateLimiter: LatestSnapshotRateLimiter<
    InteractivePreview
  >;
  private udp: AssociatedUdp;
  private updateRate: number;

  constructor({
    campaignId,
    channel,
    onAssetsChanged,
    onClosed,
    onDrawingPreview = () => undefined,
    onFogPreview = () => undefined,
    onChatEvent = () => undefined,
    onMapPing = () => undefined,
    onMeasurementUpdate = () => undefined,
    onScenePresented,
    onShapePreview = () => undefined,
    onStateChanged,
    onTransformCancelled = () => undefined,
    onTransformPreview = () => undefined,
    onTransformStarted = () => undefined,
    port,
    udp,
    updateRate,
  }: ClientNetworkSessionOptions) {
    this.campaignId = campaignId;
    this.channel = channel;
    this.onAssetsChanged = onAssetsChanged;
    this.onDrawingPreview = onDrawingPreview;
    this.onFogPreview = onFogPreview;
    this.onChatEvent = onChatEvent;
    this.onMapPing = onMapPing;
    this.onMeasurementUpdate = onMeasurementUpdate;
    this.onScenePresented = onScenePresented;
    this.onShapePreview = onShapePreview;
    this.onClosed = onClosed;
    this.onStateChanged = onStateChanged;
    this.onTransformCancelled = onTransformCancelled;
    this.onTransformPreview = onTransformPreview;
    this.onTransformStarted = onTransformStarted;
    this.port = port;
    this.udp = udp;
    this.updateRate = updateRate;
    this.interactiveRateLimiter = new LatestSnapshotRateLimiter(
      () => this.updateRate,
      (preview) => {
        if (this.closed || this.recovering) {
          return;
        }
        if (preview.kind === 'measurement') {
          this.sendUdp(
            udpMessageTypes.clientMeasurement,
            encodeClientMeasurement(preview.input),
          );
        } else if (preview.kind === 'transform') {
          this.sendUdp(
            udpMessageTypes.clientTransformPreview,
            encodeTransformPreview(preview.input),
          );
        } else if (preview.kind === 'drawing') {
          this.sendUdp(
            udpMessageTypes.clientDrawingPreview,
            encodeClientDrawingPreview(preview.input),
          );
        } else {
          this.sendUdp(
            udpMessageTypes.clientShapePreview,
            encodeClientShapePreview(preview.input),
          );
        }
      },
    );
  }

  get isClosed(): boolean {
    return this.closed;
  }

  start(): void {
    this.attachUdp(this.udp);
    this.channel.on('udp-recovery-required', this.beginRecovery);
    this.channel.on('message', this.handleTcpMessage);
    for (const envelope of this.channel.drainPendingEvents()) {
      this.handleTcpMessage(envelope);
    }
    this.channel.once('closed', () => {
      if (!this.closed) {
        this.finish(
          'transport_lost',
          'The connection to the campaign was lost.',
        );
      }
    });
    this.maintenanceTimer = setInterval(() => {
      const now = Date.now();
      if (
        !this.recovering &&
        now - this.udp.lastReceivedAt > UDP_RECOVERY_THRESHOLD_MS
      ) {
        this.beginRecovery();
        return;
      }

      if (!this.recovering) {
        this.sendUdp(udpMessageTypes.heartbeat);
      }
    }, UDP_HEARTBEAT_INTERVAL_MS);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.interactiveRateLimiter.clear();
    this.clearRemoteDrawings();
    this.clearRemoteFog();
    this.clearRemoteMeasurements();
    this.clearRemoteShapes();
    this.channel.off('udp-recovery-required', this.beginRecovery);
    this.channel.off('message', this.handleTcpMessage);
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
    this.udp.socket.close();
    this.channel.close();
  }

  request(
    type: ProtocolMessageType,
    payload: unknown,
    responseTypes: string[],
    timeout?: number,
  ): Promise<TcpEnvelope> {
    return this.channel.request(type, payload, responseTypes, timeout);
  }

  send(type: ProtocolMessageType, payload: unknown): void {
    this.channel.send(type, payload);
  }

  sendMeasurementUpdate(
    input: Omit<MeasurementUpdate, 'campaignId'>,
  ): void {
    if (this.closed || this.recovering) {
      return;
    }
    this.interactiveRateLimiter.push({
      input: {
        ...input,
        points: input.points.map((point) => ({ ...point })),
      },
      kind: 'measurement',
    });
  }

  sendDrawingPreview(
    input: Omit<DrawingPreviewUpdate, 'campaignId'>,
  ): void {
    if (this.closed || this.recovering) {
      return;
    }
    this.interactiveRateLimiter.push({
      input: structuredClone(input),
      kind: 'drawing',
    });
  }

  sendShapePreview(
    input: Omit<ShapePreviewUpdate, 'campaignId'>,
  ): void {
    if (this.closed || this.recovering) {
      return;
    }
    this.interactiveRateLimiter.push({
      input: structuredClone(input),
      kind: 'shape',
    });
  }

  dropPendingShapePreview(operationId: string): void {
    this.interactiveRateLimiter.drop(
      (preview) =>
        preview.kind === 'shape' &&
        preview.input.operationId === operationId,
    );
  }

  sendTransformPreview(
    input: Omit<SceneTransformPreviewDelta, 'campaignId'>,
  ): void {
    if (this.closed || this.recovering) {
      return;
    }
    this.interactiveRateLimiter.push({
      input: structuredClone(input),
      kind: 'transform',
    });
  }

  private readonly handleTcpMessage = (envelope: TcpEnvelope) => {
    if (envelope.type === 'server.chat_message') {
      this.onChatEvent({
        campaignId: this.campaignId,
        message: parsePayload('server.chat_message', envelope.payload),
        type: 'message',
      });
    } else if (envelope.type === 'server.chat_history_cleared') {
      this.onChatEvent({
        campaignId: this.campaignId,
        ...parsePayload(
          'server.chat_history_cleared',
          envelope.payload,
        ),
        type: 'history_cleared',
      });
    } else if (envelope.type === 'server.chat_directory_changed') {
      this.onChatEvent({
        campaignId: this.campaignId,
        ...parsePayload(
          'server.chat_directory_changed',
          envelope.payload,
        ),
        type: 'directory_changed',
      });
    } else if (envelope.type === 'server.chat_limit_changed') {
      this.onChatEvent({
        campaignId: this.campaignId,
        ...parsePayload(
          'server.chat_limit_changed',
          envelope.payload,
        ),
        type: 'limit_changed',
      });
    } else if (envelope.type === 'server.chat_participant_event') {
      this.onChatEvent({
        campaignId: this.campaignId,
        ...parsePayload(
          'server.chat_participant_event',
          envelope.payload,
        ),
      });
    } else if (envelope.type === 'server.assets_changed') {
      this.onAssetsChanged(
        parsePayload('server.assets_changed', envelope.payload),
      );
    } else if (envelope.type === 'server.map_ping') {
      this.onMapPing(parsePayload('server.map_ping', envelope.payload));
    } else if (envelope.type === 'server.scene_presented') {
      this.clearRemoteMeasurements();
      this.clearRemoteDrawings();
      this.clearRemoteFog();
      this.clearRemoteShapes();
      this.onScenePresented(
        parsePayload('server.scene_presented', envelope.payload).scene,
      );
    } else if (envelope.type === 'server.scene_drawing_preview') {
      this.onDrawingPreview(
        parsePayload('server.scene_drawing_preview', envelope.payload),
      );
    } else if (envelope.type === 'server.scene_shape_preview') {
      this.receiveShapePreview(
        parsePayload('server.scene_shape_preview', envelope.payload),
      );
    } else if (envelope.type === 'server.update_rate_changed') {
      this.updateRate = parsePayload(
        'server.update_rate_changed',
        envelope.payload,
      ).updateRate;
      this.interactiveRateLimiter.rateChanged();
    } else if (envelope.type === 'server.scene_transform_started') {
      this.onTransformStarted(
        parsePayload('server.scene_transform_started', envelope.payload),
      );
    } else if (envelope.type === 'server.scene_transform_cancelled') {
      this.onTransformCancelled(
        parsePayload('server.scene_transform_cancelled', envelope.payload),
      );
    }
  };

  private attachUdp(udp: AssociatedUdp): void {
    udp.socket.on('message', (packet: Buffer) => {
      try {
        const decoded = decodeUdpPacket(
          packet,
          udp.credentials.serverToClient,
        );
        if (
          decoded.epoch !== udp.credentials.epoch ||
          !decoded.sessionId.equals(udp.credentials.sessionId) ||
          !udp.replay.accept(decoded.sequence)
        ) {
          return;
        }
        udp.lastReceivedAt = Date.now();
        if (decoded.type === udpMessageTypes.heartbeat) {
          if (decoded.payload.length !== 0) {
            return;
          }
          this.sendUdp(udpMessageTypes.heartbeatAcknowledge);
        } else if (
          decoded.type === udpMessageTypes.transformPreview &&
          !this.recovering
        ) {
          this.onTransformPreview(decodeTransformPreview(decoded.payload));
        } else if (
          decoded.type === udpMessageTypes.serverDrawingPreview &&
          !this.recovering
        ) {
          const preview = decodeServerDrawingPreview(decoded.payload);
          const key = `${preview.sourceId}:${preview.operationId}`;
          const previous = this.remoteDrawingSequences.get(key);
          if (preview.sequence <= (previous?.sequence ?? -1)) {
            return;
          }
          this.remoteDrawingSequences.set(key, preview);
          this.onDrawingPreview(preview);
          if (!preview.active) {
            this.remoteDrawingSequences.delete(key);
          }
        } else if (
          decoded.type === udpMessageTypes.serverFogPreview &&
          !this.recovering
        ) {
          const preview = decodeServerFogPreview(decoded.payload);
          const previous = this.remoteFogSequences.get(preview.operationId);
          if (preview.sequence <= (previous?.sequence ?? -1)) {
            return;
          }
          this.onFogPreview(preview);
          if (preview.active) {
            this.remoteFogSequences.set(preview.operationId, preview);
          } else {
            this.remoteFogSequences.delete(preview.operationId);
          }
        } else if (
          decoded.type === udpMessageTypes.serverMeasurement &&
          !this.recovering
        ) {
          const update = decodeServerMeasurement(decoded.payload);
          const previousSequence =
            this.remoteMeasurementSequences.get(update.sourceId) ?? -1;
          if (update.updateSequence <= previousSequence) {
            return;
          }
          this.remoteMeasurementSequences.set(
            update.sourceId,
            update.updateSequence,
          );
          this.onMeasurementUpdate(update);
          if (update.active) {
            this.remoteMeasurements.set(update.sourceId, update);
          } else {
            this.remoteMeasurements.delete(update.sourceId);
          }
        } else if (
          decoded.type === udpMessageTypes.serverShapePreview &&
          !this.recovering
        ) {
          this.receiveShapePreview(
            decodeServerShapePreview(decoded.payload),
          );
        }
      } catch {
        // Invalid datagrams are intentionally ignored.
      }
    });
    udp.socket.on('error', () => undefined);
  }

  private sendUdp(
    type: number,
    payload: Buffer<ArrayBufferLike> = Buffer.alloc(0),
  ): void {
    if (this.closed) {
      return;
    }
    const packet = encodeUdpPacket(
      this.udp.credentials.sessionId,
      this.udp.credentials.epoch,
      this.udp.sequence,
      type as Parameters<typeof encodeUdpPacket>[3],
      this.udp.credentials.clientToServer,
      payload,
    );
    this.udp.sequence += 1n;
    this.udp.socket.send(packet);
  }

  private readonly beginRecovery = () => {
    if (this.closed || this.recovering) {
      return;
    }
    this.interactiveRateLimiter.clear();
    this.clearRemoteDrawings();
    this.clearRemoteFog();
    this.clearRemoteMeasurements();
    this.clearRemoteShapes();
    this.recovering = this.recoverUdp().finally(() => {
      this.recovering = null;
    });
  };

  private async recoverUdp(): Promise<void> {
    this.onStateChanged('recovering_udp');
    const startedAt = Date.now();
    const backoffs = [1_000, 2_000, 4_000, 8_000, 10_000];
    let attemptIndex = 0;

    while (
      !this.closed &&
      Date.now() - startedAt < UDP_RECOVERY_LIMIT_MS
    ) {
      try {
        this.channel.send('client.udp_rekey', {});
        const envelope = await this.channel.waitFor(
          ['server.udp_credentials'],
          5_000,
        );
        const credentials = deserializeUdpCredentials(
          parsePayload('server.udp_credentials', envelope.payload),
        );
        const replacement = await associateUdp(
          this.channel.socket,
          this.port,
          credentials,
          5_000,
        );
        const previous = this.udp;
        this.udp = replacement;
        this.attachUdp(replacement);
        previous.socket.close();
        await this.channel.waitFor(['server.ready'], 5_000);
        this.onStateChanged('online');
        return;
      } catch {
        await delay(backoffs[Math.min(attemptIndex, backoffs.length - 1)]);
        attemptIndex += 1;
      }
    }

    if (!this.closed) {
      this.finish(
        'udp_failed',
        'The UDP connection could not be recovered.',
      );
    }
  }

  private finish(code: NetworkErrorCode, message: string): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.interactiveRateLimiter.clear();
    this.clearRemoteDrawings();
    this.clearRemoteFog();
    this.clearRemoteMeasurements();
    this.clearRemoteShapes();
    this.channel.off('udp-recovery-required', this.beginRecovery);
    this.channel.off('message', this.handleTcpMessage);
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
    try {
      this.udp.socket.close();
    } catch {
      // Socket is already closed.
    }
    this.channel.close();
    this.onClosed(code, message);
  }

  private clearRemoteMeasurements(): void {
    for (const update of this.remoteMeasurements.values()) {
      this.onMeasurementUpdate({
        ...update,
        active: false,
        points: [],
        updateSequence: Math.min(
          0xffff_ffff,
          update.updateSequence + 1,
        ),
      });
    }
    this.remoteMeasurements.clear();
    this.remoteMeasurementSequences.clear();
  }

  private clearRemoteDrawings(): void {
    for (const preview of this.remoteDrawingSequences.values()) {
      this.onDrawingPreview({
        ...preview,
        active: false,
        points: [],
        sequence: preview.sequence + 1,
      });
    }
    this.remoteDrawingSequences.clear();
  }

  private clearRemoteFog(): void {
    for (const preview of this.remoteFogSequences.values()) {
      this.onFogPreview({
        ...preview,
        active: false,
        points: [],
        sequence: Math.min(0xffff_ffff, preview.sequence + 1),
      });
    }
    this.remoteFogSequences.clear();
  }

  private receiveShapePreview(
    preview: Omit<ShapePreviewEvent, 'campaignId'>,
  ): void {
    const key = `${preview.sourceId}:${preview.operationId}`;
    const previous = this.remoteShapeSequences.get(key);
    const cancelledSequence = this.cancelledShapeSequences.get(key) ?? -1;
    if (preview.sequence <= Math.max(previous?.sequence ?? -1, cancelledSequence)) {
      return;
    }
    this.onShapePreview(preview);
    if (preview.phase === 'cancel') {
      this.remoteShapeSequences.delete(key);
      this.cancelledShapeSequences.delete(key);
      this.cancelledShapeSequences.set(key, preview.sequence);
      if (this.cancelledShapeSequences.size > 512) {
        const oldest = this.cancelledShapeSequences.keys().next().value;
        if (oldest) {
          this.cancelledShapeSequences.delete(oldest);
        }
      }
    } else {
      this.remoteShapeSequences.set(key, preview);
    }
  }

  private clearRemoteShapes(): void {
    for (const preview of this.remoteShapeSequences.values()) {
      const sequence = preview.sequence + 1;
      this.onShapePreview({
        ...preview,
        phase: 'cancel',
        sequence,
        shape: null,
      });
      const key = `${preview.sourceId}:${preview.operationId}`;
      this.cancelledShapeSequences.delete(key);
      this.cancelledShapeSequences.set(key, sequence);
    }
    this.remoteShapeSequences.clear();
  }
}
