import dgram from 'node:dgram';
import type { Socket as UdpSocket } from 'node:dgram';
import type { TLSSocket } from 'node:tls';
import {
  decodeUdpPacket,
  encodeUdpPacket,
  ReplayWindow,
  udpMessageTypes,
  type UdpSessionCredentials,
} from './udpProtocol';

const UDP_ASSOCIATION_TIMEOUT_MS = 10_000;

/** A client's live UDP association with the host it is connected to. */
export interface AssociatedUdp {
  credentials: UdpSessionCredentials;
  lastReceivedAt: number;
  replay: ReplayWindow;
  sequence: bigint;
  socket: UdpSocket;
}

/**
 * Opens the UDP side channel alongside an established TCP connection and
 * blocks until the host acknowledges it. Associate packets are retried with
 * a widening backoff because UDP gives no delivery guarantee.
 */
export async function associateUdp(
  tcpSocket: TLSSocket,
  port: number,
  credentials: UdpSessionCredentials,
  timeout = UDP_ASSOCIATION_TIMEOUT_MS,
): Promise<AssociatedUdp> {
  const family = tcpSocket.remoteFamily === 'IPv6' ? 'udp6' : 'udp4';
  const address = tcpSocket.remoteAddress;
  if (!address) {
    throw new Error('TCP peer address is unavailable.');
  }
  const socket = dgram.createSocket(family);
  const replay = new ReplayWindow();
  let sequence = 0n;

  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.connect(port, address, () => {
      socket.off('error', reject);
      resolve();
    });
  });

  return new Promise((resolve, reject) => {
    let retryDelay = 250;
    let retryTimer: ReturnType<typeof setTimeout>;
    const deadline = setTimeout(() => {
      cleanup();
      socket.close();
      reject(new Error('UDP association timed out.'));
    }, timeout);

    const cleanup = () => {
      clearTimeout(deadline);
      clearTimeout(retryTimer);
      socket.off('message', onMessage);
      socket.off('error', onError);
    };
    const onError = (error: Error) => {
      cleanup();
      socket.close();
      reject(error);
    };
    const onMessage = (packet: Buffer) => {
      try {
        const decoded = decodeUdpPacket(
          packet,
          credentials.serverToClient,
        );
        if (
          decoded.type !== udpMessageTypes.acknowledge ||
          decoded.epoch !== credentials.epoch ||
          !decoded.sessionId.equals(credentials.sessionId) ||
          !replay.accept(decoded.sequence)
        ) {
          return;
        }
        cleanup();
        resolve({
          credentials,
          lastReceivedAt: Date.now(),
          replay,
          sequence,
          socket,
        });
      } catch {
        // Ignore unauthenticated packets while associating.
      }
    };
    const sendAssociate = () => {
      const packet = encodeUdpPacket(
        credentials.sessionId,
        credentials.epoch,
        sequence,
        udpMessageTypes.associate,
        credentials.clientToServer,
      );
      sequence += 1n;
      socket.send(packet);
      retryTimer = setTimeout(sendAssociate, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 2_000);
    };

    socket.on('message', onMessage);
    socket.on('error', onError);
    sendAssociate();
  });
}
