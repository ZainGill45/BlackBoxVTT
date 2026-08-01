import {
  type SceneImageState,
  type SceneRecord,
  type SceneTransformPreviewDelta,
} from '../../../shared/scenes';
import {
  roundTransform,
  snapMove,
  snapValue,
  snappingActive,
} from './imageGeometry';
import type { SceneGesture } from './sceneInteractionEngine';
import {
  createTargetAccessor,
  drawingTransformOf,
  imageTransformOf,
  selectedTargetsFromState,
  selectionFrame,
  type EditTarget,
} from './sceneSelection';

type EditGesture = Extract<SceneGesture, { kind: 'edit' }>;
type TransformPreview = Omit<SceneTransformPreviewDelta, 'campaignId'>;

export interface UpdateSceneEditInput {
  currentGroupRotation: number;
  disableSnapping: boolean;
  gesture: EditGesture;
  point: { x: number; y: number };
  preserveAspectRatio: boolean;
  scene: SceneRecord;
  selected: ReadonlySet<string>;
}

export interface SceneEditUpdate {
  groupRotation: number;
  preview: TransformPreview | null;
  state: SceneImageState;
}

export function snapshotEditTargets(targets: EditTarget[]): EditTarget[] {
  return targets.map((target) => ({
    ...(target.drawing
      ? { drawing: structuredClone(target.drawing) }
      : {}),
    id: target.id,
    image: { ...target.image },
  }));
}

export function nudgeSceneState(
  scene: SceneRecord,
  selected: ReadonlySet<string>,
  key: string,
  disableSnapping: boolean,
): SceneImageState {
  const state: SceneImageState = structuredClone({
    drawings: scene.drawings,
    images: scene.images,
    mapImage: scene.mapImage,
  });
  const targets = createTargetAccessor(state);
  const snapped = snappingActive(scene.grid, disableSnapping);
  const step = snapped ? scene.grid.size : 1;
  const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
  const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
  for (const target of selectedTargetsFromState(state, selected)) {
    targets.write(target.id, {
      ...target.image,
      x: target.image.x + dx,
      y: target.image.y + dy,
    });
  }
  return state;
}

export function createNudgePreview(
  startTargets: EditTarget[],
  scene: SceneRecord,
  operationId: string,
): TransformPreview | null {
  const first = startTargets[0];
  if (!first) {
    return null;
  }
  const accessor = createTargetAccessor({
    drawings: scene.drawings,
    images: scene.images,
    mapImage: scene.mapImage,
  });
  const next = accessor.read(first.id);
  if (!next) {
    return null;
  }
  const nextDrawing = Object.values(scene.drawings)
    .flat()
    .find((drawing) => drawing.id === first.id);
  return {
    ...(startTargets.length === 1
      ? {
          absolute: nextDrawing
            ? drawingTransformOf(nextDrawing)
            : imageTransformOf(next),
        }
      : {}),
    dx: next.x - first.image.x,
    dy: next.y - first.image.y,
    operationId,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  };
}

