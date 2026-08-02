import { Sprite, Texture } from 'pixi.js';
import type {
  SceneFog,
  SceneFogOperation,
  SceneFogPoint,
  SceneRecord,
} from '../../../shared/scenes';
import { sceneToScreen, type Camera, type Viewport } from './camera';
import { softBrushPasses } from './softBrush';

export interface FogRenderInput {
  camera: Camera;
  gmOpacity: number;
  isGameMaster: boolean;
  operations?: SceneFogOperation[];
  scene: SceneRecord | null;
  viewport: Viewport;
}

function segmentDistance(
  point: SceneFogPoint,
  start: SceneFogPoint,
  end: SceneFogPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const amount = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(
    point.x - (start.x + dx * amount),
    point.y - (start.y + dy * amount),
  );
}

export function fogOperationContainsPoint(
  operation: SceneFogOperation,
  point: SceneFogPoint,
): boolean {
  if (operation.kind === 'box') {
    return point.x >= operation.x &&
      point.x <= operation.x + operation.width &&
      point.y >= operation.y &&
      point.y <= operation.y + operation.height;
  }
  const radius = operation.width / 2;
  if (operation.points.length === 1) {
    return segmentDistance(point, operation.points[0], operation.points[0]) <= radius;
  }
  for (let index = 1; index < operation.points.length; index += 1) {
    if (
      segmentDistance(point, operation.points[index - 1], operation.points[index]) <=
      radius
    ) {
      return true;
    }
  }
  return false;
}

export function fogCoversPoint(fog: SceneFog, point: SceneFogPoint): boolean {
  let covered = fog.base === 'covered';
  for (const operation of fog.operations) {
    if (fogOperationContainsPoint(operation, point)) {
      covered = operation.mode === 'hide';
    }
  }
  return covered;
}

function traceBrush(
  context: CanvasRenderingContext2D,
  points: SceneFogPoint[],
  width: number,
): void {
  context.beginPath();
  if (points.length === 1) {
    context.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) {
    context.lineTo(point.x, point.y);
  }
  context.stroke();
}

export function drawFogOperation(
  context: CanvasRenderingContext2D,
  operation: SceneFogOperation,
  camera: Camera,
  viewport: Viewport,
): void {
  context.globalCompositeOperation =
    operation.mode === 'hide' ? 'source-over' : 'destination-out';
  if (operation.kind === 'box') {
    const topLeft = sceneToScreen(camera, viewport, {
      x: operation.x,
      y: operation.y,
    });
    context.globalAlpha = 1;
    context.fillRect(
      topLeft.x,
      topLeft.y,
      operation.width * camera.zoom,
      operation.height * camera.zoom,
    );
    return;
  }
  const points = operation.points.map((point) =>
    sceneToScreen(camera, viewport, point),
  );
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const pass of softBrushPasses(
    operation.width * camera.zoom,
    1,
    operation.hardness,
  )) {
    context.globalAlpha = pass.alpha;
    context.lineWidth = pass.width;
    traceBrush(context, points, pass.width);
  }
}

export class SceneFogRenderer {
  readonly sprite = new Sprite();
  private readonly canvas = document.createElement('canvas');
  private context: CanvasRenderingContext2D | null = null;
  private texture: Texture | null = null;

  render({
    camera,
    gmOpacity,
    isGameMaster,
    operations = [],
    scene,
    viewport,
  }: FogRenderInput): void {
    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));
    if (!this.texture || this.canvas.width !== width || this.canvas.height !== height) {
      this.texture?.destroy(true);
      this.canvas.width = width;
      this.canvas.height = height;
      this.context = this.canvas.getContext('2d');
      this.texture = Texture.from(this.canvas);
      this.sprite.texture = this.texture;
    }
    this.sprite.width = width;
    this.sprite.height = height;
    this.sprite.alpha = isGameMaster ? gmOpacity : 1;
    this.sprite.visible = Boolean(scene);
    const context = this.context;
    if (!context || !scene) {
      return;
    }
    context.clearRect(0, 0, width, height);
    context.save();
    const topLeft = sceneToScreen(camera, viewport, { x: 0, y: 0 });
    context.beginPath();
    context.rect(
      topLeft.x,
      topLeft.y,
      scene.width * camera.zoom,
      scene.height * camera.zoom,
    );
    context.clip();
    context.fillStyle = scene.fog.color;
    context.strokeStyle = scene.fog.color;
    if (scene.fog.base === 'covered') {
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.fillRect(
        topLeft.x,
        topLeft.y,
        scene.width * camera.zoom,
        scene.height * camera.zoom,
      );
    }
    for (const operation of [...scene.fog.operations, ...operations]) {
      drawFogOperation(context, operation, camera, viewport);
    }
    context.restore();
    const source = this.texture.source as { update?: () => void };
    source.update?.();
  }

  destroy(): void {
    this.sprite.parent?.removeChild(this.sprite);
    this.sprite.destroy();
    this.texture?.destroy(true);
    this.texture = null;
    this.context = null;
  }
}
