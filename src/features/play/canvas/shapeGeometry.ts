import type {
  SceneRecord,
  SceneShape,
  SceneShapeKind,
  SceneShapeStyle,
} from '../../../shared/scenes';

export const DEFAULT_CONE_SPREAD = 53.13;
export const SHAPE_UNIT_INCREMENT = 5;
const MIN_SHAPE_SIZE = 1;

export interface Point {
  x: number;
  y: number;
}

export type ShapeSemanticHandle = 'reach' | 'size' | 'spread';

export interface ConeSectorGeometry {
  actualHalfAngle: number;
  boundary: Point;
  parameterHalfAngle: number;
  radiusY: number;
}

export function coneSectorGeometry(
  shape: Extract<SceneShape, { kind: 'cone' }>,
): ConeSectorGeometry {
  const actualHalfAngle = (shape.spread * Math.PI) / 360;
  const halfHeight = shape.height / 2;
  const tangent = Math.tan(actualHalfAngle);
  const boundaryX = Math.min(
    shape.width,
    tangent > 1e-7 ? halfHeight / tangent : shape.width,
  );
  const parameterHalfAngle = Math.max(
    1e-7,
    Math.acos(Math.max(0, Math.min(1, boundaryX / shape.width))),
  );
  const radiusY = halfHeight / Math.sin(parameterHalfAngle);
  return {
    actualHalfAngle,
    boundary: { x: boundaryX, y: halfHeight },
    parameterHalfAngle,
    radiusY,
  };
}

export function coneSectorCentroid(
  shape: Extract<SceneShape, { kind: 'cone' }>,
): Point {
  const { parameterHalfAngle } = coneSectorGeometry(shape);
  const distanceFromApex =
    shape.width * 2 * Math.sin(parameterHalfAngle) /
    (3 * parameterHalfAngle);
  return {
    x: -shape.width / 2 + distanceFromApex,
    y: 0,
  };
}

export function shapeAsImage(shape: SceneShape) {
  return {
    assetId: shape.id,
    height: shape.height,
    rotation: shape.rotation,
    width: shape.width,
    x: shape.x,
    y: shape.y,
  };
}

export function shapeIncrementPixels(
  scene: Pick<SceneRecord, 'distance' | 'pixelScale'>,
): number {
  return (SHAPE_UNIT_INCREMENT / scene.distance) * scene.pixelScale;
}

function quantizeLength(length: number, increment: number): number {
  return Math.round(length / increment) * increment;
}

export function createShapeFromDrag(input: {
  altKey: boolean;
  ctrlKey: boolean;
  end: Point;
  id: string;
  kind: SceneShapeKind;
  ownerId: string | null;
  scene: Pick<SceneRecord, 'distance' | 'pixelScale'>;
  start: Point;
  style: SceneShapeStyle;
}): SceneShape | null {
  const freeform = input.altKey && input.ctrlKey;
  const start = input.start;
  const rawDx = input.end.x - start.x;
  const rawDy = input.end.y - start.y;
  const increment = shapeIncrementPixels(input.scene);
  const independentLength = (value: number) =>
    freeform ? Math.abs(value) : quantizeLength(Math.abs(value), increment);
  const base = {
    id: input.id,
    ownerId: input.ownerId,
    revision: 0,
    rotation: 0,
    style: structuredClone(input.style),
  };
  if (input.kind === 'sphere') {
    if (input.altKey) {
      const width = independentLength(rawDx) * 2;
      const height = independentLength(rawDy) * 2;
      return width < MIN_SHAPE_SIZE || height < MIN_SHAPE_SIZE
        ? null
        : { ...base, height, kind: 'sphere', width, x: start.x, y: start.y };
    }
    const rawRadius = Math.hypot(rawDx, rawDy);
    const radius = quantizeLength(rawRadius, increment);
    return radius * 2 < MIN_SHAPE_SIZE
      ? null
      : {
          ...base,
          height: radius * 2,
          kind: 'sphere',
          width: radius * 2,
          x: start.x,
          y: start.y,
        };
  }
  if (input.kind === 'square') {
    let width = independentLength(rawDx);
    let height = independentLength(rawDy);
    if (!input.altKey) {
      const side = quantizeLength(
        Math.max(Math.abs(rawDx), Math.abs(rawDy)),
        increment,
      );
      width = side;
      height = side;
    }
    if (width < MIN_SHAPE_SIZE || height < MIN_SHAPE_SIZE) {
      return null;
    }
    return {
      ...base,
      height,
      kind: 'square',
      width,
      x: start.x + (Math.sign(rawDx) || 1) * width / 2,
      y: start.y + (Math.sign(rawDy) || 1) * height / 2,
    };
  }
  if (input.altKey) {
    const width = independentLength(rawDx);
    const halfHeight = independentLength(rawDy);
    const height = halfHeight * 2;
    if (width < MIN_SHAPE_SIZE || height < MIN_SHAPE_SIZE) {
      return null;
    }
    return {
      ...base,
      height,
      kind: 'cone',
      rotation: rawDx < 0 ? 180 : 0,
      spread:
        (Math.atan2(
          halfHeight,
          width * Math.cos((DEFAULT_CONE_SPREAD * Math.PI) / 360),
        ) *
          360) /
        Math.PI,
      width,
      x: start.x + (Math.sign(rawDx) || 1) * width / 2,
      y: start.y,
    };
  }
  const rawReach = Math.hypot(rawDx, rawDy);
  const reach = quantizeLength(rawReach, increment);
  if (reach < MIN_SHAPE_SIZE) {
    return null;
  }
  const rotation = (Math.atan2(rawDy, rawDx) * 180) / Math.PI;
  const direction = {
    x: rawDx / rawReach,
    y: rawDy / rawReach,
  };
  const endpoint = {
    x: start.x + direction.x * reach,
    y: start.y + direction.y * reach,
  };
  return {
    ...base,
    height: 2 * reach * Math.sin((DEFAULT_CONE_SPREAD * Math.PI) / 360),
    kind: 'cone',
    rotation,
    spread: DEFAULT_CONE_SPREAD,
    width: reach,
    x: (start.x + endpoint.x) / 2,
    y: (start.y + endpoint.y) / 2,
  };
}

