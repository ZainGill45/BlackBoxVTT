import type { Result } from './result';
import type {
  ChatBootstrap,
  ChatEvent,
  ChatHistoryInput,
  ChatHistoryPage,
  ChatMessage,
  ChatResult,
  ClearChatHistoryInput,
  ClearChatHistoryResult,
  SendChatMessageInput,
  SetMaxChatMessageCharactersInput,
} from './chat';
import type {
  SceneDrawingKind,
  SceneDrawingLayer,
  SceneDrawingPoint,
  SceneDrawingStyle,
  SceneTransformPreviewCancel,
  SceneTransformPreviewDelta,
  SceneTransformPreviewStart,
} from './scenes';

export const NETWORK_PROTOCOL_VERSION = 9 as const;
export const DEFAULT_SERVER_PORT = 30_000;
export const DEFAULT_TRANSFORM_PREVIEW_RATE = 60;
export const MIN_TRANSFORM_PREVIEW_RATE = 32;
export const MAX_TRANSFORM_PREVIEW_RATE = 128;
export const MAX_MANAGED_USERS = 20;
export const MAX_MEASUREMENT_POINTS = 64;
export const MAX_DRAWING_PREVIEW_POINTS = 16;

export const networkIpcChannels = {
  acceptTrust: 'network:accept-trust',
  authenticate: 'network:authenticate',
  cancelConnection: 'network:cancel-connection',
  chatEvent: 'network:chat-event',
  clearChatHistory: 'network:clear-chat-history',
  clientStateChanged: 'network:client-state-changed',
  connect: 'network:connect',
  createUser: 'network:create-user',
  deleteHistory: 'network:delete-history',
  deleteUser: 'network:delete-user',
  disconnect: 'network:disconnect',
  drawingPreview: 'network:drawing-preview',
  getChatBootstrap: 'network:get-chat-bootstrap',
  getChatHistory: 'network:get-chat-history',
  getHostStatus: 'network:get-host-status',
  getServerSettings: 'network:get-server-settings',
  hostStatusChanged: 'network:host-status-changed',
  listHistory: 'network:list-history',
  mapPing: 'network:map-ping',
  measurementUpdate: 'network:measurement-update',
  openHost: 'network:open-host',
  resetPassword: 'network:reset-password',
  sessionClosed: 'network:session-closed',
  setMaxChatMessageCharacters: 'network:set-max-chat-message-characters',
  setPort: 'network:set-port',
  setTransformPreviewRate: 'network:set-transform-preview-rate',
  sendMapPing: 'network:send-map-ping',
  sendChatMessage: 'network:send-chat-message',
  sendDrawingPreview: 'network:send-drawing-preview',
  sendMeasurementUpdate: 'network:send-measurement-update',
  stopHost: 'network:stop-host',
  transformCancelled: 'network:transform-cancelled',
  transformPreview: 'network:transform-preview',
  transformStarted: 'network:transform-started',
  updateUsername: 'network:update-username',
} as const;

export type NetworkErrorCode =
  | 'account_connected'
  | 'authentication_failed'
  | 'campaign_not_found'
  | 'connection_cancelled'
  | 'connection_failed'
  | 'cooldown'
  | 'duplicate_username'
  | 'invalid_input'
  | 'permission_denied'
  | 'protocol_mismatch'
  | 'server_unavailable'
  | 'storage_error'
  | 'transport_lost'
  | 'trust_rejected'
  | 'udp_failed';

export interface NetworkError {
  code: NetworkErrorCode;
  message: string;
}

export type NetworkResult<T> = Result<T, NetworkError>;

export interface HostStatus {
  boundFamilies: Array<'IPv4' | 'IPv6'>;
  certificateFingerprint: string | null;
  connectedPlayerCount: number;
  effectivePort: number;
  localAddresses: string[];
  publicAddresses: string[];
  state: 'offline' | 'online';
}

export interface ManagedUserView {
  connected: boolean;
  hasPassword: boolean;
  id: string;
  username: string;
}

export interface ServerSettingsView {
  maxChatMessageCharacters: number;
  port: number;
  transformPreviewRate?: number;
  users: ManagedUserView[];
}

export interface OpenHostInput {
  campaignId: string;
}

export interface CampaignIdInput {
  campaignId: string;
}

export interface SetServerPortInput extends CampaignIdInput {
  port: number;
}

export interface SetTransformPreviewRateInput extends CampaignIdInput {
  transformPreviewRate: number;
}

export interface CreateManagedUserInput extends CampaignIdInput {
  password: string;
  username: string;
}

export interface UpdateManagedUsernameInput extends CampaignIdInput {
  userId: string;
  username: string;
}

export interface ResetManagedPasswordInput extends CampaignIdInput {
  password: string;
  userId: string;
}

export interface DeleteManagedUserInput extends CampaignIdInput {
  userId: string;
}

export interface ConnectInput {
  expectedCampaignId?: string;
  host: string;
  port: number;
}

export interface TrustChallenge {
  attemptId: string;
  campaignId: string;
  campaignName: string;
  kind: 'changed' | 'first_use';
  newFingerprint: string;
  oldFingerprint: string | null;
}

export interface AuthenticationUser {
  hasSavedPassword: boolean;
  id: string;
  username: string;
}

export interface AuthenticationChallenge {
  attemptId: string;
  campaignId: string;
  campaignName: string;
  users: AuthenticationUser[];
}

export type ConnectStep =
  | {
      state: 'authentication_required';
      challenge: AuthenticationChallenge;
    }
  | {
      state: 'trust_required';
      challenge: TrustChallenge;
    };

export interface AcceptTrustInput {
  attemptId: string;
}

export interface AuthenticateInput {
  attemptId: string;
  password?: string;
  useSavedPassword: boolean;
  userId: string;
}