function shortestRotation(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/** Computes an edit preview without touching Pixi, the DOM, or persistence. */
export function updateSceneEdit({
  currentGroupRotation,
  disableSnapping,
  gesture,
  point,
  preserveAspectRatio,
  scene,
  selected,
}: UpdateSceneEditInput): SceneEditUpdate | null {
  const state: SceneImageState = structuredClone(gesture.before);
  const stateTargets = createTargetAccessor(state);
  const targets = selectedTargetsFromState(gesture.before, selected);
  if (targets.length === 0 || gesture.mode === 'marquee') {
    return null;
  }
  let groupRotation = currentGroupRotation;
  if (gesture.mode === 'move') {
    let dx = point.x - gesture.start.x;
    let dy = point.y - gesture.start.y;
    if (snappingActive(scene.grid, disableSnapping)) {
      const frame = selectionFrame(targets, gesture.groupRotationBefore);
      const proposed = {
        ...targets[0].image,
        x: targets[0].image.x + dx,
        y: targets[0].image.y + dy,
      };
      if (targets.length === 1) {
        const snapped = snapMove(proposed, scene.grid);
        dx += snapped.x - proposed.x;
        dy += snapped.y - proposed.y;
      } else if (frame) {
        const topLeft = frame.corners[0];
        dx =
          snapValue(topLeft.x + dx, scene.grid.size, scene.grid.offsetX) -
          topLeft.x;
        dy =
          snapValue(topLeft.y + dy, scene.grid.size, scene.grid.offsetY) -
          topLeft.y;
      }
    }
    for (const target of targets) {
      stateTargets.write(target.id, {
        ...target.image,
        x: target.image.x + dx,
        y: target.image.y + dy,
      });
    }
  } else {
    const frame = selectionFrame(targets, gesture.groupRotationBefore);
    if (!frame) {
      return null;
    }
    const centre = frame.center;
    if (gesture.mode === 'rotate') {
      const startAngle = Math.atan2(
        gesture.start.y - centre.y,
        gesture.start.x - centre.x,
      );
      const currentAngle = Math.atan2(
        point.y - centre.y,
        point.x - centre.x,
      );
      let delta =
        (Math.atan2(
          Math.sin(currentAngle - startAngle),
          Math.cos(currentAngle - startAngle),
        ) *
          180) /
        Math.PI;
      if (snappingActive(scene.grid, disableSnapping)) {
        const startingAngle =
          targets.length > 1
            ? gesture.groupRotationBefore
            : targets[0].image.rotation;
        delta = Math.round((startingAngle + delta) / 15) * 15 - startingAngle;
      }
      const radians = (delta * Math.PI) / 180;
      if (targets.length > 1) {
        groupRotation = gesture.groupRotationBefore + delta;
      }
      for (const target of targets) {
        const dx = target.image.x - centre.x;
        const dy = target.image.y - centre.y;
        stateTargets.write(target.id, {
          ...target.image,
          rotation: target.image.rotation + delta,
          x: centre.x + Math.cos(radians) * dx - Math.sin(radians) * dy,
          y: centre.y + Math.sin(radians) * dx + Math.cos(radians) * dy,
        });
      }
    } else {
      const opposite = (gesture.resizeCorner + 2) % 4;
      const anchor = frame.corners[opposite];
      const startCorner = frame.corners[gesture.resizeCorner];
      let draggedPoint = {
        x: startCorner.x + point.x - gesture.start.x,
        y: startCorner.y + point.y - gesture.start.y,
      };
      if (snappingActive(scene.grid, disableSnapping)) {
        draggedPoint = {
          x: snapValue(point.x, scene.grid.size, scene.grid.offsetX),
          y: snapValue(point.y, scene.grid.size, scene.grid.offsetY),
        };
      }
      const angle = (frame.angle * Math.PI) / 180;
      const basisX = { x: Math.cos(angle), y: Math.sin(angle) };
      const basisY = { x: -Math.sin(angle), y: Math.cos(angle) };
      const project = (
        value: { x: number; y: number },
        basis: { x: number; y: number },
      ) => value.x * basis.x + value.y * basis.y;
      const startVector = {
        x: startCorner.x - anchor.x,
        y: startCorner.y - anchor.y,
      };
      const pointerVector = {
        x: draggedPoint.x - anchor.x,
        y: draggedPoint.y - anchor.y,
      };
      let sx = project(pointerVector, basisX) / project(startVector, basisX);
      let sy = project(pointerVector, basisY) / project(startVector, basisY);
      if (preserveAspectRatio) {
        const scale =
          Math.abs(point.x - gesture.start.x) >=
          Math.abs(point.y - gesture.start.y)
            ? sx
            : sy;
        sx = scale;
        sy = scale;
      }
      sx = Math.max(...targets.map((target) => 1 / target.image.width), sx);
      sy = Math.max(...targets.map((target) => 1 / target.image.height), sy);
      for (const target of targets) {
        const relative = {
          x: target.image.x - anchor.x,
          y: target.image.y - anchor.y,
        };
        const localX = project(relative, basisX) * sx;
        const localY = project(relative, basisY) * sy;
        stateTargets.write(target.id, {
          ...target.image,
          height: Math.max(1, target.image.height * sy),
          width: Math.max(1, target.image.width * sx),
          x: anchor.x + localX * basisX.x + localY * basisY.x,
          y: anchor.y + localX * basisX.y + localY * basisY.y,
        });
      }
    }
  }
  for (const target of selected) {
    const image = stateTargets.read(target);
    if (image) {
      stateTargets.write(target, roundTransform(image));
    }
  }
  let preview: TransformPreview | null = null;
  if (gesture.previewOperationId) {
    const first = targets[0];
    const next = stateTargets.read(first.id);
    if (next) {
      const scaleX = next.width / first.image.width;
      const scaleY = next.height / first.image.height;
      const rotation = shortestRotation(first.image.rotation, next.rotation);
      const radians = (rotation * Math.PI) / 180;
      const relX = (first.image.x - gesture.previewPivot.x) * scaleX;
      const relY = (first.image.y - gesture.previewPivot.y) * scaleY;
      const nextDrawing = Object.values(state.drawings)
        .flat()
        .find((candidate) => candidate.id === first.id);
      preview = {
        ...(targets.length === 1
          ? {
              absolute: nextDrawing
                ? drawingTransformOf(nextDrawing)
                : imageTransformOf(next),
            }
          : {}),
        dx:
          next.x -
          (gesture.previewPivot.x +
            Math.cos(radians) * relX -
            Math.sin(radians) * relY),
        dy:
          next.y -
          (gesture.previewPivot.y +
            Math.sin(radians) * relX +
            Math.cos(radians) * relY),
        operationId: gesture.previewOperationId,
        rotation,
        scaleX,
        scaleY,
      };
    }
  }
  return { groupRotation, preview, state };
}
