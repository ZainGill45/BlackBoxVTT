import { randomUUID } from 'node:crypto';
import dgram, { type RemoteInfo, type Socket as UdpSocket } from 'node:dgram';
import { rm } from 'node:fs/promises';
import type { AddressInfo, Socket } from 'node:net';
import tls, { type Server as TlsServer, type TLSSocket } from 'node:tls';
import type {
  ChatBootstrap,
  ChatEvent,
  ChatHistoryInput,
  ChatHistoryPage,
  ChatMessage,
  ChatParticipantEvent,
  ChatResult,
  ClearChatHistoryResult,
  SendChatMessageInput,
  SendChatRollInput,
} from '../../shared/chat';
import type {
  HostStatus,
  DrawingPreviewEvent,
  DrawingPreviewUpdate,
  ManagedUserView,
  MapPing,
  MeasurementEvent,
  MeasurementUpdate,
  NetworkResult,
  ShapePreviewEvent,
  ShapePreviewUpdate,
} from '../../shared/network';
import { NETWORK_PROTOCOL_VERSION } from '../../shared/network';
import {
  type SceneTransformPreviewCancel,
  type SceneTransformPreviewDelta,
  type SceneTransformPreviewStart,
} from '../../shared/scenes';
import type { AssetRepository } from '../assetRepository';
import type { ChatRepository } from '../chatRepository';
import { DiceRollExecutor } from '../diceRollExecutor';
import {
  CampaignChatService,
  GAME_MASTER_CHAT_IDENTITY,
} from '../campaignTable/chatService';
import { CampaignSceneService } from '../campaignTable/sceneService';
import type { SceneRepository } from '../sceneRepository';
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
import { HostChatRequestHandler } from './hostChatRequestHandler';
import { HostSceneRealtime } from './hostSceneRealtime';
import { HostSceneRequestHandler } from './hostSceneRequestHandler';
import type { HostClient } from './hostClient';
import { decodeClientMeasurement } from './measurementProtocol';
import {
  decodeClientDrawingPreview,
  decodeClientShapePreview,
  decodeTransformPreview,
} from './sceneRealtimeProtocol';

