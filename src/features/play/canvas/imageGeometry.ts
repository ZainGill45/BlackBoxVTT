import type {
  SceneGrid,
  SceneImage,
  SceneImageLayer,
  SceneImageLayers,
  SceneMapImage,
} from '../../../shared/scenes';

export interface Point {
  x: number;
  y: number;
}

export interface Rectangle {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

export function roundTransform<T extends SceneMapImage>(image: T): T {
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  const rotation = round(((image.rotation % 360) + 360) % 360);
  return {
    ...image,
    height: Math.max(1, round(image.height)),
    rotation: rotation >= 360 ? 0 : rotation,
    width: Math.max(1, round(image.width)),
    x: round(image.x),
    y: round(image.y),
  };
}

export function localToWorld(
  image: SceneMapImage,
  localX: number,
  localY: number,
): Point {
  const radians = (image.rotation * Math.PI) / 180;
  return {
    x: image.x + Math.cos(radians) * localX - Math.sin(radians) * localY,
    y: image.y + Math.sin(radians) * localX + Math.cos(radians) * localY,
  };
}

export function corners(image: SceneMapImage): Point[] {
  const halfWidth = image.width / 2;
  const halfHeight = image.height / 2;
  return [
    localToWorld(image, -halfWidth, -halfHeight),
    localToWorld(image, halfWidth, -halfHeight),
    localToWorld(image, halfWidth, halfHeight),
    localToWorld(image, -halfWidth, halfHeight),
  ];
}

export function containsPoint(image: SceneMapImage, point: Point): boolean {
  const radians = (-image.rotation * Math.PI) / 180;
  const dx = point.x - image.x;
  const dy = point.y - image.y;
  const localX = Math.cos(radians) * dx - Math.sin(radians) * dy;
  const localY = Math.sin(radians) * dx + Math.cos(radians) * dy;
  return (
    Math.abs(localX) <= image.width / 2 &&
    Math.abs(localY) <= image.height / 2
  );
}

export function bounds(images: readonly SceneMapImage[]) {
  const points = images.flatMap(corners);
  return {
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
  };
}

function clipPolygon(
  polygon: Point[],
  inside: (point: Point) => boolean,
  intersection: (start: Point, end: Point) => Point,
): Point[] {
  const result: Point[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const startInside = inside(start);
    const endInside = inside(end);
    if (startInside && endInside) {
      result.push(end);
    } else if (startInside) {
      result.push(intersection(start, end));
    } else if (endInside) {
      result.push(intersection(start, end), end);
    }
  }
  return result;
}

function polygonArea(points: Point[]): number {
  if (points.length < 3) {
    return 0;
  }
  return (
    Math.abs(
      points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length];
        return sum + point.x * next.y - next.x * point.y;
      }, 0),
    ) / 2
  );
}

/** Fraction of a rotated image rectangle covered by a world-axis marquee. */
export function rectangleCoverage(
  image: SceneMapImage,
  rectangle: Rectangle,
): number {
  let polygon = corners(image);
  const verticalIntersection =
    (x: number) =>
    (start: Point, end: Point): Point => {
      const ratio = (x - start.x) / (end.x - start.x);
      return { x, y: start.y + (end.y - start.y) * ratio };
    };
  const horizontalIntersection =
    (y: number) =>
    (start: Point, end: Point): Point => {
      const ratio = (y - start.y) / (end.y - start.y);
      return { x: start.x + (end.x - start.x) * ratio, y };
    };
  polygon = clipPolygon(
    polygon,
    (point) => point.x >= rectangle.minX,
    verticalIntersection(rectangle.minX),
  );
  polygon = clipPolygon(
    polygon,
    (point) => point.x <= rectangle.maxX,
    verticalIntersection(rectangle.maxX),
  );
  polygon = clipPolygon(
    polygon,
    (point) => point.y >= rectangle.minY,
    horizontalIntersection(rectangle.minY),
  );
  polygon = clipPolygon(
    polygon,
    (point) => point.y <= rectangle.maxY,
    horizontalIntersection(rectangle.maxY),
  );
  return polygonArea(polygon) / Math.max(1, image.width * image.height);
}

export function snapValue(value: number, size: number, offset: number): number {
  return Math.round((value - offset) / size) * size + offset;
}

export function snappingActive(grid: SceneGrid, altLeft: boolean): boolean {
  return (grid.type === 'square') !== altLeft;
}

export function snapMove<T extends SceneMapImage>(
  image: T,
  grid: SceneGrid,
): T {
  const topLeft = corners(image)[0];
  return {
    ...image,
    x: image.x + snapValue(topLeft.x, grid.size, grid.offsetX) - topLeft.x,
    y: image.y + snapValue(topLeft.y, grid.size, grid.offsetY) - topLeft.y,
  };
}

export function reorderSelected(
  images: SceneImage[],
  selected: Set<string>,
  direction: 'back' | 'backward' | 'forward' | 'front',
): SceneImage[] {
  if (direction === 'front') {
    return [
      ...images.filter((image) => !selected.has(image.id)),
      ...images.filter((image) => selected.has(image.id)),
    ];
  }
  if (direction === 'back') {
    return [
      ...images.filter((image) => selected.has(image.id)),
      ...images.filter((image) => !selected.has(image.id)),
    ];
  }
  const next = [...images];
  if (direction === 'forward') {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      if (
        selected.has(next[index].id) &&
        !selected.has(next[index + 1].id)
      ) {
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
      }
    }
  } else {
    for (let index = 1; index < next.length; index += 1) {
      if (
        selected.has(next[index].id) &&
        !selected.has(next[index - 1].id)
      ) {
        [next[index], next[index - 1]] = [next[index - 1], next[index]];
      }
    }
  }
  return next;
}

export function moveBetweenLayers(
  layers: SceneImageLayers,
  from: SceneImageLayer,
  to: SceneImageLayer,
  selected: Set<string>,
): SceneImageLayers {
  if (from === to) {
    return layers;
  }
  const moved = layers[from].filter((image) => selected.has(image.id));
  return {
    ...layers,
    [from]: layers[from].filter((image) => !selected.has(image.id)),
    [to]: [...layers[to], ...moved],
  };
}
