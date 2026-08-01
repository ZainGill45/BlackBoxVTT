import { CANONICAL_MAP_ID } from './sceneConstants';
import type {
  SceneDrawing,
  SceneImage,
  SceneMapImage,
  SceneRecord,
  SceneText,
} from './sceneSchema';
import type {
  SceneTransformPreviewDelta,
  SceneTransformPreviewStart,
} from './sceneContracts';

type TransformPreviewStart =
  | SceneTransformPreviewStart
  | Omit<SceneTransformPreviewStart, 'campaignId'>;
type TransformPreviewDelta =
  | SceneTransformPreviewDelta
  | Omit<SceneTransformPreviewDelta, 'campaignId'>;

/** Applies an ephemeral transform delta to the immutable operation baseline. */
export function applySceneTransformPreview(
  base: SceneRecord,
  start: TransformPreviewStart,
  input: TransformPreviewDelta,
): SceneRecord {
  const scene = structuredClone(base);
  const targets = new Set(start.targets);
  const applyAbsolute = (targetId: string): boolean => {
    if (!input.absolute) {
      return false;
    }
    if (targetId === CANONICAL_MAP_ID && scene.mapImage) {
      Object.assign(scene.mapImage, input.absolute);
      return true;
    }
    for (const layer of Object.values(scene.images) as SceneImage[][]) {
      const image = layer.find((candidate) => candidate.id === targetId);
      if (image) {
        Object.assign(image, input.absolute);
        return true;
      }
    }
    for (const layer of Object.values(scene.drawings) as SceneDrawing[][]) {
      const drawing = layer.find((candidate) => candidate.id === targetId);
      if (drawing) {
        Object.assign(drawing, input.absolute);
        return true;
      }
    }
    for (const layer of Object.values(scene.texts) as SceneText[][]) {
      const text = layer.find((candidate) => candidate.id === targetId);
      if (text) {
        Object.assign(text, input.absolute);
        return true;
      }
    }
    return false;
  };
  if (start.targets.length === 1 && applyAbsolute(start.targets[0])) {
    return scene;
  }
  const radians = (input.rotation * Math.PI) / 180;
  const transformPoint = (x: number, y: number) => {
    const dx = (x - start.pivotX) * input.scaleX;
    const dy = (y - start.pivotY) * input.scaleY;
    return {
      x:
        start.pivotX +
        Math.cos(radians) * dx -
        Math.sin(radians) * dy +
        input.dx,
      y:
        start.pivotY +
        Math.sin(radians) * dx +
        Math.cos(radians) * dy +
        input.dy,
    };
  };
  const transformImage = <T extends SceneMapImage>(image: T): T => ({
    ...image,
    height: image.height * input.scaleY,
    rotation: image.rotation + input.rotation,
    width: image.width * input.scaleX,
    ...transformPoint(image.x, image.y),
  });
  if (targets.has(CANONICAL_MAP_ID) && scene.mapImage) {
    scene.mapImage = transformImage(scene.mapImage);
  }
  for (const layer of Object.values(scene.images) as SceneImage[][]) {
    for (let index = 0; index < layer.length; index += 1) {
      if (targets.has(layer[index].id)) {
        layer[index] = transformImage(layer[index]);
      }
    }
  }
  for (const layer of Object.values(scene.drawings) as SceneDrawing[][]) {
    for (let index = 0; index < layer.length; index += 1) {
      const drawing = layer[index];
      if (targets.has(drawing.id)) {
        layer[index] = {
          ...drawing,
          ...transformPoint(drawing.x, drawing.y),
          rotation: drawing.rotation + input.rotation,
          scaleX: drawing.scaleX * input.scaleX,
          scaleY: drawing.scaleY * input.scaleY,
        };
      }
    }
  }
  for (const layer of Object.values(scene.texts) as SceneText[][]) {
    for (let index = 0; index < layer.length; index += 1) {
      const text = layer[index];
      if (targets.has(text.id)) {
        layer[index] = {
          ...text,
          ...transformPoint(text.x, text.y),
          rotation: text.rotation + input.rotation,
          scaleX: text.scaleX * input.scaleX,
          scaleY: text.scaleY * input.scaleY,
        };
      }
    }
  }
  return scene;
}
