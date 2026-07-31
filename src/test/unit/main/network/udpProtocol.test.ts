import { describe, expect, it } from 'vitest';
import {
  MAX_DRAWING_PREVIEW_POINTS,
  MAX_TRANSFORM_PREVIEW_RATE,
} from '../../../../shared/network';
import {
  createUdpSessionCredentials,
  decodeUdpPacket,
  encodeUdpPacket,
  ReplayWindow,
  TokenBucket,
  UDP_CLIENT_PACKET_BURST_LIMIT,
  UDP_CLIENT_PACKET_RATE_LIMIT,
  udpMessageTypes,
} from '../../../../main/network/udpProtocol';

describe('UDP protocol security primitives', () => {
  it('authenticates and decodes a directional datagram', () => {
    const credentials = createUdpSessionCredentials();
    const packet = encodeUdpPacket(
      credentials.sessionId,
      credentials.epoch,
      7n,
      udpMessageTypes.heartbeat,
      credentials.clientToServer,
      Buffer.from('payload'),
    );
    const decoded = decodeUdpPacket(packet, credentials.clientToServer);

    expect(decoded.sequence).toBe(7n);
    expect(decoded.type).toBe(udpMessageTypes.heartbeat);
    expect(decoded.payload.toString()).toBe('payload');

    const forged = Buffer.from(packet);
    forged[forged.length - 1] ^= 1;
    expect(() =>
      decodeUdpPacket(forged, credentials.clientToServer),
    ).toThrow();
    expect(() =>
      decodeUdpPacket(packet, credentials.serverToClient),
    ).toThrow();
  });

  it('rejects duplicates and packets outside a 64-sequence window', () => {
    const window = new ReplayWindow();
    expect(window.accept(10n)).toBe(true);
    expect(window.accept(10n)).toBe(false);
    expect(window.accept(9n)).toBe(true);
    expect(window.accept(75n)).toBe(true);
    expect(window.accept(10n)).toBe(false);
  });

  it('enforces a burst and refills at the configured rate', () => {
    const bucket = new TokenBucket(2, 3, 1_000);
    expect([bucket.take(1_000), bucket.take(1_000), bucket.take(1_000)]).toEqual(
      [true, true, true],
    );
    expect(bucket.take(1_000)).toBe(false);
    expect(bucket.take(1_500)).toBe(true);
  });

  it('allows the maximum configured update rate plus control traffic', () => {
    const bucket = new TokenBucket(
      UDP_CLIENT_PACKET_RATE_LIMIT,
      UDP_CLIENT_PACKET_BURST_LIMIT,
      0,
    );
    for (
      let packet = 0;
      packet < UDP_CLIENT_PACKET_BURST_LIMIT;
      packet += 1
    ) {
      expect(bucket.take(0)).toBe(true);
    }
    expect(bucket.take(0)).toBe(false);

    for (
      let packet = 1;
      packet <= MAX_TRANSFORM_PREVIEW_RATE;
      packet += 1
    ) {
      const receivedAt = Math.ceil(
        (packet * 1_000) / MAX_TRANSFORM_PREVIEW_RATE,
      );
      expect(bucket.take(receivedAt)).toBe(true);
      if (packet === 60) {
        expect(bucket.take(receivedAt)).toBe(true);
      }
    }
  });

  it('rejects oversized datagrams and sequence rollover', () => {
    const credentials = createUdpSessionCredentials();
    const encode = (sequence: bigint, payload = Buffer.alloc(0)) =>
      encodeUdpPacket(
        credentials.sessionId,
        credentials.epoch,
        sequence,
        udpMessageTypes.heartbeat,
        credentials.clientToServer,
        payload,
      );

    expect(() => encode(-1n)).toThrow(/64-bit range/i);
    expect(() => encode(1n << 64n)).toThrow(/64-bit range/i);
    expect(() => encode(0n, Buffer.alloc(1_200))).toThrow(
      /maximum datagram size/i,
    );
  });

  it('keeps a 2,048-object group preview compact by sending one similarity delta', () => {
    const credentials = createUdpSessionCredentials();
    const payload = Buffer.from(
      JSON.stringify({
        dx: 12.25,
        dy: -8.5,
        operationId: '33333333-3333-4333-8333-333333333333',
        rotation: 15,
        scaleX: 1.25,
        scaleY: 1.25,
      }),
    );
    const packet = encodeUdpPacket(
      credentials.sessionId,
      credentials.epoch,
      1n,
      udpMessageTypes.transformPreview,
      credentials.serverToClient,
      payload,
    );

    expect(packet.length).toBeLessThan(1_200);
    expect(
      decodeUdpPacket(packet, credentials.serverToClient).payload,
    ).toEqual(payload);
  });

  it('keeps a maximum live drawing snapshot below the datagram safety limit', () => {
    const credentials = createUdpSessionCredentials();
    const payload = Buffer.from(
      JSON.stringify({
        active: true,
        closed: false,
        kind: 'freeform',
        layer: 'token',
        operationId: '33333333-3333-4333-8333-333333333333',
        points: Array.from(
          { length: MAX_DRAWING_PREVIEW_POINTS },
          (_, index) => ({ x: index * 12.5, y: index * -6.25 }),
        ),
        sceneId: '11111111-1111-4111-8111-111111111111',
        sequence: 42,
        style: {
          edge: 'soft',
          fillColor: '#ffffff',
          fillEnabled: false,
          fillOpacity: 0.25,
          hardness: 0.25,
          strokeColor: '#ffffff',
          strokeOpacity: 1,
          strokeWidth: 256,
        },
      }),
    );

    const packet = encodeUdpPacket(
      credentials.sessionId,
      credentials.epoch,
      2n,
      udpMessageTypes.clientDrawingPreview,
      credentials.clientToServer,
      payload,
    );

    expect(packet.length).toBeLessThan(1_200);
  });
});
