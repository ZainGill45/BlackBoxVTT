import { describe, expect, it } from 'vitest';
import {
  decodeClientDrawingPreview,
  decodeClientShapePreview,
  decodeServerDrawingPreview,
  decodeServerFogPreview,
  decodeServerShapePreview,
  decodeTransformPreview,
  encodeClientDrawingPreview,
  encodeServerDrawingPreview,
  encodeServerFogPreview,
  encodeClientShapePreview,
  encodeServerShapePreview,
  encodeTransformPreview,
} from '../../../../main/network/sceneRealtimeProtocol';

const style = {
  edge: 'hard' as const,
  fillColor: '#000000',
  fillEnabled: false,
  fillOpacity: 0.25,
  hardness: 1,
  strokeColor: '#ffffff',
  strokeOpacity: 1,
  strokeWidth: 6,
};

const clientDrawing = {
  active: true,
  closed: false,
  kind: 'freeform' as const,
  layer: 'token' as const,
  operationId: '44444444-4444-4444-8444-444444444444',
  points: [{ x: 10, y: 20 }],
  sceneId: '55555555-5555-4555-8555-555555555555',
  sequence: 42,
  style,
};

describe('scene realtime UDP codec', () => {
  it('round-trips client and authenticated server drawing previews', () => {
    expect(
      decodeClientDrawingPreview(
        encodeClientDrawingPreview(clientDrawing),
      ),
    ).toEqual({
      active: clientDrawing.active,
      closed: clientDrawing.closed,
      kind: clientDrawing.kind,
      operationId: clientDrawing.operationId,
      points: clientDrawing.points,
      sceneId: clientDrawing.sceneId,
      sequence: clientDrawing.sequence,
      style: clientDrawing.style,
    });

    const serverDrawing = {
      ...clientDrawing,
      sourceId: 'player',
    };
    expect(
      decodeServerDrawingPreview(
        encodeServerDrawingPreview(serverDrawing),
      ),
    ).toEqual(serverDrawing);
  });

  it('round-trips transform deltas with and without absolute transforms', () => {
    const delta = {
      absolute: {
        height: 120,
        rotation: 15,
        width: 80,
        x: 30,
        y: 40,
      },
      dx: 1,
      dy: 2,
      operationId: 'transform-operation',
      rotation: 3,
      scaleX: 1.25,
      scaleY: 0.75,
    };
    expect(decodeTransformPreview(encodeTransformPreview(delta))).toEqual(
      delta,
    );
    const relative = {
      dx: delta.dx,
      dy: delta.dy,
      operationId: delta.operationId,
      rotation: delta.rotation,
      scaleX: delta.scaleX,
      scaleY: delta.scaleY,
    };
    expect(
      decodeTransformPreview(encodeTransformPreview(relative)),
    ).toEqual(relative);
  });

  it('round-trips self-contained GM fog snapshots and rejects malformed points', () => {
    const preview = {
      active: true,
      hardness: 0.4,
      mode: 'reveal' as const,
      operationId: '77777777-7777-4777-8777-777777777777',
      points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
      sceneId: '88888888-8888-4888-8888-888888888888',
      sequence: 9,
      width: 70,
    };
    expect(decodeServerFogPreview(encodeServerFogPreview(preview))).toEqual(
      preview,
    );
    expect(() => decodeServerFogPreview(Buffer.from(JSON.stringify({
      ...preview,
      points: [{ x: -1, y: 20 }],
    })))).toThrow();
    expect(() => decodeServerFogPreview(Buffer.from(JSON.stringify({
      ...preview,
      active: false,
    })))).toThrow();
  });

  it('round-trips shape snapshots without accepting ownership authority', () => {
    const shape = {
      height: 100,
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'cone' as const,
      rotation: 10,
      spread: 53.13,
      style: {
        backgroundColor: '#ffffff',
        backgroundOpacity: 0.25,
        backgroundType: 'crosshatched' as const,
        fontColor: '#ffffff',
        fontFamily: 'inter' as const,
        fontSize: 24,
        fontStrokeColor: '#000000',
        fontStrokeWidth: 2,
        fontWeight: 400 as const,
        strokeColor: '#ffffff',
        strokeOpacity: 1,
        strokeType: 'solid' as const,
        strokeWidth: 2,
      },
      width: 200,
      x: 30,
      y: 40,
    };
    const client = {
      layer: 'gm' as const,
      operationId: '22222222-2222-4222-8222-222222222222',
      phase: 'update' as const,
      sceneId: '33333333-3333-4333-8333-333333333333',
      sequence: 4,
      shape,
    };
    expect(decodeClientShapePreview(encodeClientShapePreview(client))).toEqual({
      operationId: client.operationId,
      phase: client.phase,
      sceneId: client.sceneId,
      sequence: client.sequence,
      shape,
    });
    const server = { ...client, layer: 'token' as const, sourceId: 'player' };
    expect(decodeServerShapePreview(encodeServerShapePreview(server))).toEqual(
      server,
    );
    expect(() => decodeClientShapePreview(Buffer.from(JSON.stringify({
      ...client,
      shape: { ...shape, ownerId: 'spoofed', revision: 0 },
    })))).toThrow();
    expect(() => decodeClientShapePreview(Buffer.from(JSON.stringify({
      ...client,
      operationId: 'not-a-uuid',
    })))).toThrow();
    expect(() => decodeClientShapePreview(Buffer.from(JSON.stringify({
      ...client,
      sequence: 0x1_0000_0000,
    })))).toThrow();
  });

  it('rejects malformed snapshots and server-only drawing violations', () => {
    expect(() => decodeClientDrawingPreview(Buffer.from('{'))).toThrow();
    expect(() =>
      decodeClientDrawingPreview(
        Buffer.from(JSON.stringify({ ...clientDrawing, points: [] })),
      ),
    ).toThrow();
    expect(() =>
      decodeServerDrawingPreview(
        Buffer.from(
          JSON.stringify({
            ...clientDrawing,
            layer: 'gm',
            sourceId: 'player',
          }),
        ),
      ),
    ).toThrow();
    expect(() =>
      decodeTransformPreview(
        Buffer.from(
          JSON.stringify({
            dx: 0,
            dy: 0,
            operationId: 'transform-operation',
            rotation: 0,
            scaleX: 0,
            scaleY: 1,
          }),
        ),
      ),
    ).toThrow();
  });
});
