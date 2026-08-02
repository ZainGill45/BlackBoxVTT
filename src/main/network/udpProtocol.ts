import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import { MAX_TRANSFORM_PREVIEW_RATE } from '../../shared/network';

const UDP_MAGIC = Buffer.from('BBVT', 'ascii');
const UDP_HEADER_BYTES = 34;
const UDP_AUTH_TAG_BYTES = 16;
const MAX_UINT64 = (1n << 64n) - 1n;
export const MAX_UDP_DATAGRAM_BYTES = 1_200;
export const UDP_PROTOCOL_VERSION = 4;
export const UDP_CLIENT_PACKET_RATE_LIMIT =
  MAX_TRANSFORM_PREVIEW_RATE + 10;
export const UDP_CLIENT_PACKET_BURST_LIMIT =
  UDP_CLIENT_PACKET_RATE_LIMIT * 2;

export const udpMessageTypes = {
  acknowledge: 2,
  associate: 1,
  heartbeat: 3,
  heartbeatAcknowledge: 4,
  transformPreview: 5,
  clientMeasurement: 6,
  serverMeasurement: 7,
  clientTransformPreview: 8,
  clientDrawingPreview: 9,
  serverDrawingPreview: 10,
  clientShapePreview: 11,
  serverShapePreview: 12,
} as const;

type UdpMessageType =
  (typeof udpMessageTypes)[keyof typeof udpMessageTypes];

interface UdpDirectionCredentials {
  key: Buffer;
  noncePrefix: Buffer;
}

export interface UdpSessionCredentials {
  clientToServer: UdpDirectionCredentials;
  epoch: number;
  serverToClient: UdpDirectionCredentials;
  sessionId: Buffer;
}

interface DecodedUdpPacket {
  epoch: number;
  payload: Buffer;
  sequence: bigint;
  sessionId: Buffer;
  type: UdpMessageType;
}

function isUdpMessageType(value: number): value is UdpMessageType {
  return Object.values(udpMessageTypes).includes(value as UdpMessageType);
}

function createNonce(prefix: Buffer, sequence: bigint): Buffer {
  if (prefix.length !== 4) {
    throw new Error('UDP nonce prefix must be four bytes.');
  }

  const nonce = Buffer.allocUnsafe(12);
  prefix.copy(nonce, 0);
  nonce.writeBigUInt64BE(sequence, 4);
  return nonce;
}

export function createUdpSessionCredentials(
  epoch = 0,
): UdpSessionCredentials {
  return {
    clientToServer: {
      key: randomBytes(32),
      noncePrefix: randomBytes(4),
    },
    epoch,
    serverToClient: {
      key: randomBytes(32),
      noncePrefix: randomBytes(4),
    },
    sessionId: randomBytes(16),
  };
}

export function encodeUdpPacket(
  sessionId: Buffer,
  epoch: number,
  sequence: bigint,
  type: UdpMessageType,
  credentials: UdpDirectionCredentials,
  payload: Buffer<ArrayBufferLike> = Buffer.alloc(0),
): Buffer {
  if (sessionId.length !== 16) {
    throw new Error('UDP session ID must be 16 bytes.');
  }
  if (sequence < 0n || sequence > MAX_UINT64) {
    throw new Error('UDP sequence number is outside the 64-bit range.');
  }
  if (!Number.isInteger(epoch) || epoch < 0 || epoch > 0xffff_ffff) {
    throw new Error('UDP epoch is outside the 32-bit range.');
  }

  const header = Buffer.allocUnsafe(UDP_HEADER_BYTES);
  UDP_MAGIC.copy(header, 0);
  header.writeUInt8(UDP_PROTOCOL_VERSION, 4);
  header.writeUInt8(type, 5);
  header.writeUInt32BE(epoch, 6);
  sessionId.copy(header, 10);
  header.writeBigUInt64BE(sequence, 26);

  const cipher = createCipheriv(
    'aes-256-gcm',
    credentials.key,
    createNonce(credentials.noncePrefix, sequence),
    { authTagLength: UDP_AUTH_TAG_BYTES },
  );
  cipher.setAAD(header);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const packet = Buffer.concat([header, ciphertext, cipher.getAuthTag()]);

  if (packet.length > MAX_UDP_DATAGRAM_BYTES) {
    throw new Error('UDP packet exceeds the maximum datagram size.');
  }

  return packet;
}

