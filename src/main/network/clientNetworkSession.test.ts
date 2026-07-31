import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_TRANSFORM_PREVIEW_RATE,
  MIN_TRANSFORM_PREVIEW_RATE,
  NETWORK_PROTOCOL_VERSION,
} from '../../shared/network';
import type { TcpEnvelope } from './tcpProtocol';
import type { TcpClientChannel } from './tcpClientChannel';
import { ClientNetworkSession } from './clientNetworkSession';
import type { AssociatedUdp } from './udpAssociation';
import {
  decodeClientMeasurement,
  encodeServerMeasurement,
} from './measurementProtocol';
import {
  createUdpSessionCredentials,
  decodeUdpPacket,
  encodeUdpPacket,
  ReplayWindow,
  udpMessageTypes,
} from './udpProtocol';

class FakeChannel extends EventEmitter {
  constructor(private readonly pending: TcpEnvelope[]) {
    super();
  }

  close() {}

  drainPendingEvents(): TcpEnvelope[] {
    return this.pending.splice(0);
  }

  send() {}
}

describe('ClientNetworkSession', () => {
  it('replays a scene and ping that arrived before session startup in order', () => {
    const sceneEnvelope = {
      payload: { scene: null },
      protocolVersion: NETWORK_PROTOCOL_VERSION,
      type: 'server.scene_presented',
    } as const;
    const pingEnvelope = {
      payload: {
        id: '22222222-2222-4222-8222-222222222222',
        pullPlayers: true,
        sceneId: '11111111-1111-4111-8111-111111111111',
        x: 120,
        y: 240,
      },
      protocolVersion: NETWORK_PROTOCOL_VERSION,
      type: 'server.map_ping',
    } as const;
    const channel = new FakeChannel([sceneEnvelope, pingEnvelope]);
    const udpSocket = new EventEmitter() as EventEmitter & {
      close: () => void;
    };
    udpSocket.close = vi.fn();
    const received: string[] = [];
    const session = new ClientNetworkSession({
      channel: channel as unknown as TcpClientChannel,
      onAssetsChanged: vi.fn(),
      onClosed: vi.fn(),
      onMapPing: () => received.push('ping'),
      onScenePresented: () => received.push('scene'),
      onStateChanged: vi.fn(),
      port: 30_000,
      udp: {
        socket: udpSocket,
      } as unknown as AssociatedUdp,
      updateRate: 60,
    });

    session.start();

    expect(received).toEqual(['scene', 'ping']);
    session.close();
  });

  it('accepts ordered server measurements and clears them on shutdown', () => {
    const channel = new FakeChannel([]);
    const credentials = createUdpSessionCredentials();
    const udpSocket = new EventEmitter() as EventEmitter & {
      close: () => void;
      send: () => void;
    };
    udpSocket.close = vi.fn();
    udpSocket.send = vi.fn();
    const received: Array<{ active: boolean; updateSequence: number }> = [];
    const session = new ClientNetworkSession({
      channel: channel as unknown as TcpClientChannel,
      onAssetsChanged: vi.fn(),
      onClosed: vi.fn(),
      onMeasurementUpdate: (update) => received.push(update),
      onScenePresented: vi.fn(),
      onStateChanged: vi.fn(),
      port: 30_000,
      udp: {
        credentials,
        lastReceivedAt: Date.now(),
        replay: new ReplayWindow(),
        sequence: 0n,
        socket: udpSocket,
      } as unknown as AssociatedUdp,
      updateRate: 60,
    });
    session.start();
    const payload = encodeServerMeasurement({
      active: true,
      measurementId: '22222222-2222-4222-8222-222222222222',
      points: [{ x: 10, y: 20 }],
      sceneId: '33333333-3333-4333-8333-333333333333',
      sourceId: '44444444-4444-4444-8444-444444444444',
      updateSequence: 7,
    });
    udpSocket.emit(
      'message',
      encodeUdpPacket(
        credentials.sessionId,
        credentials.epoch,
        1n,
        udpMessageTypes.serverMeasurement,
        credentials.serverToClient,
        payload,
      ),
    );
    expect(received).toMatchObject([
      { active: true, updateSequence: 7 },
    ]);

    session.close();
    expect(received).toMatchObject([
      { active: true, updateSequence: 7 },
      { active: false, updateSequence: 8 },
    ]);
  });

  it('coalesces every outgoing measurement snapshot at the server update rate', () => {
    vi.useFakeTimers();
    const channel = new FakeChannel([]);
    const credentials = createUdpSessionCredentials();
    const udpSocket = new EventEmitter() as EventEmitter & {
      close: () => void;
      send: (packet: Buffer) => void;
    };
    udpSocket.close = vi.fn();
    udpSocket.send = vi.fn();
    const session = new ClientNetworkSession({
      channel: channel as unknown as TcpClientChannel,
      onAssetsChanged: vi.fn(),
      onClosed: vi.fn(),
      onScenePresented: vi.fn(),
      onStateChanged: vi.fn(),
      port: 30_000,
      udp: {
        credentials,
        lastReceivedAt: Date.now(),
        replay: new ReplayWindow(),
        sequence: 0n,
        socket: udpSocket,
      } as unknown as AssociatedUdp,
      updateRate: MIN_TRANSFORM_PREVIEW_RATE,
    });
    session.start();
    const snapshot = {
      active: true,
      measurementId: '22222222-2222-4222-8222-222222222222',
      points: [{ x: 10, y: 20 }],
      sceneId: '33333333-3333-4333-8333-333333333333',
      updateSequence: 1,
    };

    session.sendMeasurementUpdate(snapshot);
    session.sendMeasurementUpdate({
      ...snapshot,
      points: [{ x: 30, y: 40 }],
      updateSequence: 2,
    });
    session.sendMeasurementUpdate({
      ...snapshot,
      active: false,
      points: [],
      updateSequence: 3,
    });
    expect(udpSocket.send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(
      Math.ceil(1_000 / MIN_TRANSFORM_PREVIEW_RATE),
    );
    expect(udpSocket.send).toHaveBeenCalledTimes(2);
    const secondPacket = vi.mocked(udpSocket.send).mock.calls[1][0];
    expect(
      decodeClientMeasurement(
        decodeUdpPacket(secondPacket, credentials.clientToServer).payload,
      ),
    ).toMatchObject({ active: false, updateSequence: 3 });

    channel.emit('message', {
      payload: { updateRate: MAX_TRANSFORM_PREVIEW_RATE },
      protocolVersion: NETWORK_PROTOCOL_VERSION,
      type: 'server.update_rate_changed',
    } satisfies TcpEnvelope);
    session.sendMeasurementUpdate({
      ...snapshot,
      updateSequence: 4,
    });
    vi.advanceTimersByTime(
      Math.ceil(1_000 / MAX_TRANSFORM_PREVIEW_RATE),
    );
    expect(udpSocket.send).toHaveBeenCalledTimes(3);

    session.close();
  });
});