const HANDSHAKE_TIMEOUT_MS = 60_000;
const TCP_PING_INTERVAL_MS = 10_000;
const TCP_DEAD_TIMEOUT_MS = 30_000;
const UDP_HEARTBEAT_INTERVAL_MS = 5_000;
const UDP_RECOVERY_THRESHOLD_MS = 15_000;
const UDP_DEAD_TIMEOUT_MS = 60_000;
const MAX_PENDING_CONNECTIONS = 64;


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
  chatRepository: ChatRepository;
  configRepository: ServerConfigRepository;
  identity: CampaignIdentity;
  onMapPing?: (input: MapPing) => void;
  onChatEvent?: (event: ChatEvent) => void;
  onDrawingPreview?: (input: DrawingPreviewEvent) => void;
  onMeasurementUpdate?: (input: MeasurementEvent) => void;
  onShapePreview?: (input: ShapePreviewEvent) => void;
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
  readonly assetRepository: AssetRepository;
  private readonly assetTransfer: HostAssetTransfer;
  readonly campaignId: string;
  readonly campaignName: string;
  private readonly chat: CampaignChatService;
  private readonly chatRequests: HostChatRequestHandler;
  private readonly diceRoller: DiceRollExecutor;
  private readonly sceneRealtime: HostSceneRealtime;
  private readonly scenes: CampaignSceneService;
  private readonly sceneRequests: HostSceneRequestHandler;
  readonly configRepository: ServerConfigRepository;
  readonly identity: CampaignIdentity;
  private readonly clients = new Set<HostClient>();
  private readonly claimedUsers = new Map<string, HostClient>();
  private listener: ListenerGroup | null = null;
  private readonly loginRateLimiter = new LoginRateLimiter();
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onMapPing: NonNullable<
    CampaignHostServerOptions['onMapPing']
  >;
  private readonly onChatEvent: NonNullable<
    CampaignHostServerOptions['onChatEvent']
  >;
  private readonly onDrawingPreview: NonNullable<
    CampaignHostServerOptions['onDrawingPreview']
  >;
  private readonly onMeasurementUpdate: NonNullable<
    CampaignHostServerOptions['onMeasurementUpdate']
  >;
  private readonly onShapePreview: NonNullable<
    CampaignHostServerOptions['onShapePreview']
  >;
  private readonly onSceneChanged: NonNullable<
    CampaignHostServerOptions['onSceneChanged']
  >;
  private readonly onStatusChanged: () => void;
  private readonly onTransformCancelled: NonNullable<
    CampaignHostServerOptions['onTransformCancelled']
  >;
  private readonly onTransformPreview: NonNullable<
    CampaignHostServerOptions['onTransformPreview']
  >;
  private readonly onTransformStarted: NonNullable<
    CampaignHostServerOptions['onTransformStarted']
  >;
  private readonly sessionsById = new Map<string, HostClient>();
  private readonly warn: (message: string, error?: unknown) => void;

  constructor({
    assetRepository,
    assetPolicy = authenticatedAssetPolicy,
    campaignId,
    campaignName,
    chatRepository,
    configRepository,
    identity,
    onAssetSyncError = () => undefined,
    onMapPing = () => undefined,
    onChatEvent = () => undefined,
    onDrawingPreview = () => undefined,
    onMeasurementUpdate = () => undefined,
    onShapePreview = () => undefined,
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
    this.campaignId = campaignId;
    this.campaignName = campaignName;
    this.configRepository = configRepository;
    this.diceRoller = new DiceRollExecutor();
    this.chat = new CampaignChatService({
      chat: chatRepository,
      config: configRepository,
      diceRoller: this.diceRoller,
    });
    this.scenes = new CampaignSceneService(sceneRepository);
    this.identity = identity;
    this.onMapPing = onMapPing;
    this.onChatEvent = onChatEvent;
    this.onDrawingPreview = onDrawingPreview;
    this.onMeasurementUpdate = onMeasurementUpdate;
    this.onShapePreview = onShapePreview;
    this.onSceneChanged = onSceneChanged;
    this.onStatusChanged = onStatusChanged;
    this.onTransformCancelled = onTransformCancelled;
    this.onTransformPreview = onTransformPreview;
    this.onTransformStarted = onTransformStarted;
    this.warn = warn;
    this.sceneRealtime = new HostSceneRealtime({
      campaignId,
      clients: this.clients,
      events: {
        onDrawingPreview,
        onMapPing,
        onMeasurementUpdate,
        onShapePreview,
        onTransformCancelled,
        onTransformPreview,
        onTransformStarted,
      },
      scenes: this.scenes,
      sendUdp: (client, type, payload) =>
        this.sendUdp(client, type, payload),
      transformPreviewRate,
      warn,
    });
    this.assetTransfer = new HostAssetTransfer({
      assetPolicy,
      assetRepository,
      broadcastAssetsChanged: () => this.broadcastAssetsChanged(),
      onAssetSyncError,
    });
    this.chatRequests = new HostChatRequestHandler({
      chat: this.chat,
      onMessageCreated: (message, source) => {
        this.broadcastChatMessage(message, source);
        if (
          message.recipient === null ||
          message.recipient.kind === 'gm'
        ) {
          this.onChatEvent({
            campaignId: this.campaignId,
            message,
            type: 'message',
          });
        }
      },
    });
    this.sceneRequests = new HostSceneRequestHandler({
      broadcastDrawingPreview: (input, source) =>
        this.broadcastDrawingPreview(input, source),
      broadcastShapePreview: (input, source) =>
        this.broadcastShapePreview(input, source),
      broadcastTransformCancelled: (input, source) =>
        this.broadcastTransformCancelled(input, source),
      broadcastTransformStarted: (input, source) =>
        this.broadcastTransformStarted(input, source),
      campaignId: this.campaignId,
      onSceneMutation: async () => {
        this.onSceneChanged();
        await this.broadcastActiveScene();
      },
      scenes: this.scenes,
    });
  }

  get isOnline(): boolean {
    return this.listener !== null;
  }

  setTransformPreviewRate(rate: number): void {
    this.sceneRealtime.setTransformPreviewRate(rate);
  }

  setMaxChatMessageCharacters(maxMessageCharacters: number): void {
    for (const client of this.clients) {
      if (client.state === 'ready' && client.user) {
        writeEnvelope(
          client.socket as unknown as Socket,
          'server.chat_limit_changed',
          { maxMessageCharacters },
        );
      }
    }
    this.onChatEvent({
      campaignId: this.campaignId,
      maxMessageCharacters,
      type: 'limit_changed',
    });
  }

  async getGmChatBootstrap(
    systemEvents: ChatParticipantEvent[] = [],
  ): Promise<ChatResult<ChatBootstrap>> {
    return this.chat.bootstrap({ kind: 'gm' }, systemEvents);
  }

  getGmChatHistory(
    input: Omit<ChatHistoryInput, 'campaignId'>,
  ): Promise<ChatResult<ChatHistoryPage>> {
    return this.chat.history({ kind: 'gm' }, input);
  }

  async sendGmChat(
    input: Omit<SendChatMessageInput, 'campaignId'>,
  ): Promise<ChatResult<ChatMessage>> {
    const result = await this.chat.send(GAME_MASTER_CHAT_IDENTITY, input);
    if (!result.ok) {
      return result;
    }
    if (result.value.created) {
      this.broadcastChatMessage(result.value.message);
    }
    return { ok: true, value: result.value.message };
  }

  async sendGmChatRoll(
    input: Omit<SendChatRollInput, 'campaignId'>,
  ): Promise<ChatResult<ChatMessage>> {
    const result = await this.chat.sendRoll(GAME_MASTER_CHAT_IDENTITY, input);
    if (!result.ok) return result;
    if (result.value.created) {
      this.broadcastChatMessage(result.value.message);
    }
    return { ok: true, value: result.value.message };
  }

  async clearChatHistory(): Promise<
    ChatResult<ClearChatHistoryResult>
  > {
    const result = await this.chat.clear();
    if (!result.ok) {
      return result;
    }
    for (const client of this.clients) {
      if (client.state === 'ready' && client.user) {
        writeEnvelope(
          client.socket as unknown as Socket,
          'server.chat_history_cleared',
          result.value,
        );
      }
    }
    this.onChatEvent({
      campaignId: this.campaignId,
      generation: result.value.generation,
      type: 'history_cleared',
    });
    return result;
  }

  async broadcastChatDirectory(): Promise<void> {
    const result = await this.chat.directory();
    if (!result.ok) {
      this.warn(result.error.message);
      return;
    }
    const directory = result.value;
    for (const client of this.clients) {
      if (client.state === 'ready' && client.user) {
        writeEnvelope(
          client.socket as unknown as Socket,
          'server.chat_directory_changed',
          { directory },
        );
      }
    }
    this.onChatEvent({
      campaignId: this.campaignId,
      directory,
      type: 'directory_changed',
    });
  }

  async broadcastMapPing(
    input: MapPing,
    source?: HostClient,
  ): Promise<void> {
    await this.sceneRealtime.broadcastMapPing(input, source);
  }

  async broadcastDrawingPreview(
    input: DrawingPreviewUpdate,
    source: HostClient | null = null,
  ): Promise<void> {
    await this.sceneRealtime.broadcastDrawingPreview(input, source);
  }

  async broadcastMeasurementUpdate(
    input: MeasurementUpdate,
  ): Promise<void> {
    await this.sceneRealtime.broadcastMeasurementUpdate(input);
  }

  async broadcastShapePreview(
    input: ShapePreviewUpdate,
    source: HostClient | null = null,
  ): Promise<void> {
    await this.sceneRealtime.broadcastShapePreview(input, source);
  }

  async broadcastTransformStarted(
    input: SceneTransformPreviewStart,
    source: HostClient | null = null,
  ): Promise<void> {
    await this.sceneRealtime.broadcastTransformStarted(input, source);
  }

  broadcastTransformCancelled(
    input: SceneTransformPreviewCancel,
    source: HostClient | null = null,
  ): void {
    this.sceneRealtime.broadcastTransformCancelled(input, source);
  }

  broadcastTransformPreview(
    input: SceneTransformPreviewDelta,
    source: HostClient | null = null,
  ): void {
    this.sceneRealtime.broadcastTransformPreview(input, source);
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
      await this.sceneRealtime.initialize();
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
    this.sceneRealtime.reset();
    const listener = this.listener;
    this.listener = null;
    if (listener) {
      await this.closeListener(listener);
    }
    await this.diceRoller.close();
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

  private broadcastChatMessage(
    message: ChatMessage,
    source?: HostClient,
  ): void {
    for (const client of this.clients) {
      if (
        client === source ||
        client.state !== 'ready' ||
        !client.user
      ) {
        continue;
      }
      if (this.chat.isVisibleTo(message, client.user.id)) {
        writeEnvelope(
          client.socket as unknown as Socket,
          'server.chat_message',
          message,
        );
      }
    }
  }

  private async emitParticipantEvent(
    user: StoredManagedUser,
    type: ChatParticipantEvent['type'],
    excluded?: HostClient,
  ): Promise<void> {
    const event = await this.chat.createParticipantEvent(user, type);
    if (!event) {
      return;
    }
    for (const client of this.clients) {
      if (
        client !== excluded &&
        client.state === 'ready' &&
        client.user
      ) {
        writeEnvelope(
          client.socket as unknown as Socket,
          'server.chat_participant_event',
          event,
        );
      }
    }
    this.onChatEvent({
      campaignId: this.campaignId,
      ...event,
    });
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
        this.sceneRealtime.updateRate,
        this.sceneRealtime.updateRate * 2,
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
      if (await this.chatRequests.handleRequest(client, envelope)) {
        return;
      }
      if (await this.sceneRequests.handleRequest(client, envelope)) {
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
      if (await this.assetTransfer.handleRequest(client, envelope)) {
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
    await this.sceneRealtime.broadcastActiveScene();
  }

  private async sendActiveScene(client: HostClient): Promise<void> {
    await this.sceneRealtime.sendActiveScene(client);
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
              updateRate: this.sceneRealtime.updateRate,
              userId: client.user.id,
              username: client.user.username,
            },
          );
          void this.sendActiveScene(client);
        }
        if (!wasReady) {
          this.onStatusChanged();
          if (client.user) {
            void this.emitParticipantEvent(
              client.user,
              'participant_joined',
            );
          }
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
        const value = decodeClientDrawingPreview(decoded.payload);
        void this.broadcastDrawingPreview(
          {
            ...value,
            campaignId: this.campaignId,
            layer: 'token',
          },
          client,
        );
      } else if (
        decoded.type === udpMessageTypes.clientTransformPreview &&
        client.state === 'ready' &&
        client.user &&
        !client.udpRecoveryStartedAt
      ) {
        this.broadcastTransformPreview(
          {
            ...decodeTransformPreview(decoded.payload),
            campaignId: this.campaignId,
          },
          client,
        );
      } else if (
        decoded.type === udpMessageTypes.clientShapePreview &&
        client.state === 'ready' &&
        client.user &&
        !client.udpRecoveryStartedAt
      ) {
        const value = decodeClientShapePreview(decoded.payload);
        void this.broadcastShapePreview(
          {
            ...value,
            campaignId: this.campaignId,
            layer: 'token',
          },
          client,
        );
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

  private async acceptClientMeasurement(
    client: HostClient,
    update: Omit<MeasurementUpdate, 'campaignId'>,
  ): Promise<void> {
    await this.sceneRealtime.acceptClientMeasurement(client, update);
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
      this.sceneRealtime.expireMeasurements(now);
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
    const wasReady = client.state === 'ready';
    const disconnectedUser = client.user;
    if (!this.clients.delete(client)) {
      return;
    }
    this.sceneRealtime.removeClient(client);
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
    if (wasReady && disconnectedUser) {
      void this.emitParticipantEvent(
        disconnectedUser,
        'participant_left',
        client,
      );
    }
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