export function toShapeLocal(shape: SceneShape, point: Point): Point {
  const radians = (-shape.rotation * Math.PI) / 180;
  const dx = point.x - shape.x;
  const dy = point.y - shape.y;
  return {
    x: Math.cos(radians) * dx - Math.sin(radians) * dy,
    y: Math.sin(radians) * dx + Math.cos(radians) * dy,
  };
}

export function fromShapeLocal(shape: SceneShape, point: Point): Point {
  const radians = (shape.rotation * Math.PI) / 180;
  return {
    x: shape.x + Math.cos(radians) * point.x - Math.sin(radians) * point.y,
    y: shape.y + Math.sin(radians) * point.x + Math.cos(radians) * point.y,
  };
}

export function containsShapePoint(shape: SceneShape, point: Point): boolean {
  const local = toShapeLocal(shape, point);
  if (shape.kind === 'square') {
    return Math.abs(local.x) <= shape.width / 2 &&
      Math.abs(local.y) <= shape.height / 2;
  }
  if (shape.kind === 'sphere') {
    const nx = local.x / (shape.width / 2);
    const ny = local.y / (shape.height / 2);
    return nx * nx + ny * ny <= 1;
  }
  const geometry = coneSectorGeometry(shape);
  const nx = (local.x + shape.width / 2) / shape.width;
  const ny = local.y / geometry.radiusY;
  return nx >= 0 && nx * nx + ny * ny <= 1 &&
    Math.abs(Math.atan2(local.y, local.x + shape.width / 2)) <=
      geometry.actualHalfAngle;
}

export function semanticShapeHandles(
  shape: SceneShape,
): Array<{ kind: ShapeSemanticHandle; point: Point }> {
  if (shape.kind === 'sphere') {
    const diagonal = Math.SQRT1_2;
    return [{
      kind: 'size',
      point: fromShapeLocal(shape, {
        x: shape.width / 2 * diagonal,
        y: shape.height / 2 * diagonal,
      }),
    }];
  }
  if (shape.kind === 'square') {
    return [{
      kind: 'size',
      point: fromShapeLocal(shape, {
        x: shape.width / 2,
        y: shape.height / 2,
      }),
    }];
  }
  const geometry = coneSectorGeometry(shape);
  return [
    {
      kind: 'reach',
      point: fromShapeLocal(shape, { x: shape.width / 2, y: 0 }),
    },
    {
      kind: 'spread',
      point: fromShapeLocal(shape, {
        x: -shape.width / 2 + geometry.boundary.x,
        y: geometry.boundary.y,
      }),
    },
  ];
}

