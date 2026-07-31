import { EventEmitter } from 'node:events';
import type { TLSSocket } from 'node:tls';
import { describe, expect, it, vi } from 'vitest';
import { NETWORK_PROTOCOL_VERSION } from '../../shared/network';
import { TcpClientChannel } from './tcpClientChannel';
import { encodeFrame, type TcpEnvelope } from './tcpProtocol';

class FakeTlsSocket extends EventEmitter {
  destroy() {
    this.emit('close');
  }
}

function receive(socket: FakeTlsSocket, envelope: TcpEnvelope): void {
  socket.emit('data', encodeFrame(envelope));
}

describe('TcpClientChannel', () => {
  it('buffers spontaneous server events until the live session subscribes', () => {
    const socket = new FakeTlsSocket();
    const channel = new TcpClientChannel(socket as unknown as TLSSocket);
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
    const updateRateEnvelope = {
      payload: { updateRate: 90 },
      protocolVersion: NETWORK_PROTOCOL_VERSION,
      type: 'server.update_rate_changed',
    } as const;

    receive(socket, sceneEnvelope);
    receive(socket, pingEnvelope);
    receive(socket, updateRateEnvelope);

    const listener = vi.fn();
    channel.on('message', listener);
    expect(listener).not.toHaveBeenCalled();
    expect(channel.drainPendingEvents()).toEqual([
      sceneEnvelope,
      pingEnvelope,
      updateRateEnvelope,
    ]);
    expect(channel.drainPendingEvents()).toEqual([]);
  });

  it('delivers spontaneous events directly after subscription', () => {
    const socket = new FakeTlsSocket();
    const channel = new TcpClientChannel(socket as unknown as TLSSocket);
    const listener = vi.fn();
    const envelope = {
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
    channel.on('message', listener);

    receive(socket, envelope);

    expect(listener).toHaveBeenCalledWith(envelope);
    expect(channel.drainPendingEvents()).toEqual([]);
  });
});
