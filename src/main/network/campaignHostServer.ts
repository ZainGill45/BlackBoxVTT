import { randomUUID } from 'node:crypto';
import dgram, { type RemoteInfo, type Socket as UdpSocket } from 'node:dgram';
import { rm } from 'node:fs/promises';
import type { AddressInfo, Socket } from 'node:net';
import tls, { type Server as TlsServer, type TLSSocket } from 'node:tls';
import type {
  HostStatus,
  DrawingPreviewEvent,
  DrawingPreviewUpdate,
  ManagedUserView,
  MapPing,
  MeasurementEvent,
  MeasurementUpdate,
  NetworkResult,
} from '../../shared/network';
import {
  MAX_DRAWING_PREVIEW_POINTS,
  NETWORK_PROTOCOL_VERSION,
} from '../../shared/network';
import {
  findScene,
  projectSceneForPlayer,
  type SceneTransformPreviewCancel,
  type SceneTransformPreviewDelta,
  type SceneTransformPreviewStart,
  type SceneDrawing,
  type SceneMapImage,
  type SceneRecord,
  type SceneResult,
} from '../../shared/scenes';
import type { AssetRepository } from '../assetRepository';
import type { SceneRepository } from '../sceneRepository';
import {
  sceneDrawingPointSchema,
  sceneDrawingStyleSchema,
  sceneDrawingTransformSchema,
  sceneImageTransformSchema,
} from '../sceneSchema';
import { authenticatedAssetPolicy, type AssetPolicy } from '../assetPolicy';
import { verifyPassword } from './passwords';
import { LoginRateLimiter } from './loginRateLimiter';
import type { CampaignIdentity } from './campaignIdentity';
import {
  FrameDecoder,
  parsePayload,
  writeEnvelope,
  type TcpEnvelope,
} from './tcpProtocol';
import {
  createUdpSessionCredentials,
  decodeUdpPacket,
  encodeUdpPacket,
  ReplayWindow,
  serializeUdpCredentials,
  TokenBucket,
  udpMessageTypes,
} from './udpProtocol';
import {
  ServerConfigRepository,
  type StoredManagedUser,
} from './serverConfigRepository';
import { HostAssetTransfer } from './hostAssetTransfer';
import { actorFor, type HostClient } from './hostClient';
import {
  decodeClientMeasurement,
  encodeServerMeasurement,
} from './measurementProtocol';
import { LatestSnapshotRateLimiter } from './latestSnapshotRateLimiter';

const HANDSHAKE_TIMEOUT_MS = 60_000;
const TCP_PING_INTERVAL_MS = 10_000;
const TCP_DEAD_TIMEOUT_MS = 30_000;
const UDP_HEARTBEAT_INTERVAL_MS = 5_000;
const UDP_RECOVERY_THRESHOLD_MS = 15_000;
const UDP_DEAD_TIMEOUT_MS = 60_000;
const MAX_PENDING_CONNECTIONS = 64;
const MAP_PING_COOLDOWN_MS = 500;
const MEASUREMENT_EXPIRY_MS = 1_500;


interface ListenerGroup {
  activate: () => void;
  boundFamilies: Array<'IPv4' | 'IPv6'>;
  port: number;
  tcp: TlsServer[];
  udp: Partial<Record<'IPv4' | 'IPv6', UdpSocket>>;
}

interface CampaignHostServerOptions {
  assetRepository: AssetRepository;
  assetPolicy?: AssetPolicy;
  campaignId: string;
  campaignName: string;
  configRepository: ServerConfigRepository;
  identity: CampaignIdentity;
  onMapPing?: (input: MapPing) => void;
  onDrawingPreview?: (input: DrawingPreviewEvent) => void;
  onMeasurementUpdate?: (input: MeasurementEvent) => void;
  onSceneChanged?: () => void;
  onTransformCancelled?: (input: SceneTransformPreviewCancel) => void;
  onTransformPreview?: (input: SceneTransformPreviewDelta) => void;
  onTransformStarted?: (input: SceneTransformPreviewStart) => void;
  onStatusChanged: () => void;
  transformPreviewRate?: number;
  onAssetSyncError?: (
    playerName: string,
    assetName: string,
    reason: string,
  ) => void;
  sceneRepository: SceneRepository;
  warn?: (message: string, error?: unknown) => void;
}

