import {
  CANONICAL_MAP_ID,
  type SceneDrawing,
  type SceneImage,
  type SceneObjectState,
  type SceneMapImage,
  type SceneRecord,
  type SceneText,
} from '../../../shared/scenes';
import {
  corners,
  reorderSelected,
  roundTransform,
} from './imageGeometry';

export interface EditTarget {
  drawing?: SceneDrawing;
  id: string;
  image: SceneMapImage;
  text?: SceneText;
}

export interface SceneTextBounds {
  height: number;
  width: number;
}

export type SceneTextBoundsLookup = (id: string) => SceneTextBounds | null;

export interface SceneSelectionPolicy {
  activeLayer: keyof SceneRecord['images'];
  actorId?: string | null;
  canEditImages?: boolean;
}

export interface SelectionFrame {
  angle: number;
  center: { x: number; y: number };
  corners: Array<{ x: number; y: number }>;
  height: number;
  width: number;
}

export function drawingTransformOf(drawing: SceneDrawing) {
  return {
    rotation: drawing.rotation,
    scaleX: drawing.scaleX,
    scaleY: drawing.scaleY,
    x: drawing.x,
    y: drawing.y,
  };
}

export function textTransformOf(text: SceneText) {
  return {
    rotation: text.rotation,
    scaleX: text.scaleX,
    scaleY: text.scaleY,
    x: text.x,
    y: text.y,
  };
}

export function imageTransformOf(image: SceneMapImage) {
  return {
    height: image.height,
    rotation: image.rotation,
    width: image.width,
    x: image.x,
    y: image.y,
  };
}

export function drawingLocalBounds(drawing: SceneDrawing) {
  const halfStroke = drawing.style.strokeWidth / 2;
  const xs = drawing.points.map((point) => point.x);
  const ys = drawing.points.map((point) => point.y);
  const minX = Math.min(...xs) - halfStroke;
  const maxX = Math.max(...xs) + halfStroke;
  const minY = Math.min(...ys) - halfStroke;
  const maxY = Math.max(...ys) + halfStroke;
  return {
    height: Math.max(1, maxY - minY),
    width: Math.max(1, maxX - minX),
  };
}

export function drawingAsImage(drawing: SceneDrawing): SceneMapImage {
  const local = drawingLocalBounds(drawing);
  return {
    assetId: drawing.id,
    height: local.height * drawing.scaleY,
    rotation: drawing.rotation,
    width: local.width * drawing.scaleX,
    x: drawing.x,
    y: drawing.y,
  };
}

export function textAsImage(
  text: SceneText,
  bounds: SceneTextBounds,
): SceneMapImage {
  return {
    assetId: text.id,
    height: Math.max(1, bounds.height * text.scaleY),
    rotation: text.rotation,
    width: Math.max(1, bounds.width * text.scaleX),
    x: text.x,
    y: text.y,
  };
}

export function canEditDrawing(
  drawing: SceneDrawing,
  actorId?: string | null,
): boolean {
  return actorId == null || drawing.ownerId === actorId;
}

export function canEditText(
  text: SceneText,
  actorId?: string | null,
): boolean {
  return actorId == null || text.ownerId === actorId;
}

export function activeSceneTargets(
  scene: SceneRecord,
  policy: SceneSelectionPolicy,
  textBounds: SceneTextBoundsLookup = () => null,
): EditTarget[] {
  const result: EditTarget[] =
    policy.canEditImages === false
      ? []
      : scene.images[policy.activeLayer].map((image) => ({
          id: image.id,
          image,
        }));
  if (
    policy.canEditImages !== false &&
    policy.activeLayer === 'map' &&
    scene.mapImage
  ) {
    result.unshift({ id: CANONICAL_MAP_ID, image: scene.mapImage });
  }
  for (const drawing of scene.drawings[policy.activeLayer]) {
    if (canEditDrawing(drawing, policy.actorId)) {
      result.push({
        drawing,
        id: drawing.id,
        image: drawingAsImage(drawing),
      });
    }
  }
  for (const text of scene.texts[policy.activeLayer]) {
    const bounds = textBounds(text.id);
    if (bounds && canEditText(text, policy.actorId)) {
      result.push({
        id: text.id,
        image: textAsImage(text, bounds),
        text,
      });
    }
  }
  return result;
}

