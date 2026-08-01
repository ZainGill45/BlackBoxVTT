import { describe, expect, it } from 'vitest';
import {
  idleSceneGesture,
  planKeyDown,
  planPointerDown,
  planPointerMove,
  planPointerUp,
  reduceSceneGesture,
  SceneInteractionEngine,
  type SceneGesture,
} from '../../../../../features/play/canvas/sceneInteractionEngine';

describe('scene gesture lifecycle', () => {
  it('admits one primary gesture and rejects an overlapping start', () => {
    const pan = {
      clientX: 10,
      clientY: 20,
      kind: 'pan' as const,
      pointerId: 1,
    };
    const active = reduceSceneGesture(idleSceneGesture(), {
      gesture: pan,
      type: 'begin',
    });
    const conflicting = reduceSceneGesture(active, {
      gesture: {
        endpoint: { x: 1, y: 2 },
        fixedPoints: [{ x: 1, y: 2 }],
        id: 'measurement',
        kind: 'measurement',
        lastSentAt: 0,
        pointerId: 2,
        sceneId: 'scene',
      },
      type: 'begin',
    });

    expect(active).toBe(pan);
    expect(conflicting).toBe(active);
  });

  it('finishes only the matching active gesture', () => {
    const active: SceneGesture = {
      clientX: 10,
      clientY: 20,
      kind: 'pan',
      pointerId: 1,
    };

    expect(
      reduceSceneGesture(active, { kind: 'edit', type: 'finish' }),
    ).toBe(active);
    expect(
      reduceSceneGesture(active, { kind: 'pan', type: 'finish' }),
    ).toEqual({ kind: 'idle' });
  });
});

describe('scene interaction routing', () => {
  it('routes pointer-down tools by explicit priority', () => {
    const base = {
      button: 0,
      committing: false,
      editable: true,
      hasCommit: true,
      hasPaintConfiguration: true,
      measureEnabled: true,
      pointerType: 'mouse',
      touchCountAfter: 0,
    };

    expect(planPointerDown(base).primary).toBe('paint');
    expect(planPointerDown({ ...base, committing: true }).primary).toBe(
      'block',
    );
    expect(
      planPointerDown({ ...base, hasPaintConfiguration: false }).primary,
    ).toBe('measure');
    expect(
      planPointerDown({
        ...base,
        hasPaintConfiguration: false,
        measureEnabled: false,
        pointerType: 'touch',
        touchCountAfter: 2,
      }).primary,
    ).toBe('pinch');
    expect(
      planPointerDown({
        ...base,
        button: 1,
        editable: false,
        hasCommit: false,
        hasPaintConfiguration: false,
        measureEnabled: false,
      }).primary,
    ).toBe('pan');
  });

  it('keeps a pending ping ahead of edit and pan movement', () => {
    const state = new SceneInteractionEngine();
    state.gesture = {
      clientX: 1,
      clientY: 2,
      kind: 'pan',
      pointerId: 7,
    };

    expect(
      planPointerMove(state, {
        hasScene: true,
        paintEnabled: false,
        pendingPingDistance: 4,
        pointerId: 7,
        pointerType: 'mouse',
        touchCount: 0,
      }),
    ).toMatchObject({ primary: 'none', stopForPendingPing: true });
    expect(
      planPointerMove(state, {
        hasScene: true,
        paintEnabled: false,
        pendingPingDistance: 12,
        pointerId: 7,
        pointerType: 'mouse',
        touchCount: 0,
      }),
    ).toMatchObject({ cancelPendingPing: true, primary: 'pan' });
  });

  it('routes releases from the active gesture and consumed pings', () => {
    const state = new SceneInteractionEngine();
    state.gesture = {
      clientX: 1,
      clientY: 2,
      kind: 'pan',
      pointerId: 7,
    };
    expect(
      planPointerUp(state, {
        button: 1,
        cancelled: false,
        pointerId: 7,
        pointerType: 'mouse',
      }).primary,
    ).toBe('pan');

    state.pingConsumedPointers.add(8);
    expect(
      planPointerUp(state, {
        button: 0,
        cancelled: false,
        pointerId: 8,
        pointerType: 'mouse',
      }).primary,
    ).toBe('ping');
  });

  it('routes keyboard commands without renderer or Pixi state', () => {
    const base = {
      committing: false,
      ctrlKey: true,
      editable: true,
      hasMeasurement: false,
      hasPolyline: false,
      hasScene: true,
      key: 'z',
      metaKey: false,
      selectedCount: 1,
      shiftKey: false,
    };

    expect(planKeyDown(base)).toBe('undo');
    expect(planKeyDown({ ...base, shiftKey: true })).toBe('redo');
    expect(planKeyDown({ ...base, key: 'c' })).toBe('clipboard-copy');
    expect(
      planKeyDown({
        ...base,
        ctrlKey: false,
        key: 'ArrowRight',
      }),
    ).toBe('nudge');
    expect(
      planKeyDown({ ...base, committing: true, key: 'ArrowRight' }),
    ).toBe('ignore');
  });
});
