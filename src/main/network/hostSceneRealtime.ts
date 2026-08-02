import { randomUUID } from 'node:crypto';
import type { Socket } from 'node:net';
import type {
  DrawingPreviewEvent,
  DrawingPreviewUpdate,
  MapPing,
  MeasurementEvent,
  MeasurementUpdate,
  ShapePreviewEvent,
  ShapePreviewUpdate,
} from '../../shared/network';
import type {
  SceneRecord,
  SceneTransformPreviewCancel,
  SceneTransformPreviewDelta,
  SceneTransformPreviewStart,
} from '../../shared/scenes';
import { CampaignSceneRealtimeRules } from '../campaignTable/sceneRealtimeRules';
import type { CampaignSceneService } from '../campaignTable/sceneService';
import type { HostClient } from './hostClient';
import { LatestSnapshotRateLimiter } from '../../shared/latestSnapshotRateLimiter';
import {
  encodeServerMeasurement,
} from './measurementProtocol';
import {
  encodeServerDrawingPreview,
  encodeServerShapePreview,
  encodeTransformPreview,
} from './sceneRealtimeProtocol';
import { writeEnvelope } from './tcpProtocol';
import { TokenBucket, udpMessageTypes } from './udpProtocol';

const MEASUREMENT_EXPIRY_MS = 1_500;

interface HostSceneRealtimeEvents {
  onDrawingPreview: (input: DrawingPreviewEvent) => void;
  onMapPing: (input: MapPing) => void;
  onMeasurementUpdate: (input: MeasurementEvent) => void;
  onShapePreview: (input: ShapePreviewEvent) => void;
  onTransformCancelled: (input: SceneTransformPreviewCancel) => void;
  onTransformPreview: (input: SceneTransformPreviewDelta) => void;
  onTransformStarted: (input: SceneTransformPreviewStart) => void;
}

interface HostSceneRealtimeOptions {
  campaignId: string;
  clients: Set<HostClient>;
  events: HostSceneRealtimeEvents;
  scenes: CampaignSceneService;
  sendUdp: (client: HostClient, type: number, payload?: Buffer) => void;
  transformPreviewRate: number;
  warn?: (message: string, error?: unknown) => void;
}

/**
 * Scene-specific live table state and fanout. The host server authenticates
 * transports; this service validates and relays only authenticated updates.
 */
export class HostSceneRealtime {
  private readonly activeMeasurements = new Map<
    string,
    { lastAt: number; update: MeasurementEvent }
  >();
  private activeScene: SceneRecord | null = null;
  private readonly activeTransformOperations = new Set<string>();
  private readonly activeShapePreviews = new Map<string, ShapePreviewEvent>();
  private readonly campaignId: string;
  private readonly cancelledTransformOperations = new Set<string>();
  private readonly clients: Set<HostClient>;
  private readonly events: HostSceneRealtimeEvents;
  private lastBroadcastSceneSignature: string | null | undefined;
  private lastHostMapPingAt = 0;
  private readonly hostDrawingPreviewRateLimiter: LatestSnapshotRateLimiter<
    DrawingPreviewUpdate
  >;
  private readonly hostShapePreviewRateLimiter: LatestSnapshotRateLimiter<
    ShapePreviewUpdate
  >;
  private readonly lastTransformPreviewAt = new Map<string, number>();
  private readonly measurementRateLimiters = new Map<
    string,
    LatestSnapshotRateLimiter<{
      input: MeasurementEvent;
      source?: HostClient;
    }>
  >();
  private readonly measurementRelaySequences = new Map<string, number>();
  private readonly rules: CampaignSceneRealtimeRules;
  private readonly scenes: CampaignSceneService;
  private readonly sendUdp: HostSceneRealtimeOptions['sendUdp'];
  private transformPreviewRate: number;
  private readonly transformSources = new Map<string, HostClient | null>();
  private readonly warn: (message: string, error?: unknown) => void;

  constructor({
    campaignId,
    clients,
    events,
    scenes,
    sendUdp,
    transformPreviewRate,
    warn = console.warn,
  }: HostSceneRealtimeOptions) {
    this.campaignId = campaignId;
    this.clients = clients;
    this.events = events;
    this.rules = new CampaignSceneRealtimeRules(campaignId);
    this.scenes = scenes;
    this.sendUdp = sendUdp;
    this.transformPreviewRate = transformPreviewRate;
    this.warn = warn;
    this.hostDrawingPreviewRateLimiter = new LatestSnapshotRateLimiter(
      () => this.transformPreviewRate,
      (preview) => {
        void this.relayDrawingPreview(preview);
      },
    );
    this.hostShapePreviewRateLimiter = new LatestSnapshotRateLimiter(
      () => this.transformPreviewRate,
      (preview) => {
        void this.relayShapePreview(preview);
      },
    );
  }

