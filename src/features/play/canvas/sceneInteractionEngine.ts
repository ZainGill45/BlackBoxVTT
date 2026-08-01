import type {
  MeasurementPoint,
} from '../../../shared/network';
import type {
  SceneDrawingPoint,
  SceneDrawingStyle,
  SceneImageState,
} from '../../../shared/scenes';
import type { EditTarget } from './sceneSelection';

export type SceneGesture =
  | { kind: 'idle' }
  | {
      clientX: number;
      clientY: number;
      kind: 'pan';
      pointerId: number;
    }
  | {
      kind: 'freeform';
      operationId: string;
      pointerId: number;
      points: SceneDrawingPoint[];
      sequence: number;
      style: SceneDrawingStyle;
    }
  | {
      hover: SceneDrawingPoint;
      kind: 'polyline';
      operationId: string;
      points: SceneDrawingPoint[];
      sequence: number;
      style: SceneDrawingStyle;
    }
  | {
      endpoint: MeasurementPoint;
      fixedPoints: MeasurementPoint[];
      id: string;
      kind: 'measurement';
      lastSentAt: number;
      pointerId: number;
      sceneId: string;
    }
  | {
      before: SceneImageState;
      groupRotationBefore: number;
      kind: 'edit';
      mode: 'marquee' | 'move' | 'resize' | 'rotate';
      pointerId: number;
      previewOperationId: string | null;
      previewPivot: { x: number; y: number };
      resizeCorner: number;
      start: { x: number; y: number };
    }
  | {
      kind: 'pinch';
      last: { distance: number; x: number; y: number };
    }
  | {
      before: SceneImageState;
      keys: Set<string>;
      kind: 'nudge';
      operationId: string | null;
      startTargets: EditTarget[];
    };

export type ActiveSceneGesture = Exclude<SceneGesture, { kind: 'idle' }>;

export type SceneGestureEvent =
  | { gesture: ActiveSceneGesture; type: 'begin' }
  | { kind: ActiveSceneGesture['kind']; type: 'finish' };

export const idleSceneGesture = (): SceneGesture => ({ kind: 'idle' });

export interface PendingMapPing {
  groupRotation: number;
  pointerId: number;
  pullPlayers: boolean;
  scenePoint: { x: number; y: number };
  selected: Set<string>;
  startClientX: number;
  startClientY: number;
  timer: ReturnType<typeof setTimeout>;
}

export interface TrackedTouch {
  clientX: number;
  clientY: number;
  startX: number;
  startY: number;
}

export interface PointerDownContext {
  button: number;
  committing: boolean;
  editable: boolean;
  hasCommit: boolean;
  hasPaintConfiguration: boolean;
  measureEnabled: boolean;
  pointerType: string;
  touchCountAfter: number;
}

export interface PointerDownPlan {
  primary: 'block' | 'edit' | 'measure' | 'none' | 'paint' | 'pan' | 'pinch';
  startPendingPing: boolean;
  trackTouch: boolean;
}

export interface PointerMoveContext {
  hasScene: boolean;
  paintEnabled: boolean;
  pendingPingDistance: number | null;
  pointerId: number;
  pointerType: string;
  touchCount: number;
}

export interface PointerMovePlan {
  cancelPendingPing: boolean;
  hover: boolean;
  primary:
    | 'edit'
    | 'freeform'
    | 'measurement'
    | 'none'
    | 'pan'
    | 'pinch'
    | 'polyline';
  stopForPendingPing: boolean;
  trackTouch: boolean;
}

export interface PointerUpContext {
  button: number;
  cancelled: boolean;
  pointerId: number;
  pointerType: string;
}

export interface PointerUpPlan {
  primary:
    | 'edit'
    | 'freeform'
    | 'ignore'
    | 'measurement'
    | 'none'
    | 'pan'
    | 'ping';
  releaseTouch: boolean;
}

export interface KeyDownContext {
  committing: boolean;
  editable: boolean;
  hasMeasurement: boolean;
  hasPolyline: boolean;
  hasScene: boolean;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  selectedCount: number;
  shiftKey: boolean;
}

