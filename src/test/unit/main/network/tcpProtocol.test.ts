import { describe, expect, it } from 'vitest';
import { NETWORK_PROTOCOL_VERSION } from '../../../../shared/network';
import {
  createDefaultGrid,
  createEmptyDrawingLayers,
  createEmptyImageLayers,
  createEmptyTextLayers,
} from '../../../../shared/scenes';
import {
  encodeFrame,
  FrameDecoder,
  MAX_TCP_MESSAGE_BYTES,
  parsePayload,
} from '../../../../main/network/tcpProtocol';

describe('TCP protocol framing', () => {
  const envelope = {
    payload: { campaignId: '11111111-1111-4111-8111-111111111111' },
    protocolVersion: NETWORK_PROTOCOL_VERSION,
    type: 'client.trust_accepted',
  } as const;

  it('decodes fragmented and coalesced frames', () => {
    const first = encodeFrame(envelope);
    const second = encodeFrame({ ...envelope, requestId: 'second' });
    const combined = Buffer.concat([first, second]);
    const decoder = new FrameDecoder();

    expect(decoder.push(combined.subarray(0, 3))).toEqual([]);
    expect(decoder.push(combined.subarray(3, first.length + 2))).toEqual([
      envelope,
    ]);
    expect(decoder.push(combined.subarray(first.length + 2))).toEqual([
      { ...envelope, requestId: 'second' },
    ]);
  });

  it('rejects oversized and invalid frames', () => {
    const decoder = new FrameDecoder();
    const invalid = Buffer.alloc(4);
    invalid.writeUInt32BE(MAX_TCP_MESSAGE_BYTES + 1);
    expect(() => decoder.push(invalid)).toThrow(/frame length/i);

    const wrongVersionSource = Buffer.from(
      JSON.stringify({
        ...envelope,
        protocolVersion: NETWORK_PROTOCOL_VERSION + 1,
      }),
    );
    const wrongVersion = Buffer.alloc(4 + wrongVersionSource.length);
    wrongVersion.writeUInt32BE(wrongVersionSource.length);
    wrongVersionSource.copy(wrongVersion, 4);
    expect(() => new FrameDecoder().push(wrongVersion)).toThrow();

    const invalidJson = Buffer.from('{not-json', 'utf8');
    const invalidJsonFrame = Buffer.alloc(4 + invalidJson.length);
    invalidJsonFrame.writeUInt32BE(invalidJson.length);
    invalidJson.copy(invalidJsonFrame, 4);
    expect(() => new FrameDecoder().push(invalidJsonFrame)).toThrow(
      /invalid JSON/i,
    );
  });
});

