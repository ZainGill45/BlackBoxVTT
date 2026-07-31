import type { RemoteInfo } from 'node:dgram';
import type { TLSSocket } from 'node:tls';
import type { AssetActor } from '../../shared/assets';
import type { FrameDecoder } from './tcpProtocol';
import type { ReplayWindow, TokenBucket, UdpSessionCredentials } from './udpProtocol';
import type { StoredManagedUser } from './serverConfigRepository';

export type HostClientState =
  | 'awaiting_auth'
  | 'awaiting_trust'
  | 'awaiting_udp'
  | 'ready';

/** A file a player is streaming to the host, chunk by chunk. */
export interface HostAssetUpload {
  directory: string;
  displayName: string;
  filePath: string;
  originalFilename: string;
  receivedBytes: number;
  sizeBytes: number;
}

/** One connected player, from the TLS handshake until the socket closes. */
export interface HostClient {
  controlRateBucket: TokenBucket;
  decoder: FrameDecoder;
  epoch: number;
  handshakeTimer: ReturnType<typeof setTimeout>;
  lastMapPingAt: number;
  lastMeasurementSequence: number;
  lastPingAt: number;
  lastPongAt: number;
  lastUdpAt: number;
  pendingPingNonce: string | null;
  processing: Promise<void>;
  interactiveRateBucket: TokenBucket;
  remoteAddress: string;
  replayWindow: ReplayWindow;
  serverSequence: bigint;
  socket: TLSSocket;
  state: HostClientState;
  udpCredentials: UdpSessionCredentials | null;
  udpEndpoint: RemoteInfo | null;
  udpRecoveryStartedAt: number | null;
  user: StoredManagedUser | null;
  uploads: Map<string, HostAssetUpload>;
}

/** The subject an asset policy decision is made about. */
export function actorFor(client: HostClient): AssetActor {
  return {
    id: client.user?.id ?? 'unknown',
    role: 'player',
  };
}
