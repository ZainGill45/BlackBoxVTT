import type { SceneObjectOrderLayers } from '../../../shared/scenes';

const OBJECT_Z_INDEX = 100;
const OBJECT_Z_STRIDE = 4;
export const OBJECT_PREVIEW_Z_INDEX = 3_000_000;

/** Returns one layer-local z slot; missing IDs are transient previews. */
export function sceneObjectZIndex(
  order: SceneObjectOrderLayers,
  layer: keyof SceneObjectOrderLayers,
  id: string,
  fallbackIndex: number,
  part = 1,
): number {
  const index = order[layer].indexOf(id);
  return index >= 0
    ? OBJECT_Z_INDEX + index * OBJECT_Z_STRIDE + part
    : OBJECT_PREVIEW_Z_INDEX + fallbackIndex * OBJECT_Z_STRIDE + part;
}