export interface RemotePlaySession {
  campaignId: string;
  campaignName: string;
  host: string;
  port: number;
  role: 'player';
  source: 'remote';
  userId: string;
  username: string;
}

export interface CancelConnectionInput {
  attemptId: string;
}

export interface SavedConnectionProfile {
  hasSavedPassword: boolean;
  userId: string;
  username: string;
}

export interface SavedConnection {
  campaignId: string;
  campaignName: string;
  host: string;
  lastConnectedAt: string;
  lastUserId: string;
  port: number;
  profiles: SavedConnectionProfile[];
}

export interface DeleteHistoryInput {
  campaignId: string;
}

export type ClientConnectionState =
  | 'associating_udp'
  | 'authenticating'
  | 'connecting'
  | 'idle'
  | 'online'
  | 'recovering_udp'
  | 'trust_required';

export interface ClientStateEvent {
  state: ClientConnectionState;
}

export interface SessionClosedEvent {
  code: NetworkErrorCode;
  message: string;
}

export interface MapPing {
  campaignId: string;
  id: string;
  pullPlayers: boolean;
  sceneId: string;
  x: number;
  y: number;
}

export interface MeasurementPoint {
  x: number;
  y: number;
}

/** Complete, ephemeral ruler state emitted by a renderer. */
export interface MeasurementUpdate {
  active: boolean;
  campaignId: string;
  measurementId: string;
  points: MeasurementPoint[];
  sceneId: string;
  updateSequence: number;
}

/** A host-authenticated ruler snapshot received from another participant. */
export interface MeasurementEvent extends MeasurementUpdate {
  sourceId: string;
}

/** Latest, deliberately compact live drawing snapshot. Durable drawings use TCP. */
export interface DrawingPreviewUpdate {
  active: boolean;
  campaignId: string;
  closed: boolean;
  kind: SceneDrawingKind;
  layer: SceneDrawingLayer;
  operationId: string;
  points: SceneDrawingPoint[];
  /** Start, fixed Polyline vertices, and cancellation are mirrored over TCP. */
  reliable?: boolean;
  sceneId: string;
  sequence: number;
  style: SceneDrawingStyle;
}

/** A host-authenticated live drawing snapshot received from a participant. */
export interface DrawingPreviewEvent extends DrawingPreviewUpdate {
  sourceId: string;
}

export interface NetworkApi {
  acceptTrust(
    input: AcceptTrustInput,
  ): Promise<NetworkResult<AuthenticationChallenge>>;
  authenticate(
    input: AuthenticateInput,
  ): Promise<NetworkResult<RemotePlaySession>>;
  cancelConnection(input: CancelConnectionInput): Promise<void>;
  clearChatHistory(
    input: ClearChatHistoryInput,
  ): Promise<ChatResult<ClearChatHistoryResult>>;
  connect(input: ConnectInput): Promise<NetworkResult<ConnectStep>>;
  createUser(
    input: CreateManagedUserInput,
  ): Promise<NetworkResult<ManagedUserView>>;
  deleteHistory(input: DeleteHistoryInput): Promise<NetworkResult<null>>;
  deleteUser(
    input: DeleteManagedUserInput,
  ): Promise<NetworkResult<null>>;
  disconnect(): Promise<void>;
  getChatBootstrap(
    input: CampaignIdInput,
  ): Promise<ChatResult<ChatBootstrap>>;
  getChatHistory(
    input: ChatHistoryInput,
  ): Promise<ChatResult<ChatHistoryPage>>;
  getHostStatus(): Promise<HostStatus>;
  getServerSettings(
    input: CampaignIdInput,
  ): Promise<NetworkResult<ServerSettingsView>>;
  listHistory(): Promise<NetworkResult<SavedConnection[]>>;
  onChatEvent(listener: (event: ChatEvent) => void): () => void;
  onClientStateChanged(listener: (event: ClientStateEvent) => void): () => void;
  onDrawingPreview(
    listener: (preview: DrawingPreviewEvent) => void,
  ): () => void;
  onHostStatusChanged(listener: (status: HostStatus) => void): () => void;
  onMapPing(listener: (ping: MapPing) => void): () => void;
  onMeasurementUpdate(
    listener: (update: MeasurementEvent) => void,
  ): () => void;
  onSessionClosed(listener: (event: SessionClosedEvent) => void): () => void;
  onTransformCancelled(
    listener: (input: SceneTransformPreviewCancel) => void,
  ): () => void;
  onTransformPreview(
    listener: (input: SceneTransformPreviewDelta) => void,
  ): () => void;
  onTransformStarted(
    listener: (input: SceneTransformPreviewStart) => void,
  ): () => void;
  openHost(input: OpenHostInput): Promise<NetworkResult<HostStatus>>;
  resetPassword(
    input: ResetManagedPasswordInput,
  ): Promise<NetworkResult<null>>;
  sendChatMessage(
    input: SendChatMessageInput,
  ): Promise<ChatResult<ChatMessage>>;
  setMaxChatMessageCharacters(
    input: SetMaxChatMessageCharactersInput,
  ): Promise<NetworkResult<number>>;
  setPort(input: SetServerPortInput): Promise<NetworkResult<number>>;
  setTransformPreviewRate(
    input: SetTransformPreviewRateInput,
  ): Promise<NetworkResult<number>>;
  sendMapPing(input: MapPing): Promise<void>;
  sendDrawingPreview(input: DrawingPreviewUpdate): Promise<void>;
  sendMeasurementUpdate(input: MeasurementUpdate): Promise<void>;
  stopHost(): Promise<void>;
  updateUsername(
    input: UpdateManagedUsernameInput,
  ): Promise<NetworkResult<ManagedUserView>>;
}
