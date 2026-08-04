import { describe, expect, it } from 'vitest';
import { NETWORK_PROTOCOL_VERSION } from '../../../../shared/network';
import { defaultJournalTitleStyle } from '../../../../shared/journal';
import {
  createDefaultFog,
  createDefaultGrid,
  createEmptyDrawingLayers,
  createEmptyImageLayers,
  createEmptyShapeLayers,
  createEmptyTextLayers,
} from '../../../../shared/scenes';
import {
  encodeFrame,
  FrameDecoder,
  MAX_TCP_MESSAGE_BYTES,
  parsePayload,
} from '../../../../main/network/tcpProtocol';
import { TEST_CAMPAIGN_SYSTEM } from '../../../support/gameSystems';

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

  it('accepts only roll definitions from clients and validates recursive results from hosts', () => {
    const definition = {
      category: 'Roll',
      sections: [
        { label: '1d20', modifiers: [], notation: '1d20', typeLabel: null },
      ],
      title: null,
    };
    const request = {
      clientMessageId: send.clientMessageId,
      definition,
      recipient: null,
    };
    expect(parsePayload('client.chat_roll', request)).toEqual(request);
    expect(() =>
      parsePayload('client.chat_roll', {
        ...request,
        sender: { kind: 'gm' },
        total: 20,
      }),
    ).toThrow();

    const message = {
      acceptedAt: new Date().toISOString(),
      clientMessageId: send.clientMessageId,
      generation: '44444444-4444-4444-8444-444444444444',
      id: '55555555-5555-4555-8555-555555555555',
      payload: {
        card: {
          ...definition,
          sections: [
            {
              ...definition.sections[0],
              baseTotal: 20,
              expression: [
                {
                  dieKind: 'standard',
                  kind: 'die',
                  max: 20,
                  min: 1,
                  notation: '1d20',
                  results: [
                    {
                      calculationValue: 20,
                      initialValue: 20,
                      modifiers: [],
                      useInTotal: true,
                      value: 20,
                    },
                  ],
                  sides: 20,
                },
              ],
              total: 20,
            },
          ],
          version: 1,
        },
        kind: 'roll',
      },
      recipient: null,
      sender: { displayName: 'Game Master', kind: 'gm' },
      sequence: 1,
    };
    expect(parsePayload('server.chat_roll_result', message)).toEqual(message);
    expect(() =>
      parsePayload('server.chat_roll_result', {
        ...message,
        payload: {
          ...message.payload,
          card: {
            ...message.payload.card,
            sections: [
              {
                ...message.payload.card.sections[0],
                expression: [{ children: 'spoofed', kind: 'group' }],
              },
            ],
          },
        },
      }),
    ).toThrow();
  });
});

describe('campaign system protocol messages', () => {
  it('requires system state in both handshake messages', () => {
    const campaign = {
      campaignId: '11111111-1111-4111-8111-111111111111',
      campaignName: 'Iron Meridian',
      system: TEST_CAMPAIGN_SYSTEM,
    };
    expect(
      parsePayload('server.hello', {
        ...campaign,
        protocolVersion: NETWORK_PROTOCOL_VERSION,
      }),
    ).toEqual({
      ...campaign,
      protocolVersion: NETWORK_PROTOCOL_VERSION,
    });
    expect(
      parsePayload('server.ready', {
        ...campaign,
        updateRate: 60,
        userId: '22222222-2222-4222-8222-222222222222',
        username: 'Alice',
      }),
    ).toMatchObject({ ...campaign, username: 'Alice' });
    expect(() =>
      parsePayload('server.hello', {
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        protocolVersion: NETWORK_PROTOCOL_VERSION,
      }),
    ).toThrow();
  });
});

describe('Journal protocol messages', () => {
  it('keeps page mutations explicit and rejects actor or campaign spoofing', () => {
    const input = {
      content: { doc: { content: [{ type: 'paragraph' }], type: 'doc' }, schemaVersion: 1 },
      entryId: '11111111-1111-4111-8111-111111111111',
      expectedRevision: 2,
      leaseId: '22222222-2222-4222-8222-222222222222',
      pageId: '33333333-3333-4333-8333-333333333333',
      title: 'Treasure',
      titleStyle: defaultJournalTitleStyle(),
    } as const;
    expect(parsePayload('client.journal_update_page', input)).toEqual(input);
    expect(() => parsePayload('client.journal_update_page', {
      ...input,
      actor: { kind: 'gm' },
    })).toThrow();
    expect(() => parsePayload('client.journal_update_page', {
      ...input,
      campaignId: '44444444-4444-4444-8444-444444444444',
    })).toThrow();
  });

  it('rejects remote image nodes before they reach the host repository', () => {
    expect(() => parsePayload('client.journal_update_page', {
      content: {
        doc: { content: [{ attrs: { src: 'https://example.com/map.png' }, type: 'image' }], type: 'doc' },
        schemaVersion: 1,
      },
      entryId: '11111111-1111-4111-8111-111111111111',
      expectedRevision: 0,
      leaseId: '22222222-2222-4222-8222-222222222222',
      pageId: '33333333-3333-4333-8333-333333333333',
      title: 'Map',
    })).toThrow();
  });

  it('does not let the explicit page-delete operation target a parent note', () => {
    expect(() => parsePayload('client.journal_delete_page', {
      cleanupAssetIds: [],
      expectedRevision: 0,
      target: {
        entryId: '11111111-1111-4111-8111-111111111111',
        kind: 'note',
      },
    })).toThrow();
  });
});

describe('server.scene_presented', () => {
  const scene = {
    createdAt: '2026-07-28T00:00:00.000Z',
    distance: 5,
    drawings: createEmptyDrawingLayers(),
    fog: createDefaultFog(),
    grid: createDefaultGrid(),
    height: 1080,
    id: '11111111-1111-4111-8111-111111111111',
    images: createEmptyImageLayers(),
    shapes: createEmptyShapeLayers(),
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
    objectOrder: { gm: [], map: [], token: [] },
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

describe('client.scene_objects_set arrangements', () => {
  const targetId = '22222222-2222-4222-8222-222222222222';
  const state = {
    drawings: createEmptyDrawingLayers(),
    images: createEmptyImageLayers(),
    mapImage: null,
    objectOrder: { gm: [], map: [], token: [] },
    shapes: createEmptyShapeLayers(),
    texts: createEmptyTextLayers(),
  };
  const payload = {
    arrangement: {
      direction: 'front',
      kind: 'reorder',
      targets: [targetId],
    },
    expectedRevision: 3,
    operationId: '33333333-3333-4333-8333-333333333333',
    sceneId: '11111111-1111-4111-8111-111111111111',
    state,
  } as const;

  it('validates explicit arrangement variants and rejects spoofed or duplicate fields', () => {
    expect(parsePayload('client.scene_objects_set', payload)).toEqual(payload);
    expect(parsePayload('client.scene_objects_set', {
      ...payload,
      arrangement: {
        kind: 'move-layer',
        targetLayer: 'gm',
        targets: [targetId],
      },
    })).toMatchObject({ arrangement: { kind: 'move-layer', targetLayer: 'gm' } });
    expect(() => parsePayload('client.scene_objects_set', {
      ...payload,
      actor: { kind: 'gm' },
    })).toThrow();
    expect(() => parsePayload('client.scene_objects_set', {
      ...payload,
      arrangement: {
        ...payload.arrangement,
        targets: [targetId, targetId],
      },
    })).toThrow(/unique/i);
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