export type KeyDownPlan =
  | 'cancel-measurement'
  | 'cancel-polyline'
  | 'clipboard-copy'
  | 'clipboard-duplicate'
  | 'clipboard-paste'
  | 'delete'
  | 'finish-polyline'
  | 'ignore'
  | 'nudge'
  | 'polyline-backspace'
  | 'redo'
  | 'selection-escape'
  | 'undo';

export function planPointerDown({
  button,
  committing,
  editable,
  hasCommit,
  hasPaintConfiguration,
  measureEnabled,
  pointerType,
  touchCountAfter,
}: PointerDownContext): PointerDownPlan {
  if (button === 0 && committing) {
    return { primary: 'block', startPendingPing: false, trackTouch: false };
  }
  if (button === 0 && hasPaintConfiguration) {
    return { primary: 'paint', startPendingPing: false, trackTouch: false };
  }
  if (button === 0 && pointerType !== 'touch' && measureEnabled) {
    return { primary: 'measure', startPendingPing: false, trackTouch: false };
  }
  const startPendingPing = pointerType !== 'touch' && button === 0;
  const trackTouch = pointerType === 'touch';
  if (trackTouch && touchCountAfter >= 2) {
    return { primary: 'pinch', startPendingPing, trackTouch };
  }
  if (button === 0 && editable && hasCommit) {
    return { primary: 'edit', startPendingPing, trackTouch };
  }
  return {
    primary: button === 1 ? 'pan' : 'none',
    startPendingPing,
    trackTouch,
  };
}

export function planPointerMove(
  state: SceneInteractionEngine,
  {
    hasScene,
    paintEnabled,
    pendingPingDistance,
    pointerId,
    pointerType,
    touchCount,
  }: PointerMoveContext,
): PointerMovePlan {
  const defaults = {
    cancelPendingPing: false,
    hover: false,
    stopForPendingPing: false,
    trackTouch: false,
  };
  if (gestureOfKind(state.gesture, 'freeform')?.pointerId === pointerId) {
    return { ...defaults, primary: 'freeform' };
  }
  if (gestureOfKind(state.gesture, 'polyline') && paintEnabled) {
    return { ...defaults, primary: 'polyline' };
  }
  if (
    gestureOfKind(state.gesture, 'measurement')?.pointerId === pointerId &&
    hasScene
  ) {
    return { ...defaults, primary: 'measurement' };
  }
  const hover =
    pointerType !== 'touch' &&
    state.gesture.kind !== 'edit' &&
    state.gesture.kind !== 'pan';
  if (pendingPingDistance !== null && pendingPingDistance <= 8) {
    return {
      ...defaults,
      hover,
      primary: 'none',
      stopForPendingPing: true,
    };
  }
  const cancelPendingPing = pendingPingDistance !== null;
  const trackTouch =
    pointerType === 'touch' && state.touchPointers.has(pointerId);
  if (trackTouch && state.gesture.kind === 'pinch' && touchCount >= 2) {
    return {
      ...defaults,
      cancelPendingPing,
      hover,
      primary: 'pinch',
      trackTouch,
    };
  }
  if (gestureOfKind(state.gesture, 'edit')?.pointerId === pointerId && hasScene) {
    return {
      ...defaults,
      cancelPendingPing,
      hover,
      primary: 'edit',
      trackTouch,
    };
  }
  if (gestureOfKind(state.gesture, 'pan')?.pointerId === pointerId) {
    return {
      ...defaults,
      cancelPendingPing,
      hover,
      primary: 'pan',
      trackTouch,
    };
  }
  return {
    ...defaults,
    cancelPendingPing,
    hover,
    primary: 'none',
    trackTouch,
  };
}

export function planKeyDown({
  committing,
  editable,
  hasMeasurement,
  hasPolyline,
  hasScene,
  key,
  metaKey,
  ctrlKey,
  selectedCount,
  shiftKey,
}: KeyDownContext): KeyDownPlan {
  if (key === 'Escape' && hasMeasurement) {
    return 'cancel-measurement';
  }
  if (hasPolyline) {
    if (key === 'Escape') return 'cancel-polyline';
    if (key === 'Enter') return 'finish-polyline';
    if (key === 'Backspace') return 'polyline-backspace';
  }
  if (!hasScene || committing) {
    return 'ignore';
  }
  const primary = ctrlKey || metaKey;
  const shortcut = key.toLowerCase();
  if (primary && shortcut === 'z') {
    return shiftKey ? 'redo' : 'undo';
  }
  if (primary && shortcut === 'y') {
    return 'redo';
  }
  if (!editable) {
    return 'ignore';
  }
  if (ctrlKey && !metaKey) {
    if (shortcut === 'c') return 'clipboard-copy';
    if (shortcut === 'd') return 'clipboard-duplicate';
    if (shortcut === 'v') return 'clipboard-paste';
  }
  if (key === 'Escape') return 'selection-escape';
  if (key === 'Delete' || key === 'Backspace') return 'delete';
  if (key.startsWith('Arrow') && selectedCount > 0) return 'nudge';
  return 'ignore';
}