describe('chat protocol messages', () => {
  const send = {
    clientMessageId: '22222222-2222-4222-8222-222222222222',
    content: 'hello',
    recipient: {
      kind: 'player',
      userId: '33333333-3333-4333-8333-333333333333',
    },
  } as const;

  it('accepts the narrow send payload and rejects spoofed authority', () => {
    expect(parsePayload('client.chat_send', send)).toEqual(send);
    expect(() =>
      parsePayload('client.chat_send', {
        ...send,
        sender: { kind: 'gm' },
      }),
    ).toThrow();
    expect(() =>
      parsePayload('client.chat_send', {
        ...send,
        acceptedAt: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it('enforces the normalized UTF-8 byte ceiling independently of code units', () => {
    expect(() =>
      parsePayload('client.chat_send', {
        ...send,
        content: '😀'.repeat(131_073),
      }),
    ).toThrow(/encoded size/i);
  });
});

describe('server.scene_presented', () => {
  const scene = {
    createdAt: '2026-07-28T00:00:00.000Z',
    distance: 5,
    drawings: createEmptyDrawingLayers(),
    grid: createDefaultGrid(),
    height: 1080,
    id: '11111111-1111-4111-8111-111111111111',
    images: createEmptyImageLayers(),
    texts: createEmptyTextLayers(),
    mapImage: {
      assetId: '22222222-2222-4222-8222-222222222222',
      height: 1080,
      rotation: 0,
      width: 1920,
      x: 0,
      y: 0,
    },
    name: 'Iron Keep',
    pixelScale: 70,
    revision: 3,
    unit: 'ft',
    updatedAt: '2026-07-28T00:00:00.000Z',
    width: 1920,
  };

  it('round-trips a presented scene and a cleared one', () => {
    expect(parsePayload('server.scene_presented', { scene })).toEqual({
      scene,
    });
    expect(parsePayload('server.scene_presented', { scene: null })).toEqual({
      scene: null,
    });
  });

  it('rejects scenes that break the documented bounds', () => {
    expect(() =>
      parsePayload('server.scene_presented', {
        scene: { ...scene, width: 0 },
      }),
    ).toThrow();
    expect(() =>
      parsePayload('server.scene_presented', {
        scene: { ...scene, grid: { ...scene.grid, color: 'white' } },
      }),
    ).toThrow();
    expect(() =>
      parsePayload('server.scene_presented', {
        scene: { ...scene, grid: { ...scene.grid, opacity: 2 } },
      }),
    ).toThrow();
    expect(() =>
      parsePayload('server.scene_presented', {
        scene: { ...scene, unexpected: true },
      }),
    ).toThrow();
  });

  it('stays well inside the frame size limit', () => {
    const frame = encodeFrame({
      payload: { scene },
      protocolVersion: NETWORK_PROTOCOL_VERSION,
      type: 'server.scene_presented',
    });

    expect(frame.length).toBeLessThan(MAX_TCP_MESSAGE_BYTES);
  });
});

describe('server.scene_transform_started', () => {
  it('validates the reliable transform lifecycle baseline', () => {
    const payload = {
      kind: 'resize',
      operationId: '33333333-3333-4333-8333-333333333333',
      pivotX: 100,
      pivotY: 200,
      revision: 7,
      sceneId: '11111111-1111-4111-8111-111111111111',
      startingTransforms: [
        {
          id: 'canonical-map',
          transform: {
            height: 100,
            rotation: 15,
            width: 200,
            x: 100,
            y: 200,
          },
        },
      ],
      targets: ['canonical-map'],
    } as const;

    expect(parsePayload('server.scene_transform_started', payload)).toEqual(
      payload,
    );
    expect(() =>
      parsePayload('server.scene_transform_started', {
        ...payload,
        startingTransforms: [
          { ...payload.startingTransforms[0], transform: { x: Infinity } },
        ],
      }),
    ).toThrow();
  });
});

describe('drawing preview lifecycle messages', () => {
  it('round-trips reliable starts and host-authenticated Polyline vertices', () => {
    const preview = {
      active: true,
      closed: false,
      kind: 'polyline',
      layer: 'token',
      operationId: '33333333-3333-4333-8333-333333333333',
      points: [{ x: 100, y: 200 }, { x: 150, y: 250 }],
      reliable: true,
      sceneId: '11111111-1111-4111-8111-111111111111',
      sequence: 2,
      style: {
        edge: 'hard',
        fillColor: '#ffffff',
        fillEnabled: false,
        fillOpacity: 0.25,
        hardness: 1,
        strokeColor: '#ffffff',
        strokeOpacity: 1,
        strokeWidth: 6,
      },
    } as const;

    expect(parsePayload('client.scene_drawing_preview', preview)).toEqual(
      preview,
    );
    expect(() =>
      parsePayload('client.scene_drawing_preview', {
        ...preview,
        style: { ...preview.style, hardness: 1.1 },
      }),
    ).toThrow();
    expect(
      parsePayload('server.scene_drawing_preview', {
        ...preview,
        sourceId: '22222222-2222-4222-8222-222222222222',
      }),
    ).toEqual({
      ...preview,
      sourceId: '22222222-2222-4222-8222-222222222222',
    });
    expect(() =>
      parsePayload('client.scene_drawing_preview', {
        ...preview,
        points: [],
      }),
    ).toThrow();
  });
});

describe('map ping messages', () => {
  const ping = {
    id: '22222222-2222-4222-8222-222222222222',
    pullPlayers: true,
    sceneId: '11111111-1111-4111-8111-111111111111',
    x: 120.5,
    y: 240.25,
  };

  it('round-trips reliable client and server payloads', () => {
    expect(parsePayload('client.map_ping', ping)).toEqual(ping);
    expect(parsePayload('server.map_ping', ping)).toEqual(ping);
  });

  it('rejects malformed identifiers and non-finite coordinates', () => {
    expect(() =>
      parsePayload('client.map_ping', { ...ping, id: 'not-a-uuid' }),
    ).toThrow();
    expect(() =>
      parsePayload('server.map_ping', { ...ping, x: Infinity }),
    ).toThrow();
  });
});