function normalizeRemoteAddress(address?: string): string {
  if (!address) {
    return 'unknown';
  }
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

function objectTransform(object: SceneMapImage | SceneDrawing) {
  if ('points' in object) {
    return {
      rotation: object.rotation,
      scaleX: object.scaleX,
      scaleY: object.scaleY,
      x: object.x,
      y: object.y,
    };
  }
  return {
    height: object.height,
    rotation: object.rotation,
    width: object.width,
    x: object.x,
    y: object.y,
  };
}

function closeTcpServer(server: TlsServer): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function closeUdpSocket(socket: UdpSocket): Promise<void> {
  return new Promise((resolve) => {
    try {
      socket.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

export class CampaignHostServer {
  private readonly activeTransformOperations = new Set<string>();
  private activeScene: SceneRecord | null = null;
  private readonly activeMeasurements = new Map<
    string,
    { lastAt: number; update: MeasurementEvent }
  >();
  private readonly measurementRelaySequences = new Map<string, number>();
  private readonly measurementRateLimiters = new Map<
    string,
    LatestSnapshotRateLimiter<{
      input: MeasurementEvent;
      source?: HostClient;
    }>
  >();
  private readonly cancelledTransformOperations = new Set<string>();
  private lastBroadcastSceneSignature: string | null | undefined;
  readonly assetRepository: AssetRepository;
  private readonly assetPolicy: AssetPolicy;
  private readonly assetTransfer: HostAssetTransfer;
  readonly campaignId: string;
  readonly campaignName: string;
  readonly configRepository: ServerConfigRepository;
  readonly identity: CampaignIdentity;
  private readonly clients = new Set<HostClient>();
  private readonly claimedUsers = new Map<string, HostClient>();
  private listener: ListenerGroup | null = null;
  private readonly loginRateLimiter = new LoginRateLimiter();
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private lastHostMapPingAt = 0;
  private readonly lastTransformPreviewAt = new Map<string, number>();
  private readonly onMapPing: NonNullable<
    CampaignHostServerOptions['onMapPing']
  >;
  private readonly onDrawingPreview: NonNullable<
    CampaignHostServerOptions['onDrawingPreview']
  >;
  private readonly onMeasurementUpdate: NonNullable<
    CampaignHostServerOptions['onMeasurementUpdate']
  >;
  private readonly onSceneChanged: NonNullable<
    CampaignHostServerOptions['onSceneChanged']
  >;
  private readonly onStatusChanged: () => void;
  private readonly onAssetSyncError: NonNullable<
    CampaignHostServerOptions['onAssetSyncError']
  >;
  private readonly onTransformCancelled: NonNullable<
    CampaignHostServerOptions['onTransformCancelled']
  >;
  private readonly onTransformPreview: NonNullable<
    CampaignHostServerOptions['onTransformPreview']
  >;
  private readonly onTransformStarted: NonNullable<
    CampaignHostServerOptions['onTransformStarted']
  >;
  readonly sceneRepository: SceneRepository;
  private readonly sessionsById = new Map<string, HostClient>();
  private transformPreviewRate: number;
  private readonly transformSources = new Map<string, HostClient | null>();
  private readonly warn: (message: string, error?: unknown) => void;

  constructor({
    assetRepository,
    assetPolicy = authenticatedAssetPolicy,
    campaignId,
    campaignName,
    configRepository,
    identity,
    onAssetSyncError = () => undefined,
    onMapPing = () => undefined,
    onDrawingPreview = () => undefined,
    onMeasurementUpdate = () => undefined,
    onSceneChanged = () => undefined,
    onStatusChanged,
    onTransformCancelled = () => undefined,
    onTransformPreview = () => undefined,
    onTransformStarted = () => undefined,
    sceneRepository,
    transformPreviewRate = 60,
    warn = console.warn,
  }: CampaignHostServerOptions) {
    this.assetRepository = assetRepository;
    this.sceneRepository = sceneRepository;
    this.assetPolicy = assetPolicy;
    this.campaignId = campaignId;
    this.campaignName = campaignName;
    this.configRepository = configRepository;
    this.identity = identity;
    this.onAssetSyncError = onAssetSyncError;
    this.onMapPing = onMapPing;
    this.onDrawingPreview = onDrawingPreview;
    this.onMeasurementUpdate = onMeasurementUpdate;
    this.onSceneChanged = onSceneChanged;
    this.onStatusChanged = onStatusChanged;
    this.onTransformCancelled = onTransformCancelled;
    this.onTransformPreview = onTransformPreview;
    this.onTransformStarted = onTransformStarted;
    this.transformPreviewRate = transformPreviewRate;
    this.warn = warn;
    this.assetTransfer = new HostAssetTransfer({
      assetPolicy,
      assetRepository,
      broadcastAssetsChanged: () => this.broadcastAssetsChanged(),
      onAssetSyncError,
    });
  }

  get isOnline(): boolean {
    return this.listener !== null;
  }

  setTransformPreviewRate(rate: number): void {
    this.transformPreviewRate = rate;
    for (const limiter of this.measurementRateLimiters.values()) {
      limiter.rateChanged();
    }
    for (const client of this.clients) {
      client.interactiveRateBucket = new TokenBucket(rate, rate * 2);
      if (client.state === 'ready' && client.user) {
        writeEnvelope(
          client.socket as unknown as Socket,
          'server.update_rate_changed',
          { updateRate: rate },
        );
      }
    }
  }

  async broadcastMapPing(
    input: MapPing,
    source?: HostClient,
  ): Promise<void> {
    if (input.campaignId !== this.campaignId) {
      return;
    }
    const scene = await this.readActiveScene();
    if (
      !scene ||
      scene.id !== input.sceneId ||
      input.x < 0 ||
      input.x > scene.width ||
      input.y < 0 ||
      input.y > scene.height
    ) {
      return;
    }
    const now = Date.now();
    const lastAt = source ? source.lastMapPingAt : this.lastHostMapPingAt;
    if (now - lastAt < MAP_PING_COOLDOWN_MS) {
      return;
    }
    if (source) {
      source.lastMapPingAt = now;
    } else {
      this.lastHostMapPingAt = now;
    }

    this.onMapPing(input);
    const payload = {
      id: input.id,
      pullPlayers: input.pullPlayers,
      sceneId: input.sceneId,
      x: input.x,
      y: input.y,
    };
    for (const client of this.clients) {
      if (client.state === 'ready' && client.user) {
        writeEnvelope(
          client.socket as unknown as Socket,
          'server.map_ping',
          payload,
        );
      }
    }
  }

  async broadcastDrawingPreview(
    input: DrawingPreviewUpdate,
    source: HostClient | null = null,
  ): Promise<void> {
    if (input.campaignId !== this.campaignId) {
      return;
    }
    const scene = await this.readActiveScene();
    if (!scene || scene.id !== input.sceneId) {
      return;
    }
    const layer = source?.user ? 'token' : input.layer;
    if (layer === 'gm') {
      return;
    }
    const sourceId = source?.user?.id ?? 'gm';
    const preview: DrawingPreviewEvent = {
      ...input,
      layer,
      sourceId,
    };
    if (source?.user) {
      this.onDrawingPreview(preview);
    }
    const payload = Buffer.from(
      JSON.stringify({
        active: preview.active,
        closed: preview.closed,
        kind: preview.kind,
        layer: preview.layer,
        operationId: preview.operationId,
        points: preview.points,
        sceneId: preview.sceneId,
        sequence: preview.sequence,
        sourceId: preview.sourceId,
        style: preview.style,
      }),
      'utf8',
    );
    for (const client of this.clients) {
      if (
        client !== source &&
        client.state === 'ready' &&
        client.user &&
        (preview.reliable || !client.udpRecoveryStartedAt)
      ) {
        if (preview.reliable) {
          writeEnvelope(
            client.socket as unknown as Socket,
            'server.scene_drawing_preview',
            {
              active: preview.active,
              closed: preview.closed,
              kind: preview.kind,
              layer: preview.layer,
              operationId: preview.operationId,
              points: preview.points,
              reliable: true,
              sceneId: preview.sceneId,
              sequence: preview.sequence,
              sourceId: preview.sourceId,
              style: preview.style,
            },
          );
        } else {
          this.sendUdp(
            client,
            udpMessageTypes.serverDrawingPreview,
            payload,
          );
        }
      }
    }
  }

  async broadcastMeasurementUpdate(
    input: MeasurementUpdate,
  ): Promise<void> {
    if (input.campaignId !== this.campaignId) {
      return;
    }
    const scene = this.activeScene ?? (await this.readActiveScene());
    if (!scene) {
      return;
    }
    this.acceptMeasurementUpdate(
      {
        ...input,
        sourceId: this.campaignId,
      },
      scene,
    );
  }

  private acceptMeasurementUpdate(
    input: MeasurementEvent,
    scene: SceneRecord,
    source?: HostClient,
  ): void {
    if (
      input.sceneId !== scene.id ||
      input.points.some(
        ({ x, y }) =>
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          x < 0 ||
          x > scene.width ||
          y < 0 ||
          y > scene.height,
      )
    ) {
      return;
    }
    if (
      source &&
      input.updateSequence <= source.lastMeasurementSequence
    ) {
      return;
    }
    if (source) {
      source.lastMeasurementSequence = input.updateSequence;
    }
    this.queueMeasurementRelay(input, source);
  }

  private nextMeasurementRelaySequence(sourceId: string): number {
    const next =
      ((this.measurementRelaySequences.get(sourceId) ?? 0) + 1) >>>
      0;
    this.measurementRelaySequences.set(sourceId, next);
    return next;
  }

  private queueMeasurementRelay(
    input: MeasurementEvent,
    source?: HostClient,
  ): void {
    const relayed = {
      ...input,
      updateSequence: this.nextMeasurementRelaySequence(input.sourceId),
    };
    if (relayed.active) {
      this.activeMeasurements.set(relayed.sourceId, {
        lastAt: Date.now(),
        update: relayed,
      });
    } else {
      this.activeMeasurements.delete(relayed.sourceId);
    }
    this.measurementRateLimiterFor(relayed.sourceId).push({
      input: relayed,
      ...(source ? { source } : {}),
    });
  }

  private measurementRateLimiterFor(
    sourceId: string,
  ): LatestSnapshotRateLimiter<{
    input: MeasurementEvent;
    source?: HostClient;
  }> {
    const existing = this.measurementRateLimiters.get(sourceId);
    if (existing) {
      return existing;
    }
    const limiter = new LatestSnapshotRateLimiter<{
      input: MeasurementEvent;
      source?: HostClient;
    }>(
      () => this.transformPreviewRate,
      ({ input, source }) => this.relayMeasurementUpdate(input, source),
    );
    this.measurementRateLimiters.set(sourceId, limiter);
    return limiter;
  }

  private relayMeasurementUpdate(
    input: MeasurementEvent,
    source?: HostClient,
  ): void {
    if (source) {
      this.onMeasurementUpdate(input);
    }
    const payload = encodeServerMeasurement(input);
    for (const client of this.clients) {
      if (
        client !== source &&
        client.state === 'ready' &&
        client.user &&
        !client.udpRecoveryStartedAt
      ) {
        this.sendUdp(
          client,
          udpMessageTypes.serverMeasurement,
          payload,
        );
      }
    }
  }

  private clearMeasurementSource(
    sourceId: string,
    source?: HostClient,
  ): void {
    const active = this.activeMeasurements.get(sourceId);
    if (!active) {
      return;
    }
    const scene = this.activeScene;
    if (!scene || scene.id !== active.update.sceneId) {
      this.activeMeasurements.delete(sourceId);
      return;
    }
    this.queueMeasurementRelay(
      {
        ...active.update,
        active: false,
        points: [],
      },
      source,
    );
  }

  private clearAllMeasurements(): void {
    for (const sourceId of [...this.activeMeasurements.keys()]) {
      this.clearMeasurementSource(
        sourceId,
        [...this.clients].find((client) => client.user?.id === sourceId),
      );
    }
    this.activeMeasurements.clear();
  }

  async broadcastTransformStarted(
    input: SceneTransformPreviewStart,
    source: HostClient | null = null,
  ): Promise<void> {
    const scene = await this.readActiveScene();
    if (!scene || scene.id !== input.sceneId || scene.revision !== input.revision) {
      return;
    }
    const publicTargets = new Map<string, SceneMapImage | SceneDrawing>(
      [
        ...(scene.mapImage
          ? [['canonical-map', scene.mapImage] as const]
          : []),
        ...scene.images.map.map(
          (image) => [image.id, image] as const,
        ),
        ...scene.images.token.map(
          (image) => [image.id, image] as const,
        ),
        ...scene.drawings.map.map(
          (drawing) => [drawing.id, drawing] as const,
        ),
        ...scene.drawings.token.map(
          (drawing) => [drawing.id, drawing] as const,
        ),
      ],
    );
    const targets = [...new Set(input.targets)].filter((id) =>
      publicTargets.has(id),
    );
    if (targets.length === 0) {
      return;
    }
    const startingTransforms = targets.map((id) => {
      const image = publicTargets.get(id)!;
      return {
        id,
        transform: objectTransform(image),
      };
    });
    if (this.cancelledTransformOperations.delete(input.operationId)) {
      return;
    }
    this.activeTransformOperations.add(input.operationId);
    this.transformSources.set(input.operationId, source);
    const started = {
      kind: input.kind,
      operationId: input.operationId,
      pivotX: input.pivotX,
      pivotY: input.pivotY,
      revision: input.revision,
      sceneId: input.sceneId,
      startingTransforms,
      targets,
    };
    if (source?.user) {
      this.onTransformStarted({ ...started, campaignId: input.campaignId });
    }
    for (const client of this.clients) {
      if (client.state === 'ready' && client.user) {
        writeEnvelope(
          client.socket as unknown as Socket,
          'server.scene_transform_started',
          started,
        );
      }
    }
  }

  broadcastTransformCancelled(
    input: SceneTransformPreviewCancel,
    source: HostClient | null = null,
  ): void {
    const registeredSource = this.transformSources.get(input.operationId);
    if (source && registeredSource !== source) {
      return;
    }
    if (!this.activeTransformOperations.delete(input.operationId)) {
      this.cancelledTransformOperations.add(input.operationId);
      if (this.cancelledTransformOperations.size > 100) {
        const oldest = this.cancelledTransformOperations.values().next().value;
        if (oldest) {
          this.cancelledTransformOperations.delete(oldest);
        }
      }
      return;
    }
    this.transformSources.delete(input.operationId);
    if (registeredSource?.user) {
      this.onTransformCancelled(input);
    }
    for (const client of this.clients) {
      if (client.state === 'ready' && client.user) {
        writeEnvelope(
          client.socket as unknown as Socket,
          'server.scene_transform_cancelled',
          { operationId: input.operationId, sceneId: input.sceneId },
        );
      }
    }
  }

  broadcastTransformPreview(
    input: SceneTransformPreviewDelta,
    source: HostClient | null = null,
  ): void {
    if (!this.activeTransformOperations.has(input.operationId)) {
      return;
    }
    const registeredSource = this.transformSources.get(input.operationId);
    if (source && registeredSource !== source) {
      return;
    }
    const now = Date.now();
    const sourceKey = source?.user?.id ?? 'gm';
    const lastAt = this.lastTransformPreviewAt.get(sourceKey) ?? 0;
    if (now - lastAt < 1000 / this.transformPreviewRate) {
      return;
    }
    this.lastTransformPreviewAt.set(sourceKey, now);
    this.sceneRepository.refreshTransform(
      input.operationId,
      source?.user
        ? { kind: 'player', userId: source.user.id }
        : { kind: 'gm' },
    );
    if (source?.user) {
      this.onTransformPreview(input);
    }
    const payload = Buffer.from(
      JSON.stringify({
        ...(input.absolute ? { absolute: input.absolute } : {}),
        dx: input.dx,
        dy: input.dy,
        operationId: input.operationId,
        rotation: input.rotation,
        scaleX: input.scaleX,
        scaleY: input.scaleY,
      }),
      'utf8',
    );
    for (const client of this.clients) {
      if (
        client.state === 'ready' &&
        client.user &&
        !client.udpRecoveryStartedAt
      ) {
        this.sendUdp(client, udpMessageTypes.transformPreview, payload);
      }
    }
  }

  get port(): number | null {
    return this.listener?.port ?? null;
  }

  get connectedPlayerCount(): number {
    let count = 0;
    for (const client of this.clients) {
      if (client.state === 'ready') {
        count += 1;
      }
    }
    return count;
  }

  get boundFamilies(): Array<'IPv4' | 'IPv6'> {
    return this.listener?.boundFamilies ?? [];
  }

  isUserConnected(userId: string): boolean {
    return this.claimedUsers.has(userId);
  }

  async start(port: number): Promise<boolean> {
    if (this.listener) {
      return true;
    }

    try {
      await this.readActiveScene();
      const listener = await this.createListenerGroup(port);
      this.listener = listener;
      listener.activate();
      this.ensureMaintenance();
      this.onStatusChanged();
      return true;
    } catch (error) {
      this.warn('Campaign server could not bind its configured port.', error);
      this.onStatusChanged();
      return false;
    }
  }

  async switchPort(
    port: number,
    persist: () => Promise<NetworkResult<number>>,
  ): Promise<NetworkResult<number>> {
    if (this.listener?.port === port) {
      return { ok: true, value: port };
    }

    if (!this.listener) {
      let next: ListenerGroup;
      try {
        next = await this.createListenerGroup(port);
      } catch {
        try {
          return {
            ok: true,
            value: (await this.configRepository.load()).port,
          };
        } catch {
          return {
            error: {
              code: 'storage_error',
              message: 'Server settings could not be loaded.',
            },
            ok: false,
          };
        }
      }

      const saved = await persist();
      if (!saved.ok) {
        await this.closeListener(next);
        return saved;
      }
      this.listener = next;
      next.activate();
      this.ensureMaintenance();
      this.onStatusChanged();
      return saved;
    }

    let next: ListenerGroup;
    try {
      next = await this.createListenerGroup(port);
    } catch {
      return { ok: true, value: this.listener.port };
    }

    const saved = await persist();
    if (!saved.ok) {
      await this.closeListener(next);
      return saved;
    }

    const previous = this.listener;
    this.disconnectAll('Server port changed.');
    await this.closeListener(previous);
    this.listener = next;
    next.activate();
    this.onStatusChanged();
    return saved;
  }

  disconnectUser(userId: string, message: string): void {
    this.claimedUsers.get(userId)?.socket.destroy(new Error(message));
  }

  async getUserViews(): Promise<NetworkResult<ManagedUserView[]>> {
    const settings = await this.configRepository.getView((userId) =>
      this.isUserConnected(userId),
    );
    return settings.ok
      ? { ok: true, value: settings.value.users }
      : settings;
  }

  async stop(): Promise<void> {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
    this.disconnectAll('Campaign host stopped.');
    for (const limiter of this.measurementRateLimiters.values()) {
      limiter.clear();
    }
    this.measurementRateLimiters.clear();
    const listener = this.listener;
    this.listener = null;
    if (listener) {
      await this.closeListener(listener);
    }
    this.onStatusChanged();
  }

  toStatus(
    configuredPort: number,
    localAddresses: string[],
    publicAddresses: string[],
  ): HostStatus {
    return {
      boundFamilies: this.boundFamilies,
      certificateFingerprint: this.identity.certificateFingerprint,
      connectedPlayerCount: this.connectedPlayerCount,
      effectivePort: this.listener?.port ?? configuredPort,
      localAddresses,
      publicAddresses,
      state: this.listener ? 'online' : 'offline',
    };
  }

  private async createListenerGroup(port: number): Promise<ListenerGroup> {
    const ipv4 = await this.bindFamily(
      port,
      'udp4',
      '0.0.0.0',
      'IPv4',
    );
    try {
      const ipv6 = await this.bindFamily(port, 'udp6', '::', 'IPv6');
      return {
        activate: () => {
          ipv4.activate();
          ipv6.activate();
        },
        boundFamilies: ['IPv4', 'IPv6'],
        port,
        tcp: [...ipv4.tcp, ...ipv6.tcp],
        udp: { ...ipv4.udp, ...ipv6.udp },
      };
    } catch {
      return ipv4;
    }
  }

  private async bindFamily(
    port: number,
    udpType: 'udp4' | 'udp6',
    host: string,
    family: 'IPv4' | 'IPv6',
  ): Promise<ListenerGroup> {
    let activated = false;
    const tcp = tls.createServer(
      {
        cert: this.identity.certificatePem,
        key: this.identity.privateKeyPem,
        maxVersion: 'TLSv1.3',
        minVersion: 'TLSv1.3',
        requestCert: false,
      },
      (socket) => {
        if (activated) {
          this.handleSecureConnection(socket);
        } else {
          socket.destroy();
        }
      },
    );
    tcp.maxConnections = MAX_PENDING_CONNECTIONS + 20;
    const udp = dgram.createSocket({
      ipv6Only: family === 'IPv6',
      type: udpType,
    });
    udp.on('message', (packet, remote) => {
      if (activated) {
        this.handleUdpMessage(packet, remote);
      }
    });
    udp.on('error', (error) => {
      this.warn('Campaign UDP socket error.', error);
    });

    try {
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => {
            tcp.off('listening', onListening);
            reject(error);
          };
          const onListening = () => {
            tcp.off('error', onError);
            resolve();
          };
          tcp.once('error', onError);
          tcp.once('listening', onListening);
          tcp.listen({
            host,
            ipv6Only: family === 'IPv6',
            port,
          });
        }),
        new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => {
            udp.off('listening', onListening);
            reject(error);
          };
          const onListening = () => {
            udp.off('error', onError);
            udp.on('error', (error) => {
              this.warn('Campaign UDP socket error.', error);
            });
            resolve();
          };
          udp.once('error', onError);
          udp.once('listening', onListening);
          udp.bind({
            address: host,
            port,
          });
        }),
      ]);
    } catch (error) {
      await Promise.all([closeTcpServer(tcp), closeUdpSocket(udp)]);
      throw error;
    }

    const address = tcp.address() as AddressInfo;
    return {
      activate: () => {
        activated = true;
      },
      boundFamilies: [family],
      port: address.port,
      tcp: [tcp],
      udp: { [family]: udp },
    };
  }

  private handleSecureConnection(socket: TLSSocket): void {
    const pendingConnections = [...this.clients].filter(
      (client) => client.state !== 'ready',
    ).length;
    if (pendingConnections >= MAX_PENDING_CONNECTIONS) {
      socket.destroy();
      return;
    }

    socket.setKeepAlive(true, 10_000);
    socket.setNoDelay(true);
    const now = Date.now();
    const client: HostClient = {
      controlRateBucket: new TokenBucket(10, 20),
      decoder: new FrameDecoder(),
      epoch: 0,
      handshakeTimer: setTimeout(() => {
        if (client.state !== 'ready') {
          socket.destroy(new Error('Connection handshake timed out.'));
        }
      }, HANDSHAKE_TIMEOUT_MS),
      lastPingAt: now,
      lastMapPingAt: 0,
      lastMeasurementSequence: -1,
      lastPongAt: now,
      lastUdpAt: now,
      pendingPingNonce: null,
      processing: Promise.resolve(),
      interactiveRateBucket: new TokenBucket(
        this.transformPreviewRate,
        this.transformPreviewRate * 2,
      ),
      remoteAddress: normalizeRemoteAddress(socket.remoteAddress),
      replayWindow: new ReplayWindow(),
      serverSequence: 0n,
      socket,
      state: 'awaiting_trust',
      udpCredentials: null,
      udpEndpoint: null,
      udpRecoveryStartedAt: null,
      user: null,
      uploads: new Map(),
    };
    this.clients.add(client);
    socket.on('data', (chunk: Buffer) => {
      try {
        for (const envelope of client.decoder.push(chunk)) {
          client.processing = client.processing
            .then(() => this.handleTcpEnvelope(client, envelope))
            .catch((error) => {
              this.warn('Invalid campaign client message.', error);
              socket.destroy(new Error('Invalid network message.'));
            });
        }
      } catch {
        socket.destroy(new Error('Invalid network message.'));
      }
    });
    socket.on('close', () => this.removeClient(client));
    socket.on('error', () => undefined);
    writeEnvelope(socket as unknown as Socket, 'server.hello', {
      campaignId: this.campaignId,
      campaignName: this.campaignName,
      protocolVersion: NETWORK_PROTOCOL_VERSION,
    });
  }

  private async handleTcpEnvelope(
    client: HostClient,
    envelope: TcpEnvelope,
  ): Promise<void> {
    if (envelope.type === 'client.trust_accepted') {
      if (client.state !== 'awaiting_trust') {
        throw new Error('Unexpected trust message.');
      }
      parsePayload('client.trust_accepted', envelope.payload);
      const config = await this.configRepository.load();
      client.state = 'awaiting_auth';
      writeEnvelope(client.socket as unknown as Socket, 'server.users', {
        users: [...config.users]
          .sort(
            (left, right) =>
              left.username.localeCompare(right.username, 'en-US') ||
              left.id.localeCompare(right.id),
          )
          .map(({ id, username }) => ({ id, username })),
      });
      return;
    }

    if (envelope.type === 'client.authenticate') {
      if (client.state !== 'awaiting_auth') {
        throw new Error('Unexpected authentication message.');
      }
      const input = parsePayload('client.authenticate', envelope.payload);
      await this.authenticateClient(client, input.userId, input.password);
      return;
    }

    if (envelope.type === 'client.pong') {
      const input = parsePayload('client.pong', envelope.payload);
      if (input.nonce === client.pendingPingNonce) {
        client.lastPongAt = Date.now();
        client.pendingPingNonce = null;
      }
      return;
    }

    if (envelope.type === 'client.udp_rekey') {
      if (client.state !== 'ready' && client.state !== 'awaiting_udp') {
        throw new Error('Unexpected UDP recovery message.');
      }
      parsePayload('client.udp_rekey', envelope.payload);
      this.issueUdpCredentials(client);
      return;
    }

    if (client.state === 'ready' && client.user) {
      if (envelope.type === 'client.scene_drawing_preview') {
        const input = parsePayload(
          'client.scene_drawing_preview',
          envelope.payload,
        );
        await this.broadcastDrawingPreview(
          {
            ...input,
            campaignId: this.campaignId,
            layer: 'token',
          },
          client,
        );
        return;
      }
      if (envelope.type === 'client.scene_objects_set') {
        const input = parsePayload('client.scene_objects_set', envelope.payload);
        const result = await this.sceneRepository.setObjects(
          input.sceneId,
          input.state,
          input.expectedRevision,
          input.operationId,
          { kind: 'player', userId: client.user.id },
        );
        this.sendSceneResult(client, result, envelope.requestId);
        if (result.ok) {
          this.onSceneChanged();
          await this.broadcastActiveScene();
        }
        return;
      }
      if (
        envelope.type === 'client.scene_undo' ||
        envelope.type === 'client.scene_redo'
      ) {
        const input =
          envelope.type === 'client.scene_undo'
            ? parsePayload('client.scene_undo', envelope.payload)
            : parsePayload('client.scene_redo', envelope.payload);
        const actor = { kind: 'player' as const, userId: client.user.id };
        const result =
          envelope.type === 'client.scene_undo'
            ? await this.sceneRepository.undo(input.sceneId, actor)
            : await this.sceneRepository.redo(input.sceneId, actor);
        this.sendSceneResult(client, result, envelope.requestId);
        if (result.ok) {
          this.onSceneChanged();
          await this.broadcastActiveScene();
        }
        return;
      }
      if (envelope.type === 'client.scene_transform_start') {
        const input = parsePayload(
          'client.scene_transform_start',
          envelope.payload,
        );
        const result = await this.sceneRepository.beginTransform(
          input.sceneId,
          input.operationId,
          input.targets,
          { kind: 'player', userId: client.user.id },
        );
        if (!result.ok) {
          this.sendSceneResult(client, result, envelope.requestId);
          return;
        }
        await this.broadcastTransformStarted(
          {
            ...input,
            campaignId: this.campaignId,
            startingTransforms: [],
          },
          client,
        );
        writeEnvelope(
          client.socket as unknown as Socket,
          'server.scene_transform_granted',
          { operationId: input.operationId },
          envelope.requestId,
        );
        return;
      }
      if (envelope.type === 'client.scene_transform_cancel') {
        const input = parsePayload(
          'client.scene_transform_cancel',
          envelope.payload,
        );
        this.sceneRepository.cancelTransform(input.operationId, {
          kind: 'player',
          userId: client.user.id,
        });
        this.broadcastTransformCancelled(
          { ...input, campaignId: this.campaignId },
          client,
        );
        return;
      }
      if (envelope.type === 'client.map_ping') {
        const input = parsePayload('client.map_ping', envelope.payload);
        await this.broadcastMapPing(
          { ...input, campaignId: this.campaignId },
          client,
        );
        return;
      }
      if (envelope.type === 'client.asset_manifest') {
        if (!this.assetPolicy.authorize({
          action: 'list',
          subject: actorFor(client),
        })) {
          this.assetTransfer.sendAssetError(
            client,
            'permission_denied',
            'You cannot view campaign assets.',
            envelope.requestId,
          );
          return;
        }
        parsePayload('client.asset_manifest', envelope.payload);
        await this.assetTransfer.sendAssetManifest(client, envelope.requestId);
        return;
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
          this.assetTransfer.sendAssetError(
            client,
            'permission_denied',
            'You cannot read this campaign asset.',
            envelope.requestId,
            input.assetId,
          );
          return;
        }
        await this.assetTransfer.sendAssetChunk(
          client,
          input.assetId,
          input.index,
          envelope.requestId,
        );
        return;
      }
      if (envelope.type === 'client.asset_rename') {
        const input = parsePayload('client.asset_rename', envelope.payload);
        const asset = (await this.assetRepository.readManifest()).assets.find(
          (candidate) => candidate.id === input.assetId,
        );
        if (!this.assetPolicy.authorize({
          action: 'rename',
          asset,
          subject: actorFor(client),
        })) {
          this.assetTransfer.sendAssetError(
            client,
            'permission_denied',
            'You cannot rename this campaign asset.',
            envelope.requestId,
            input.assetId,
          );
          return;
        }
        const result = await this.assetRepository.renameAsset(
          input.assetId,
          input.displayName,
          input.expectedRevision,
          actorFor(client),
        );
        await this.assetTransfer.sendMutationResult(client, result, envelope.requestId);
        if (result.ok) {
          await this.broadcastAssetsChanged();
        }
        return;
      }
      if (envelope.type === 'client.asset_delete') {
        const input = parsePayload('client.asset_delete', envelope.payload);
        const asset = (await this.assetRepository.readManifest()).assets.find(
          (candidate) => candidate.id === input.assetId,
        );
        if (!this.assetPolicy.authorize({
          action: 'delete',
          asset,
          subject: actorFor(client),
        })) {
          this.assetTransfer.sendAssetError(
            client,
            'permission_denied',
            'You cannot delete this campaign asset.',
            envelope.requestId,
            input.assetId,
          );
          return;
        }
        const result = await this.assetRepository.trashAsset(
          input.assetId,
          input.expectedRevision,
        );
        await this.assetTransfer.sendMutationResult(client, result, envelope.requestId);
        if (result.ok) {
          await this.broadcastAssetsChanged();
        }
        return;
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
          this.assetTransfer.sendAssetError(
            client,
            'permission_denied',
            'You cannot add campaign assets.',
            envelope.requestId,
          );
          return;
        }
        await this.assetTransfer.startAssetUpload(client, input, envelope.requestId);
        return;
      }
      if (envelope.type === 'client.asset_import_chunk') {
        const input = parsePayload(
          'client.asset_import_chunk',
          envelope.payload,
        );
        await this.assetTransfer.receiveAssetUploadChunk(client, input, envelope.requestId);
        return;
      }
      if (envelope.type === 'client.asset_import_commit') {
        const input = parsePayload(
          'client.asset_import_commit',
          envelope.payload,
        );
        await this.assetTransfer.commitAssetUpload(
          client,
          input.uploadId,
          envelope.requestId,
        );
        return;
      }
      if (envelope.type === 'client.asset_sync_error') {
        const input = parsePayload(
          'client.asset_sync_error',
          envelope.payload,
        );
        this.onAssetSyncError(
          client.user.username,
          input.assetName,
          input.reason,
        );
        return;
      }
    }

    throw new Error('Unsupported client message.');
  }

  async broadcastAssetsChanged(): Promise<void> {
    const manifest = await this.assetRepository.readManifest();
    for (const client of this.clients) {
      if (client.state === 'ready' && client.user) {
        writeEnvelope(
          client.socket as unknown as Socket,
          'server.assets_changed',
          this.assetTransfer.snapshotFor(client, manifest),
        );
      }
    }
  }

  /** Pushes the presented scene to every ready client. */
  async broadcastActiveScene(): Promise<void> {
    for (const [operationId, source] of this.transformSources) {
      this.sceneRepository.cancelTransform(
        operationId,
        source?.user
          ? { kind: 'player', userId: source.user.id }
          : { kind: 'gm' },
      );
    }
    this.activeTransformOperations.clear();
    this.transformSources.clear();
    this.cancelledTransformOperations.clear();
    const previousSceneId = this.activeScene?.id ?? null;
    const scene = await this.readActiveScene();
    if (scene?.id !== previousSceneId) {
      this.clearAllMeasurements();
      for (const client of this.clients) {
        client.lastMeasurementSequence = -1;
      }
    }
    const signature = scene ? JSON.stringify(scene) : null;
    if (signature === this.lastBroadcastSceneSignature) {
      return;
    }
    this.lastBroadcastSceneSignature = signature;
    for (const client of this.clients) {
      if (client.state === 'ready' && client.user) {
        writeEnvelope(
          client.socket as unknown as Socket,
          'server.scene_presented',
          { scene },
        );
      }
    }
  }

  private async sendActiveScene(client: HostClient): Promise<void> {
    try {
      writeEnvelope(
        client.socket as unknown as Socket,
        'server.scene_presented',
        { scene: await this.readActiveScene() },
      );
    } catch (error) {
      this.warn('Failed to send the presented scene to a player.', error);
    }
  }

  private async readActiveScene(): Promise<SceneRecord | null> {
    const manifest = await this.sceneRepository.readManifest();
    const scene = findScene(manifest, manifest.activeSceneId);
    this.activeScene = scene ? projectSceneForPlayer(scene) : null;
    return this.activeScene;
  }

  private async authenticateClient(
    client: HostClient,
    userId: string,
    password: string,
  ): Promise<void> {
    const limitKeys = [
      `ip:${client.remoteAddress}`,
      `account:${this.campaignId}:${userId}`,
    ];
    if (this.loginRateLimiter.isLimited(limitKeys)) {
      writeEnvelope(client.socket as unknown as Socket, 'server.auth_error', {
        code: 'cooldown',
        message: 'Too many failed attempts. Try again later.',
      });
      return;
    }

    if (this.claimedUsers.has(userId)) {
      writeEnvelope(client.socket as unknown as Socket, 'server.auth_error', {
        code: 'account_connected',
        message: 'This user is already connected.',
      });
      return;
    }

    let user: StoredManagedUser | undefined;
    try {
      user = (await this.configRepository.load()).users.find(
        (candidate) => candidate.id === userId,
      );
    } catch {
      client.socket.destroy(new Error('Server settings could not be loaded.'));
      return;
    }

    if (!user || !(await verifyPassword(password, user.password))) {
      this.loginRateLimiter.recordFailure(limitKeys);
      writeEnvelope(client.socket as unknown as Socket, 'server.auth_error', {
        code: 'authentication_failed',
        message: 'The password is incorrect.',
      });
      return;
    }

    if (this.claimedUsers.has(userId)) {
      writeEnvelope(client.socket as unknown as Socket, 'server.auth_error', {
        code: 'account_connected',
        message: 'This user is already connected.',
      });
      return;
    }

    this.loginRateLimiter.clear(limitKeys);
    client.user = user;
    client.state = 'awaiting_udp';
    this.claimedUsers.set(user.id, client);
    this.issueUdpCredentials(client);
  }

  private issueUdpCredentials(client: HostClient): void {
    if (client.udpCredentials) {
      this.sessionsById.delete(
        client.udpCredentials.sessionId.toString('base64url'),
      );
      client.epoch += 1;
    }
    client.udpCredentials = createUdpSessionCredentials(client.epoch);
    client.replayWindow = new ReplayWindow();
    client.serverSequence = 0n;
    client.udpEndpoint = null;
    client.lastUdpAt = Date.now();
    this.sessionsById.set(
      client.udpCredentials.sessionId.toString('base64url'),
      client,
    );
    writeEnvelope(
      client.socket as unknown as Socket,
      'server.udp_credentials',
      serializeUdpCredentials(client.udpCredentials),
    );
  }

  private handleUdpMessage(packet: Buffer, remote: RemoteInfo): void {
    if (packet.length < 26) {
      return;
    }

    const sessionKey = packet.subarray(10, 26).toString('base64url');
    const client = this.sessionsById.get(sessionKey);
    const credentials = client?.udpCredentials;
    if (!client || !credentials) {
      return;
    }

    try {
      const decoded = decodeUdpPacket(packet, credentials.clientToServer);
      if (
        decoded.epoch !== credentials.epoch ||
        !decoded.sessionId.equals(credentials.sessionId) ||
        !client.replayWindow.accept(decoded.sequence)
      ) {
        return;
      }
      const controlMessage =
        decoded.type === udpMessageTypes.associate ||
        decoded.type === udpMessageTypes.heartbeat ||
        decoded.type === udpMessageTypes.heartbeatAcknowledge ||
        decoded.type === udpMessageTypes.acknowledge;
      const bucket = controlMessage
        ? client.controlRateBucket
        : client.interactiveRateBucket;
      if (!bucket.take()) {
        return;
      }

      client.lastUdpAt = Date.now();
      client.udpEndpoint = remote;
      client.udpRecoveryStartedAt = null;

      if (decoded.type === udpMessageTypes.associate) {
        if (decoded.payload.length !== 0) {
          return;
        }
        this.sendUdp(client, udpMessageTypes.acknowledge);
        const wasReady = client.state === 'ready';
        client.state = 'ready';
        clearTimeout(client.handshakeTimer);
        if (client.user) {
          writeEnvelope(
            client.socket as unknown as Socket,
            'server.ready',
            {
              campaignId: this.campaignId,
              campaignName: this.campaignName,
              updateRate: this.transformPreviewRate,
              userId: client.user.id,
              username: client.user.username,
            },
          );
          void this.sendActiveScene(client);
        }
        if (!wasReady) {
          this.onStatusChanged();
        }
      } else if (decoded.type === udpMessageTypes.heartbeat) {
        if (decoded.payload.length !== 0) {
          return;
        }
        this.sendUdp(client, udpMessageTypes.heartbeatAcknowledge);
      } else if (
        decoded.type === udpMessageTypes.clientMeasurement &&
        client.state === 'ready' &&
        client.user &&
        !client.udpRecoveryStartedAt
      ) {
        const update = decodeClientMeasurement(decoded.payload);
        void this.acceptClientMeasurement(client, update);
      } else if (
        decoded.type === udpMessageTypes.clientDrawingPreview &&
        client.state === 'ready' &&
        client.user &&
        !client.udpRecoveryStartedAt
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
          typeof value.operationId === 'string' &&
          typeof value.sceneId === 'string' &&
          typeof value.sequence === 'number' &&
          Number.isInteger(value.sequence) &&
          value.sequence >= 0 &&
          points.length <= MAX_DRAWING_PREVIEW_POINTS &&
          style.success &&
          ((value.active && points.length > 0) ||
            (!value.active && points.length === 0))
        ) {
          void this.broadcastDrawingPreview(
            {
              active: value.active,
              campaignId: this.campaignId,
              closed: value.closed,
              kind: value.kind,
              layer: 'token',
              operationId: value.operationId,
              points,
              sceneId: value.sceneId,
              sequence: value.sequence,
              style: style.data,
            },
            client,
          );
        }
      } else if (
        decoded.type === udpMessageTypes.clientTransformPreview &&
        client.state === 'ready' &&
        client.user &&
        !client.udpRecoveryStartedAt
      ) {
        const value = JSON.parse(
          decoded.payload.toString('utf8'),
        ) as Record<string, unknown>;
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
            (key) =>
              typeof value[key] === 'number' &&
              Number.isFinite(value[key]),
          ) &&
          (value.scaleX as number) > 0 &&
          (value.scaleY as number) > 0
        ) {
          this.broadcastTransformPreview(
            {
              ...(absolute?.success ? { absolute: absolute.data } : {}),
              campaignId: this.campaignId,
              dx: value.dx as number,
              dy: value.dy as number,
              operationId: value.operationId,
              rotation: value.rotation as number,
              scaleX: value.scaleX as number,
              scaleY: value.scaleY as number,
            },
            client,
          );
        }
      } else if (
        decoded.type === udpMessageTypes.heartbeatAcknowledge ||
        decoded.type === udpMessageTypes.acknowledge
      ) {
        if (decoded.payload.length !== 0) {
          return;
        }
        // Receipt already refreshed lastUdpAt.
      }
    } catch {
      // Invalid and unauthenticated datagrams are intentionally ignored.
    }
  }

  private sendSceneResult(
    client: HostClient,
    result: SceneResult<SceneRecord> | SceneResult<null>,
    requestId?: string,
  ): void {
    if (!result.ok) {
      writeEnvelope(
        client.socket as unknown as Socket,
        'server.scene_error',
        result.error,
        requestId,
      );
      return;
    }
    if (result.value && 'id' in result.value) {
      writeEnvelope(
        client.socket as unknown as Socket,
        'server.scene_mutation',
        { scene: projectSceneForPlayer(result.value) },
        requestId,
      );
    }
  }

  private async acceptClientMeasurement(
    client: HostClient,
    update: Omit<MeasurementUpdate, 'campaignId'>,
  ): Promise<void> {
    try {
      const scene = this.activeScene ?? (await this.readActiveScene());
      if (
        !scene ||
        !this.clients.has(client) ||
        client.state !== 'ready' ||
        !client.user ||
        client.udpRecoveryStartedAt
      ) {
        return;
      }
      this.acceptMeasurementUpdate(
        {
          ...update,
          campaignId: this.campaignId,
          sourceId: client.user.id,
        },
        scene,
        client,
      );
    } catch (error) {
      this.warn('Failed to validate a player measurement update.', error);
    }
  }

  private sendUdp(
    client: HostClient,
    type: number,
    payload: Buffer<ArrayBufferLike> = Buffer.alloc(0),
  ): void {
    if (!this.listener || !client.udpCredentials || !client.udpEndpoint) {
      return;
    }
    const udpSocket = this.listener.udp[
      client.udpEndpoint.family === 'IPv6' ? 'IPv6' : 'IPv4'
    ];
    if (!udpSocket) {
      return;
    }

    const packet = encodeUdpPacket(
      client.udpCredentials.sessionId,
      client.udpCredentials.epoch,
      client.serverSequence,
      type as Parameters<typeof encodeUdpPacket>[3],
      client.udpCredentials.serverToClient,
      payload,
    );
    client.serverSequence += 1n;
    udpSocket.send(
      packet,
      client.udpEndpoint.port,
      client.udpEndpoint.address,
    );
  }

  private ensureMaintenance(): void {
    if (this.maintenanceTimer) {
      return;
    }

    this.maintenanceTimer = setInterval(() => {
      const now = Date.now();
      for (const [sourceId, measurement] of this.activeMeasurements) {
        if (now - measurement.lastAt >= MEASUREMENT_EXPIRY_MS) {
          this.clearMeasurementSource(
            sourceId,
            [...this.clients].find(
              (client) => client.user?.id === sourceId,
            ),
          );
        }
      }
      for (const client of this.clients) {
        if (now - client.lastPongAt > TCP_DEAD_TIMEOUT_MS) {
          client.socket.destroy(new Error('TCP heartbeat timed out.'));
          continue;
        }

        if (now - client.lastPingAt >= TCP_PING_INTERVAL_MS) {
          const nonce = randomUUID();
          client.lastPingAt = now;
          client.pendingPingNonce = nonce;
          writeEnvelope(
            client.socket as unknown as Socket,
            'server.ping',
            { nonce },
          );
        }

        if (
          client.udpRecoveryStartedAt &&
          now - client.udpRecoveryStartedAt > UDP_DEAD_TIMEOUT_MS
        ) {
          client.socket.destroy(new Error('UDP recovery timed out.'));
          continue;
        }

        if (
          client.state === 'ready' &&
          !client.udpRecoveryStartedAt &&
          now - client.lastUdpAt > UDP_RECOVERY_THRESHOLD_MS
        ) {
          client.udpRecoveryStartedAt = now;
          writeEnvelope(
            client.socket as unknown as Socket,
            'server.udp_recovery_required',
            {},
          );
          continue;
        }

        if (
          client.state === 'ready' &&
          client.udpEndpoint &&
          now - client.lastUdpAt >= UDP_HEARTBEAT_INTERVAL_MS
        ) {
          this.sendUdp(client, udpMessageTypes.heartbeat);
        }
      }
    }, 1_000);
  }

  private removeClient(client: HostClient): void {
    if (!this.clients.delete(client)) {
      return;
    }
    if (client.user) {
      this.clearMeasurementSource(client.user.id, client);
      for (const [operationId, source] of this.transformSources) {
        if (source === client) {
          this.sceneRepository.cancelTransform(operationId, {
            kind: 'player',
            userId: client.user.id,
          });
          this.broadcastTransformCancelled(
            {
              campaignId: this.campaignId,
              operationId,
              sceneId: this.activeScene?.id ?? randomUUID(),
            },
            client,
          );
        }
      }
    }
    clearTimeout(client.handshakeTimer);
    if (client.user && this.claimedUsers.get(client.user.id) === client) {
      this.claimedUsers.delete(client.user.id);
    }
    if (client.udpCredentials) {
      this.sessionsById.delete(
        client.udpCredentials.sessionId.toString('base64url'),
      );
    }
    for (const upload of client.uploads.values()) {
      void rm(upload.directory, { force: true, recursive: true });
    }
    client.uploads.clear();
    this.onStatusChanged();
  }

  private disconnectAll(message: string): void {
    for (const client of this.clients) {
      client.socket.destroy(new Error(message));
    }
  }

  private async closeListener(listener: ListenerGroup): Promise<void> {
    await Promise.all([
      ...listener.tcp.map((server) => closeTcpServer(server)),
      ...Object.values(listener.udp).map((socket) =>
        closeUdpSocket(socket),
      ),
    ]);
  }
}
