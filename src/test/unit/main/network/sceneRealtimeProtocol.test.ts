import { describe, expect, it } from 'vitest';
import {
  decodeClientDrawingPreview,
  decodeServerDrawingPreview,
  decodeTransformPreview,
  encodeClientDrawingPreview,
  encodeServerDrawingPreview,
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
  operationId: 'drawing-operation',
  points: [{ x: 10, y: 20 }],
  sceneId: 'scene',
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