export function decodeUdpPacket(
  packet: Buffer,
  credentials: UdpDirectionCredentials,
): DecodedUdpPacket {
  if (
    packet.length < UDP_HEADER_BYTES + UDP_AUTH_TAG_BYTES ||
    packet.length > MAX_UDP_DATAGRAM_BYTES ||
    !packet.subarray(0, UDP_MAGIC.length).equals(UDP_MAGIC) ||
    packet.readUInt8(4) !== UDP_PROTOCOL_VERSION
  ) {
    throw new Error('Invalid UDP packet header.');
  }

  const type = packet.readUInt8(5);
  if (!isUdpMessageType(type)) {
    throw new Error('Unsupported UDP message type.');
  }

  const epoch = packet.readUInt32BE(6);
  const sessionId = packet.subarray(10, 26);
  const sequence = packet.readBigUInt64BE(26);
  const ciphertext = packet.subarray(
    UDP_HEADER_BYTES,
    packet.length - UDP_AUTH_TAG_BYTES,
  );
  const authTag = packet.subarray(packet.length - UDP_AUTH_TAG_BYTES);
  const header = packet.subarray(0, UDP_HEADER_BYTES);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    credentials.key,
    createNonce(credentials.noncePrefix, sequence),
    { authTagLength: UDP_AUTH_TAG_BYTES },
  );
  decipher.setAAD(header);
  decipher.setAuthTag(authTag);
  const payload = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return { epoch, payload, sequence, sessionId, type };
}

export class ReplayWindow {
  private highest: bigint | null = null;
  private seen = 0n;

  accept(sequence: bigint): boolean {
    if (this.highest === null) {
      this.highest = sequence;
      this.seen = 1n;
      return true;
    }

    if (sequence > this.highest) {
      const shift = sequence - this.highest;
      this.seen =
        shift >= 64n ? 1n : ((this.seen << shift) | 1n) & ((1n << 64n) - 1n);
      this.highest = sequence;
      return true;
    }

    const distance = this.highest - sequence;
    if (distance >= 64n) {
      return false;
    }

    const bit = 1n << distance;
    if ((this.seen & bit) !== 0n) {
      return false;
    }

    this.seen |= bit;
    return true;
  }
}

export class TokenBucket {
  private lastRefill: number;
  private tokens: number;

  constructor(
    private readonly ratePerSecond = UDP_CLIENT_PACKET_RATE_LIMIT,
    private readonly capacity = UDP_CLIENT_PACKET_BURST_LIMIT,
    now = Date.now(),
  ) {
    this.lastRefill = now;
    this.tokens = capacity;
  }

  take(now = Date.now()): boolean {
    const elapsedSeconds = Math.max(0, now - this.lastRefill) / 1_000;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsedSeconds * this.ratePerSecond,
    );
    this.lastRefill = now;

    if (this.tokens < 1) {
      return false;
    }

    this.tokens -= 1;
    return true;
  }
}

export function serializeUdpCredentials(
  credentials: UdpSessionCredentials,
) {
  return {
    clientToServerKey: credentials.clientToServer.key.toString('base64url'),
    clientToServerNoncePrefix:
      credentials.clientToServer.noncePrefix.toString('base64url'),
    epoch: credentials.epoch,
    serverToClientKey: credentials.serverToClient.key.toString('base64url'),
    serverToClientNoncePrefix:
      credentials.serverToClient.noncePrefix.toString('base64url'),
    sessionId: credentials.sessionId.toString('base64url'),
  };
}

export function deserializeUdpCredentials(input: {
  clientToServerKey: string;
  clientToServerNoncePrefix: string;
  epoch: number;
  serverToClientKey: string;
  serverToClientNoncePrefix: string;
  sessionId: string;
}): UdpSessionCredentials {
  const credentials: UdpSessionCredentials = {
    clientToServer: {
      key: Buffer.from(input.clientToServerKey, 'base64url'),
      noncePrefix: Buffer.from(
        input.clientToServerNoncePrefix,
        'base64url',
      ),
    },
    epoch: input.epoch,
    serverToClient: {
      key: Buffer.from(input.serverToClientKey, 'base64url'),
      noncePrefix: Buffer.from(
        input.serverToClientNoncePrefix,
        'base64url',
      ),
    },
    sessionId: Buffer.from(input.sessionId, 'base64url'),
  };

  if (
    credentials.clientToServer.key.length !== 32 ||
    credentials.serverToClient.key.length !== 32 ||
    credentials.clientToServer.noncePrefix.length !== 4 ||
    credentials.serverToClient.noncePrefix.length !== 4 ||
    credentials.sessionId.length !== 16
  ) {
    throw new Error('Invalid UDP credentials.');
  }

  return credentials;
}
