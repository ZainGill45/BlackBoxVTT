import type { AssetNetworkSnapshot } from '../../shared/assets';
import type {
  ClientConnectionState,
  DrawingPreviewEvent,
  DrawingPreviewUpdate,
  MapPing,
  MeasurementEvent,
  MeasurementUpdate,
  NetworkErrorCode,
} from '../../shared/network';
import { MAX_DRAWING_PREVIEW_POINTS } from '../../shared/network';
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
  sceneDrawingPointSchema,
  sceneDrawingStyleSchema,
  sceneDrawingTransformSchema,
  sceneImageTransformSchema,
} from '../sceneSchema';
import {
  decodeServerMeasurement,
  encodeClientMeasurement,
} from './measurementProtocol';
import { LatestSnapshotRateLimiter } from './latestSnapshotRateLimiter';

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
      input: Omit<SceneTransformPreviewDelta, 'campaignId'>;
      kind: 'transform';
    };

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

interface ClientNetworkSessionOptions {
  channel: TcpClientChannel;
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
  onTransformCancelled?: (input: Omit<SceneTransformPreviewCancel, 'campaignId'>) => void;
  onTransformPreview?: (input: Omit<SceneTransformPreviewDelta, 'campaignId'>) => void;
  onTransformStarted?: (input: Omit<SceneTransformPreviewStart, 'campaignId'>) => void;
  onStateChanged: (state: ClientConnectionState) => void;
  port: number;
  udp: AssociatedUdp;
  updateRate: number;
}

export class ClientNetworkSession {
  private closed = false;
  private readonly channel: TcpClientChannel;
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onClosed: ClientNetworkSessionOptions['onClosed'];
  private readonly onDrawingPreview: NonNullable<
    ClientNetworkSessionOptions['onDrawingPreview']
  >;
  private readonly onAssetsChanged: ClientNetworkSessionOptions['onAssetsChanged'];
  private readonly onMapPing: NonNullable<ClientNetworkSessionOptions['onMapPing']>;
  private readonly onMeasurementUpdate: NonNullable<
    ClientNetworkSessionOptions['onMeasurementUpdate']
  >;
  private readonly onScenePresented: ClientNetworkSessionOptions['onScenePresented'];
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
  private readonly interactiveRateLimiter: LatestSnapshotRateLimiter<
    InteractivePreview
  >;
  private udp: AssociatedUdp;
  private updateRate: number;

  constructor({
    channel,
    onAssetsChanged,
    onClosed,
    onDrawingPreview = () => undefined,
    onMapPing = () => undefined,
    onMeasurementUpdate = () => undefined,
    onScenePresented,
    onStateChanged,
    onTransformCancelled = () => undefined,
    onTransformPreview = () => undefined,
    onTransformStarted = () => undefined,
    port,
    udp,
    updateRate,
  }: ClientNetworkSessionOptions) {
    this.channel = channel;
    this.onAssetsChanged = onAssetsChanged;
    this.onDrawingPreview = onDrawingPreview;
    this.onMapPing = onMapPing;
    this.onMeasurementUpdate = onMeasurementUpdate;
    this.onScenePresented = onScenePresented;
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
            Buffer.from(JSON.stringify(preview.input), 'utf8'),
          );
        } else {
          this.sendUdp(
            udpMessageTypes.clientDrawingPreview,
            Buffer.from(JSON.stringify(preview.input), 'utf8'),
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
    this.clearRemoteMeasurements();
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
    if (envelope.type === 'server.assets_changed') {
      this.onAssetsChanged(
        parsePayload('server.assets_changed', envelope.payload),
      );
    } else if (envelope.type === 'server.map_ping') {
      this.onMapPing(parsePayload('server.map_ping', envelope.payload));
    } else if (envelope.type === 'server.scene_presented') {
      this.clearRemoteMeasurements();
      this.clearRemoteDrawings();
      this.onScenePresented(
        parsePayload('server.scene_presented', envelope.payload).scene,
      );
    } else if (envelope.type === 'server.scene_drawing_preview') {
      this.onDrawingPreview(
        parsePayload('server.scene_drawing_preview', envelope.payload),
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
          const value = JSON.parse(decoded.payload.toString('utf8')) as Record<string, unknown>;
          const absolute =
            value.absolute === undefined
              ? null
              : sceneImageTransformSchema
                  .or(sceneDrawingTransformSchema)
                  .safeParse(value.absolute);
          if (
            typeof value.operationId === 'string' &&
            (absolute === null || absolute.success) &&
            ['dx', 'dy', 'rotation', 'scaleX', 'scaleY'].every(
              (key) => typeof value[key] === 'number' && Number.isFinite(value[key]),
            ) &&
            (value.scaleX as number) > 0 &&
            (value.scaleY as number) > 0
          ) {
            this.onTransformPreview(
              {
                ...(absolute?.success ? { absolute: absolute.data } : {}),
                dx: value.dx as number,
                dy: value.dy as number,
                operationId: value.operationId,
                rotation: value.rotation as number,
                scaleX: value.scaleX as number,
                scaleY: value.scaleY as number,
              },
            );
          }
        } else if (
          decoded.type === udpMessageTypes.serverDrawingPreview &&
          !this.recovering
        ) {
          const value = JSON.parse(
            decoded.payload.toString('utf8'),
          ) as Record<string, unknown>;
          const points = Array.isArray(value.points)
            ? value.points
                .map((point) => sceneDrawingPointSchema.safeParse(point))
                .filter((result) => result.success)
                .map((result) => result.data)
            : [];
          const style = sceneDrawingStyleSchema.safeParse(value.style);
          if (
            typeof value.active === 'boolean' &&
            typeof value.closed === 'boolean' &&
            (value.kind === 'freeform' || value.kind === 'polyline') &&
            (value.layer === 'map' || value.layer === 'token') &&
            typeof value.operationId === 'string' &&
            typeof value.sceneId === 'string' &&
            typeof value.sourceId === 'string' &&
            typeof value.sequence === 'number' &&
            Number.isInteger(value.sequence) &&
            value.sequence >= 0 &&
            points.length <= MAX_DRAWING_PREVIEW_POINTS &&
            style.success &&
            ((value.active && points.length > 0) ||
              (!value.active && points.length === 0))
          ) {
            const key = `${value.sourceId}:${value.operationId}`;
            const previous = this.remoteDrawingSequences.get(key);
            if (value.sequence <= (previous?.sequence ?? -1)) {
              return;
            }
            const preview = {
              active: value.active,
              closed: value.closed,
              kind: value.kind,
              layer: value.layer,
              operationId: value.operationId,
              points,
              sceneId: value.sceneId,
              sequence: value.sequence,
              sourceId: value.sourceId,
              style: style.data,
            } satisfies Omit<DrawingPreviewEvent, 'campaignId'>;
            this.remoteDrawingSequences.set(key, preview);
            this.onDrawingPreview(preview);
            if (!value.active) {
              this.remoteDrawingSequences.delete(key);
            }
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
    this.clearRemoteMeasurements();
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
    this.clearRemoteMeasurements();
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
}