export function editShapeWithSemanticHandle(
  shape: SceneShape,
  handle: ShapeSemanticHandle,
  point: Point,
  options: { freeform?: boolean; increment?: number } = {},
): SceneShape | null {
  const dimension = (value: number) =>
    options.freeform || !options.increment
      ? Math.abs(value)
      : quantizeLength(Math.abs(value), options.increment);
  if (shape.kind === 'sphere' && handle === 'size') {
    const local = toShapeLocal(shape, point);
    const width = dimension(local.x * Math.SQRT2) * 2;
    const height = dimension(local.y * Math.SQRT2) * 2;
    return width < MIN_SHAPE_SIZE || height < MIN_SHAPE_SIZE
      ? null
      : { ...shape, width, height };
  }
  if (shape.kind === 'square' && handle === 'size') {
    const anchor = fromShapeLocal(shape, {
      x: -shape.width / 2,
      y: -shape.height / 2,
    });
    const radians = (shape.rotation * Math.PI) / 180;
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    const localX = Math.cos(radians) * dx + Math.sin(radians) * dy;
    const localY = -Math.sin(radians) * dx + Math.cos(radians) * dy;
    const width = dimension(localX);
    const height = dimension(localY);
    if (width < MIN_SHAPE_SIZE || height < MIN_SHAPE_SIZE) {
      return null;
    }
    const signedWidth = (Math.sign(localX) || 1) * width;
    const signedHeight = (Math.sign(localY) || 1) * height;
    return {
      ...shape,
      height,
      width,
      x:
        anchor.x +
        Math.cos(radians) * signedWidth / 2 -
        Math.sin(radians) * signedHeight / 2,
      y:
        anchor.y +
        Math.sin(radians) * signedWidth / 2 +
        Math.cos(radians) * signedHeight / 2,
    };
  }
  if (shape.kind !== 'cone') {
    return null;
  }
  const apex = fromShapeLocal(shape, { x: -shape.width / 2, y: 0 });
  if (handle === 'reach') {
    const dx = point.x - apex.x;
    const dy = point.y - apex.y;
    const rawWidth = Math.hypot(dx, dy);
    const width = dimension(rawWidth);
    if (width < MIN_SHAPE_SIZE) {
      return null;
    }
    const scale = width / rawWidth;
    const endpoint = {
      x: apex.x + dx * scale,
      y: apex.y + dy * scale,
    };
    const aspect = shape.height / shape.width;
    return {
      ...shape,
      height: width * aspect,
      rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
      width,
      x: (apex.x + endpoint.x) / 2,
      y: (apex.y + endpoint.y) / 2,
    };
  }
  if (handle !== 'spread') {
    return null;
  }
  const local = toShapeLocal(shape, point);
  const fromApex = {
    x: local.x + shape.width / 2,
    y: local.y,
  };
  const geometry = coneSectorGeometry(shape);
  const half = Math.max(
    0.5,
    Math.min(
      89.5,
      Math.abs(
        (Math.atan2(fromApex.y, fromApex.x) * 180) /
          Math.PI,
      ),
    ),
  );
  const halfRadians = (half * Math.PI) / 180;
  const radius = 1 / Math.sqrt(
    (Math.cos(halfRadians) ** 2) / (shape.width ** 2) +
      (Math.sin(halfRadians) ** 2) / (geometry.radiusY ** 2),
  );
  return {
    ...shape,
    height: 2 * radius * Math.sin(halfRadians),
    spread: half * 2,
  };
}

export function shapePath(shape: SceneShape, segments = 64): Point[] {
  if (shape.kind === 'square') {
    return [
      { x: -shape.width / 2, y: -shape.height / 2 },
      { x: shape.width / 2, y: -shape.height / 2 },
      { x: shape.width / 2, y: shape.height / 2 },
      { x: -shape.width / 2, y: shape.height / 2 },
    ];
  }
  if (shape.kind === 'sphere') {
    return Array.from({ length: segments }, (_, index) => {
      const angle = (index / segments) * Math.PI * 2;
      return {
        x: Math.cos(angle) * shape.width / 2,
        y: Math.sin(angle) * shape.height / 2,
      };
    });
  }
  const geometry = coneSectorGeometry(shape);
  const arc = Array.from({ length: segments + 1 }, (_, index) => {
    const angle =
      -geometry.parameterHalfAngle +
      (index / segments) * geometry.parameterHalfAngle * 2;
    return {
      x: -shape.width / 2 + Math.cos(angle) * shape.width,
      y: Math.sin(angle) * geometry.radiusY,
    };
  });
  return [{ x: -shape.width / 2, y: 0 }, ...arc];
}

export function shapeDistance(scene: Pick<SceneRecord, 'distance' | 'pixelScale'>, pixels: number) {
  return (pixels / scene.pixelScale) * scene.distance;
}