export function selectedSceneTargets(
  scene: SceneRecord,
  selected: ReadonlySet<string>,
  policy: Pick<SceneSelectionPolicy, 'actorId' | 'canEditImages'>,
  textBounds: SceneTextBoundsLookup = () => null,
): EditTarget[] {
  const lookup = new Map<string, EditTarget>();
  if (scene.mapImage && policy.canEditImages !== false) {
    lookup.set(CANONICAL_MAP_ID, {
      id: CANONICAL_MAP_ID,
      image: scene.mapImage,
    });
  }
  if (policy.canEditImages !== false) {
    for (const layer of Object.values(scene.images) as SceneImage[][]) {
      for (const image of layer) {
        lookup.set(image.id, { id: image.id, image });
      }
    }
  }
  for (const layer of Object.values(scene.drawings)) {
    for (const drawing of layer) {
      if (canEditDrawing(drawing, policy.actorId)) {
        lookup.set(drawing.id, {
          drawing,
          id: drawing.id,
          image: drawingAsImage(drawing),
        });
      }
    }
  }
  for (const layer of Object.values(scene.texts)) {
    for (const text of layer) {
      const bounds = textBounds(text.id);
      if (bounds && canEditText(text, policy.actorId)) {
        lookup.set(text.id, {
          id: text.id,
          image: textAsImage(text, bounds),
          text,
        });
      }
    }
  }
  return [...selected]
    .map((id) => lookup.get(id) ?? null)
    .filter((target): target is EditTarget => target !== null);
}

export function selectionFrame(
  targets: EditTarget[],
  groupAngle = 0,
): SelectionFrame | null {
  if (targets.length === 0) {
    return null;
  }
  const angle =
    targets.length === 1 ? targets[0].image.rotation : groupAngle;
  const radians = (-angle * Math.PI) / 180;
  const localPoints = targets.flatMap((target) =>
    corners(target.image).map((point) => ({
      x: Math.cos(radians) * point.x - Math.sin(radians) * point.y,
      y: Math.sin(radians) * point.x + Math.cos(radians) * point.y,
    })),
  );
  const minX = Math.min(...localPoints.map((point) => point.x));
  const maxX = Math.max(...localPoints.map((point) => point.x));
  const minY = Math.min(...localPoints.map((point) => point.y));
  const maxY = Math.max(...localPoints.map((point) => point.y));
  const localCorners = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  const forward = (point: { x: number; y: number }) => {
    const forwardRadians = -radians;
    return {
      x:
        Math.cos(forwardRadians) * point.x -
        Math.sin(forwardRadians) * point.y,
      y:
        Math.sin(forwardRadians) * point.x +
        Math.cos(forwardRadians) * point.y,
    };
  };
  return {
    angle,
    center: forward({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }),
    corners: localCorners.map(forward),
    height: maxY - minY,
    width: maxX - minX,
  };
}

export function createTargetAccessor(
  state: SceneObjectState,
  textBounds: SceneTextBoundsLookup = () => null,
): {
  read: (id: string) => SceneMapImage | null;
  write: (id: string, transform: SceneMapImage) => void;
} {
  const locations = new Map<
    string,
    { index: number; layer: SceneImage[] }
  >();
  const drawingLocations = new Map<
    string,
    { index: number; layer: SceneDrawing[] }
  >();
  const textLocations = new Map<
    string,
    { index: number; layer: SceneText[] }
  >();
  for (const layer of Object.values(state.images) as SceneImage[][]) {
    layer.forEach((image, index) => {
      locations.set(image.id, { index, layer });
    });
  }
  for (const layer of Object.values(state.drawings) as SceneDrawing[][]) {
    layer.forEach((drawing, index) => {
      drawingLocations.set(drawing.id, { index, layer });
    });
  }
  for (const layer of Object.values(state.texts) as SceneText[][]) {
    layer.forEach((text, index) => {
      textLocations.set(text.id, { index, layer });
    });
  }
  return {
    read: (id) => {
      if (id === CANONICAL_MAP_ID) {
        return state.mapImage;
      }
      const location = locations.get(id);
      if (location) {
        return location.layer[location.index];
      }
      const drawingLocation = drawingLocations.get(id);
      if (drawingLocation) {
        return drawingAsImage(drawingLocation.layer[drawingLocation.index]);
      }
      const textLocation = textLocations.get(id);
      const bounds = textBounds(id);
      return textLocation && bounds
        ? textAsImage(textLocation.layer[textLocation.index], bounds)
        : null;
    },
    write: (id, transform) => {
      if (id === CANONICAL_MAP_ID) {
        state.mapImage = { ...transform };
        return;
      }
      const location = locations.get(id);
      if (location) {
        location.layer[location.index] = {
          ...location.layer[location.index],
          ...transform,
        };
        return;
      }
      const drawingLocation = drawingLocations.get(id);
      if (drawingLocation) {
        const drawing = drawingLocation.layer[drawingLocation.index];
        const local = drawingLocalBounds(drawing);
        drawingLocation.layer[drawingLocation.index] = {
          ...drawing,
          rotation: transform.rotation,
          scaleX: Math.max(0.001, transform.width / local.width),
          scaleY: Math.max(0.001, transform.height / local.height),
          x: transform.x,
          y: transform.y,
        };
        return;
      }
      const textLocation = textLocations.get(id);
      const bounds = textBounds(id);
      if (textLocation && bounds) {
        const text = textLocation.layer[textLocation.index];
        textLocation.layer[textLocation.index] = {
          ...text,
          rotation: transform.rotation,
          scaleX: Math.max(0.001, transform.width / Math.max(1, bounds.width)),
          scaleY: Math.max(0.001, transform.height / Math.max(1, bounds.height)),
          x: transform.x,
          y: transform.y,
        };
      }
    },
  };
}

