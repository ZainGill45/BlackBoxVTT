import { describe, expect, it } from 'vitest';
import { MAX_MEASUREMENT_POINTS } from '../../shared/network';
import {
  createUdpSessionCredentials,
  decodeUdpPacket,
  encodeUdpPacket,
  udpMessageTypes,
} from './udpProtocol';
import {
  decodeClientMeasurement,
  decodeServerMeasurement,
  encodeClientMeasurement,
  encodeServerMeasurement,
} from './measurementProtocol';

const update = {
  active: true,
  measurementId: '22222222-2222-4222-8222-222222222222',
  points: [
    { x: 10.5, y: 20.25 },
    { x: 100, y: 200 },
  ],
  sceneId: '33333333-3333-4333-8333-333333333333',
  updateSequence: 42,
};

describe('measurement UDP codec', () => {
  it('round-trips complete client and authenticated server snapshots', () => {
    expect(decodeClientMeasurement(encodeClientMeasurement(update))).toEqual(
      update,
    );
    const serverUpdate = {
      ...update,
      sourceId: '44444444-4444-4444-8444-444444444444',
    };
    expect(decodeServerMeasurement(encodeServerMeasurement(serverUpdate))).toEqual(
      serverUpdate,
    );
  });

  it('encodes the maximum path below the encrypted datagram ceiling', () => {
    const credentials = createUdpSessionCredentials();
    const payload = encodeServerMeasurement({
      ...update,
      points: Array.from(
        { length: MAX_MEASUREMENT_POINTS },
        (_, index) => ({ x: index * 100.25, y: index * 50.5 }),
      ),
      sourceId: '44444444-4444-4444-8444-444444444444',
    });
    const packet = encodeUdpPacket(
      credentials.sessionId,
      credentials.epoch,
      1n,
      udpMessageTypes.serverMeasurement,
      credentials.serverToClient,
      payload,
    );
    expect(packet.length).toBeLessThanOrEqual(1_200);
    expect(
      decodeServerMeasurement(
        decodeUdpPacket(packet, credentials.serverToClient).payload,
      ).points,
    ).toHaveLength(MAX_MEASUREMENT_POINTS);
  });

  it('rejects malformed cardinality, flags, UUIDs, and non-finite points', () => {
    expect(() =>
      encodeClientMeasurement({ ...update, active: false }),
    ).toThrow();
    expect(() =>
      encodeClientMeasurement({
        ...update,
        measurementId: 'not-a-uuid',
      }),
    ).toThrow();
    expect(() =>
      encodeClientMeasurement({
        ...update,
        points: [{ x: Infinity, y: 0 }],
      }),
    ).toThrow();
    const payload = encodeClientMeasurement(update);
    payload.writeUInt8(2, 0);
    expect(() => decodeClientMeasurement(payload)).toThrow();
  });
});