  get updateRate(): number {
    return this.transformPreviewRate;
  }

  async initialize(): Promise<void> {
    await this.readActiveScene();
  }

  setTransformPreviewRate(rate: number): void {
    this.transformPreviewRate = rate;
    this.hostDrawingPreviewRateLimiter.rateChanged();
    this.hostShapePreviewRateLimiter.rateChanged();
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

  async broadcastMapPing(input: MapPing, source?: HostClient): Promise<void> {
    const scene = await this.readActiveScene();
    const lastAt = source ? source.lastMapPingAt : this.lastHostMapPingAt;
    const acceptedAt = this.rules.acceptMapPing(input, scene, lastAt);
    if (acceptedAt === null) {
      return;
    }
    if (source) {
      source.lastMapPingAt = acceptedAt;
    } else {
      this.lastHostMapPingAt = acceptedAt;
    }

    this.events.onMapPing(input);
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
    if (!source && input.active && !input.reliable) {
      this.hostDrawingPreviewRateLimiter.push(structuredClone(input));
      return;
    }
    if (!source) {
      this.hostDrawingPreviewRateLimiter.drop(
        (pending) => pending.operationId === input.operationId,
      );
    }
    await this.relayDrawingPreview(input, source);
  }

  private async relayDrawingPreview(
    input: DrawingPreviewUpdate,
    source: HostClient | null = null,
  ): Promise<void> {
    const scene = await this.readActiveScene();
    const preview = this.rules.createDrawingPreview(
      input,
      scene,
      source?.user?.id,
    );
    if (!preview) {
      return;
    }
    if (source?.user) {
      this.events.onDrawingPreview(preview);
    }
    const payload = encodeServerDrawingPreview({
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
    });
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

  async broadcastShapePreview(
    input: ShapePreviewUpdate,
    source: HostClient | null = null,
  ): Promise<void> {
    if (!source && input.phase === 'update' && !input.reliable) {
      this.hostShapePreviewRateLimiter.push(structuredClone(input));
      return;
    }
    if (!source) {
      this.hostShapePreviewRateLimiter.drop(
        (pending) => pending.operationId === input.operationId,
      );
    }
    await this.relayShapePreview(input, source);
  }

  private async relayShapePreview(
    input: ShapePreviewUpdate,
    source: HostClient | null = null,
  ): Promise<void> {
    const scene = await this.readActiveScene();
    const preview = this.rules.createShapePreview(
      input,
      scene,
      source?.user?.id,
    );
    if (!preview) {
      return;
    }
    const previewKey = `${preview.sourceId}:${preview.operationId}`;
    if (preview.phase === 'cancel') {
      this.activeShapePreviews.delete(previewKey);
    } else {
      this.activeShapePreviews.set(previewKey, structuredClone(preview));
      if (this.activeShapePreviews.size > 512) {
        const oldest = this.activeShapePreviews.keys().next().value;
        if (oldest) {
          this.activeShapePreviews.delete(oldest);
        }
      }
    }
    if (source?.user) {
      this.events.onShapePreview(preview);
    }
    const payload = encodeServerShapePreview({
      layer: preview.layer,
      operationId: preview.operationId,
      phase: preview.phase,
      sceneId: preview.sceneId,
      sequence: preview.sequence,
      shape: preview.shape,
      sourceId: preview.sourceId,
    });
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
            'server.scene_shape_preview',
            {
              layer: preview.layer,
              operationId: preview.operationId,
              phase: preview.phase,
              reliable: true,
              sceneId: preview.sceneId,
              sequence: preview.sequence,
              shape: preview.shape,
              sourceId: preview.sourceId,
            },
          );
        } else {
          this.sendUdp(
            client,
            udpMessageTypes.serverShapePreview,
            payload,
          );
        }
      }
    }
  }

  async broadcastMeasurementUpdate(input: MeasurementUpdate): Promise<void> {
    if (input.campaignId !== this.campaignId) {
      return;
    }
    const scene = this.activeScene ?? (await this.readActiveScene());
    if (scene) {
      this.acceptMeasurementUpdate(
        { ...input, sourceId: this.campaignId },
        scene,
      );
    }
  }

  async acceptClientMeasurement(
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

  async broadcastTransformStarted(
    input: SceneTransformPreviewStart,
    source: HostClient | null = null,
  ): Promise<void> {
    const scene = await this.readActiveScene();
    const started = this.rules.createTransformStart(input, scene);
    if (!started || this.cancelledTransformOperations.delete(input.operationId)) {
      return;
    }
    this.activeTransformOperations.add(input.operationId);
    this.transformSources.set(input.operationId, source);
    if (source?.user) {
      this.events.onTransformStarted({ ...started, campaignId: input.campaignId });
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
      this.events.onTransformCancelled(input);
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
    this.scenes.refreshTransform(input.operationId, source?.user?.id);
    if (source?.user) {
      this.events.onTransformPreview(input);
    }
    const payload = encodeTransformPreview({
      ...(input.absolute ? { absolute: input.absolute } : {}),
      dx: input.dx,
      dy: input.dy,
      operationId: input.operationId,
      rotation: input.rotation,
      scaleX: input.scaleX,
      scaleY: input.scaleY,
    });
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

  async broadcastActiveScene(): Promise<void> {
    for (const [operationId, source] of this.transformSources) {
      this.scenes.cancelTransform(operationId, source?.user?.id);
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
    this.activeShapePreviews.clear();
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

  async sendActiveScene(client: HostClient): Promise<void> {
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

  expireMeasurements(now: number): void {
    for (const [sourceId, measurement] of this.activeMeasurements) {
      if (now - measurement.lastAt >= MEASUREMENT_EXPIRY_MS) {
        this.clearMeasurementSource(
          sourceId,
          [...this.clients].find((client) => client.user?.id === sourceId),
        );
      }
    }
  }

  removeClient(client: HostClient): void {
    if (!client.user) {
      return;
    }
    this.clearMeasurementSource(client.user.id, client);
    for (const preview of [...this.activeShapePreviews.values()]) {
      if (preview.sourceId !== client.user.id) {
        continue;
      }
      void this.broadcastShapePreview(
        {
          campaignId: this.campaignId,
          layer: preview.layer,
          operationId: preview.operationId,
          phase: 'cancel',
          reliable: true,
          sceneId: preview.sceneId,
          sequence: preview.sequence + 1,
          shape: null,
        },
        client,
      );
    }
    for (const [operationId, source] of this.transformSources) {
      if (source !== client) {
        continue;
      }
      this.scenes.cancelTransform(operationId, client.user.id);
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

  reset(): void {
    this.clearAllMeasurements();
    this.hostDrawingPreviewRateLimiter.clear();
    this.hostShapePreviewRateLimiter.clear();
    this.activeShapePreviews.clear();
    for (const limiter of this.measurementRateLimiters.values()) {
      limiter.clear();
    }
    this.measurementRateLimiters.clear();
    this.measurementRelaySequences.clear();
    this.activeTransformOperations.clear();
    this.cancelledTransformOperations.clear();
    this.transformSources.clear();
    this.lastTransformPreviewAt.clear();
  }

  private async readActiveScene(): Promise<SceneRecord | null> {
    this.activeScene = await this.scenes.readActiveScene();
    return this.activeScene;
  }

  private acceptMeasurementUpdate(
    input: MeasurementEvent,
    scene: SceneRecord,
    source?: HostClient,
  ): void {
    if (
      !this.rules.acceptsMeasurement(
        input,
        scene,
        source?.lastMeasurementSequence,
      )
    ) {
      return;
    }
    if (source) {
      source.lastMeasurementSequence = input.updateSequence;
    }
    this.queueMeasurementRelay(input, source);
  }

  private nextMeasurementRelaySequence(sourceId: string): number {
    const next = ((this.measurementRelaySequences.get(sourceId) ?? 0) + 1) >>> 0;
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
      this.events.onMeasurementUpdate(input);
    }
    const payload = encodeServerMeasurement(input);
    for (const client of this.clients) {
      if (
        client !== source &&
        client.state === 'ready' &&
        client.user &&
        !client.udpRecoveryStartedAt
      ) {
        this.sendUdp(client, udpMessageTypes.serverMeasurement, payload);
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
      { ...active.update, active: false, points: [] },
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
}