export function selectedTargetsFromState(
  state: SceneObjectState,
  selected: ReadonlySet<string>,
  textBounds: SceneTextBoundsLookup = () => null,
): EditTarget[] {
  const accessor = createTargetAccessor(state, textBounds);
  return [...selected]
    .map((id) => {
      const image = accessor.read(id);
      const drawing = Object.values(state.drawings)
        .flat()
        .find((candidate) => candidate.id === id);
      const text = Object.values(state.texts)
        .flat()
        .find((candidate) => candidate.id === id);
      return image
        ? {
            ...(drawing ? { drawing } : {}),
            ...(text ? { text } : {}),
            id,
            image,
          }
        : null;
    })
    .filter((target): target is EditTarget => target !== null);
}

export function deleteSelectedObjects(
  before: SceneObjectState,
  selected: ReadonlySet<string>,
): SceneObjectState {
  const after = structuredClone(before);
  if (selected.has(CANONICAL_MAP_ID)) {
    after.mapImage = null;
  }
  for (const layer of Object.keys(after.images) as Array<
    keyof SceneObjectState['images']
  >) {
    after.images[layer] = after.images[layer].filter(
      (image) => !selected.has(image.id),
    );
    after.drawings[layer] = after.drawings[layer].filter(
      (drawing) => !selected.has(drawing.id),
    );
    after.texts[layer] = after.texts[layer].filter(
      (text) => !selected.has(text.id),
    );
  }
  return after;
}

export function selectedPlacedImages(
  scene: SceneRecord,
  selected: ReadonlySet<string>,
  layer: keyof SceneRecord['images'],
): SceneImage[] {
  if (selected.has(CANONICAL_MAP_ID)) {
    return [];
  }
  return scene.images[layer].filter((image) => selected.has(image.id));
}

export function canCreateSceneImages(
  scene: SceneRecord,
  count: number,
  maximum: number,
): boolean {
  const currentCount = Object.values(scene.images).reduce(
    (total, images) => total + images.length,
    0,
  );
  return count > 0 && currentCount + count <= maximum;
}

export function duplicateSceneImages(
  images: SceneImage[],
  offset: number,
  createId: () => string,
): SceneImage[] {
  return images.map((image) =>
    roundTransform({
      ...image,
      id: createId(),
      x: image.x + offset,
      y: image.y + offset,
    }),
  );
}

export function moveSelectedImagesToLayer(
  before: SceneObjectState,
  selected: ReadonlySet<string>,
  targetLayer: keyof SceneObjectState['images'],
): SceneObjectState {
  const after = structuredClone(before);
  const moved: SceneImage[] = [];
  for (const current of Object.keys(after.images) as Array<
    keyof SceneObjectState['images']
  >) {
    moved.push(
      ...after.images[current].filter((image) => selected.has(image.id)),
    );
    after.images[current] = after.images[current].filter(
      (image) => !selected.has(image.id),
    );
  }
  after.images[targetLayer].push(...moved);
  return after;
}

export function reorderSelectedImages(
  before: SceneObjectState,
  selected: ReadonlySet<string>,
  layer: keyof SceneObjectState['images'],
  direction: 'back' | 'backward' | 'forward' | 'front',
): SceneObjectState {
  const after = structuredClone(before);
  after.images[layer] = reorderSelected(
    after.images[layer],
    new Set(selected),
    direction,
  );
  return after;
}