export function planPointerUp(
  state: SceneInteractionEngine,
  { button, cancelled, pointerId, pointerType }: PointerUpContext,
): PointerUpPlan {
  if (gestureOfKind(state.gesture, 'freeform')?.pointerId === pointerId) {
    return { primary: 'freeform', releaseTouch: false };
  }
  if (gestureOfKind(state.gesture, 'measurement')?.pointerId === pointerId) {
    return {
      primary: cancelled || button === 0 ? 'measurement' : 'ignore',
      releaseTouch: false,
    };
  }
  if (state.pingConsumedPointers.has(pointerId)) {
    return { primary: 'ping', releaseTouch: false };
  }
  const releaseTouch = pointerType === 'touch';
  if (gestureOfKind(state.gesture, 'edit')?.pointerId === pointerId) {
    return { primary: 'edit', releaseTouch };
  }
  if (gestureOfKind(state.gesture, 'pan')?.pointerId === pointerId) {
    return { primary: 'pan', releaseTouch };
  }
  return { primary: 'none', releaseTouch };
}

/** Owns canvas input state and provides the pure event-routing engine. */
export class SceneInteractionEngine {
  committing = false;
  gesture: SceneGesture = idleSceneGesture();
  groupSelectionRotation = 0;
  leftAlt = false;
  pendingPing: PendingMapPing | null = null;
  readonly pingConsumedPointers = new Set<number>();
  selected = new Set<string>();
  readonly touchLongPressOpened = new Set<number>();
  touchLongPressTimer: ReturnType<typeof setTimeout> | null = null;
  readonly touchPointers = new Map<number, TrackedTouch>();

  begin(gesture: ActiveSceneGesture): boolean {
    const next = reduceSceneGesture(this.gesture, {
      gesture,
      type: 'begin',
    });
    if (next !== gesture) {
      return false;
    }
    this.gesture = next;
    return true;
  }

  finish(kind: ActiveSceneGesture['kind']): void {
    this.gesture = reduceSceneGesture(this.gesture, {
      kind,
      type: 'finish',
    });
  }

  pressModifier(code: string): boolean {
    if (code === 'ShiftLeft' || code === 'ShiftRight') {
      if (this.pendingPing) {
        this.pendingPing.pullPlayers = true;
      }
      return false;
    }
    if (code === 'AltLeft') {
      this.leftAlt = true;
      return true;
    }
    return false;
  }

  releaseKey(code: string, key: string, shiftKey: boolean): boolean {
    if (code === 'ShiftLeft' || code === 'ShiftRight') {
      if (this.pendingPing) {
        this.pendingPing.pullPlayers = shiftKey;
      }
    } else if (code === 'AltLeft') {
      this.leftAlt = false;
    } else if (key.startsWith('Arrow')) {
      const nudge = gestureOfKind(this.gesture, 'nudge');
      nudge?.keys.delete(key);
      return Boolean(nudge && nudge.keys.size === 0);
    }
    return false;
  }

}

/** Pure lifecycle reducer: only one primary canvas gesture may be active. */
export function reduceSceneGesture(
  state: SceneGesture,
  event: SceneGestureEvent,
): SceneGesture {
  if (event.type === 'begin') {
    return state.kind === 'idle' ? event.gesture : state;
  }
  return state.kind === event.kind ? idleSceneGesture() : state;
}

export function gestureOfKind<K extends SceneGesture['kind']>(
  gesture: SceneGesture,
  kind: K,
): Extract<SceneGesture, { kind: K }> | null {
  return gesture.kind === kind
    ? (gesture as Extract<SceneGesture, { kind: K }>)
    : null;
}
