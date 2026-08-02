import {
  Container,
  Graphics,
  Text,
  Texture,
  TilingSprite,
  type TextStyleOptions,
} from 'pixi.js';
import {
  SCENE_LAYERS,
  type SceneRecord,
  type SceneShape,
  type SceneShapeLayers,
} from '../../../shared/scenes';
import { formatMeasurementDistance } from './measurement';
import {
  coneSectorCentroid,
  fromShapeLocal,
  shapeDistance,
  shapePath,
  type Point,
} from './shapeGeometry';
import { sceneTextFontStack } from './sceneTextRenderer';
import { sceneObjectZIndex } from './sceneObjectOrder';
const HATCH_TILE_SIZE = 24;

export interface ShapeRenderView {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

function color(value: string): number {
  return Number.parseInt(value.slice(1), 16);
}

function trace(graphics: Graphics, points: Point[], close = true): void {
  if (points.length === 0) return;
  graphics.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    graphics.lineTo(points[index].x, points[index].y);
  }
  if (close) graphics.lineTo(points[0].x, points[0].y);
}

function patternedPath(
  graphics: Graphics,
  points: Point[],
  dash: number,
  gap: number,
  close = true,
  shape?: SceneShape,
  view?: ShapeRenderView,
): void {
  const edgeCount = close ? points.length : points.length - 1;
  for (let edge = 0; edge < edgeCount; edge += 1) {
    const start = points[edge];
    const end = points[(edge + 1) % points.length];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length === 0) continue;
    const clipped = shape && view
      ? clipSegmentToView(shape, start, end, view)
      : { end: 1, start: 0 };
    if (!clipped) continue;
    const visibleStart = clipped.start * length;
    const visibleEnd = clipped.end * length;
    const period = dash + gap;
    const firstDash = Math.floor(visibleStart / period) * period;
    for (let offset = firstDash; offset < visibleEnd; offset += period) {
      const from = Math.max(visibleStart, offset) / length;
      const to = Math.min(visibleEnd, offset + dash) / length;
      if (to <= from) continue;
      graphics
        .moveTo(start.x + (end.x - start.x) * from, start.y + (end.y - start.y) * from)
        .lineTo(start.x + (end.x - start.x) * to, start.y + (end.y - start.y) * to);
    }
  }
}

function clipSegmentToView(
  shape: SceneShape,
  start: Point,
  end: Point,
  view: ShapeRenderView,
): { end: number; start: number } | null {
  const worldStart = fromShapeLocal(shape, start);
  const worldEnd = fromShapeLocal(shape, end);
  const dx = worldEnd.x - worldStart.x;
  const dy = worldEnd.y - worldStart.y;
  let first = 0;
  let last = 1;
  for (const [p, q] of [
    [-dx, worldStart.x - view.minX],
    [dx, view.maxX - worldStart.x],
    [-dy, worldStart.y - view.minY],
    [dy, view.maxY - worldStart.y],
  ] as const) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return null;
      continue;
    }
    const ratio = q / p;
    if (p < 0) {
      first = Math.max(first, ratio);
    } else {
      last = Math.min(last, ratio);
    }
    if (first > last) return null;
  }
  return { end: last, start: first };
}

function isShapeVisible(shape: SceneShape, view?: ShapeRenderView): boolean {
  if (!view) return true;
  const radius = Math.hypot(shape.width, shape.height) / 2;
  return shape.x + radius >= view.minX &&
    shape.x - radius <= view.maxX &&
    shape.y + radius >= view.minY &&
    shape.y - radius <= view.maxY;
}

function makeHatchTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = HATCH_TILE_SIZE;
  canvas.height = HATCH_TILE_SIZE;
  if (typeof CanvasRenderingContext2D !== 'undefined') {
    const context = canvas.getContext('2d');
    if (context) {
      context.clearRect(0, 0, HATCH_TILE_SIZE, HATCH_TILE_SIZE);
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1;
      context.beginPath();
      for (let offset = -HATCH_TILE_SIZE; offset <= HATCH_TILE_SIZE * 2; offset += 12) {
        context.moveTo(offset, 0);
        context.lineTo(offset + HATCH_TILE_SIZE, HATCH_TILE_SIZE);
        context.moveTo(offset, HATCH_TILE_SIZE);
        context.lineTo(offset + HATCH_TILE_SIZE, 0);
      }
      context.stroke();
    }
  }
  return Texture.from(canvas);
}

function readableShapeLabelAngle(angle: number): number {
  const normalized = ((angle % 360) + 360) % 360;
  return normalized > 90 && normalized < 270 ? normalized + 180 : normalized;
}

function labelStyle(shape: SceneShape): TextStyleOptions {
  return {
    fill: shape.style.fontColor,
    fontFamily: sceneTextFontStack(shape.style.fontFamily),
    fontSize: shape.style.fontSize,
    fontWeight: String(shape.style.fontWeight) as TextStyleOptions['fontWeight'],
    padding: shape.style.fontStrokeWidth + 2,
    stroke: shape.style.fontStrokeWidth > 0
      ? { color: shape.style.fontStrokeColor, width: shape.style.fontStrokeWidth }
      : undefined,
  };
}

export class SceneShapeRenderer {
  private readonly graphics = new Map<string, Graphics>();
  private readonly hatches = new Map<
    string,
    { mask: Graphics; sprite: TilingSprite }
  >();
  private readonly labels = new Map<string, Text[]>();
  private readonly labelStyleKeys = new Map<string, string>();
  private readonly renderKeys = new Map<string, string>();
  private hatchTexture: Texture | null = null;

  constructor(
    private readonly mapWorld: Container,
    private readonly tokenWorld: Container,
    private readonly gmWorld: Container,
  ) {}

  clear(): void {
    for (const instance of this.graphics.values()) {
      instance.parent?.removeChild(instance);
      instance.destroy();
    }
    for (const texts of this.labels.values()) {
      for (const text of texts) {
        text.parent?.removeChild(text);
        text.destroy();
      }
    }
    for (const hatch of this.hatches.values()) {
      hatch.sprite.parent?.removeChild(hatch.sprite);
      hatch.mask.parent?.removeChild(hatch.mask);
      hatch.sprite.destroy();
      hatch.mask.destroy();
    }
    this.graphics.clear();
    this.hatches.clear();
    this.labels.clear();
    this.labelStyleKeys.clear();
    this.renderKeys.clear();
    this.hatchTexture?.destroy(true);
    this.hatchTexture = null;
  }

  render(
    layers: SceneShapeLayers | null,
    scene: SceneRecord | null,
    zoom: number,
    view?: ShapeRenderView,
  ): void {
    if (!layers || !scene) {
      this.clear();
      return;
    }
    const wanted = new Set<string>();
    for (const layer of SCENE_LAYERS) {
      const container = layer === 'map' ? this.mapWorld : layer === 'token' ? this.tokenWorld : this.gmWorld;
      for (let index = 0; index < layers[layer].length; index += 1) {
        const shape = layers[layer][index];
        wanted.add(shape.id);
        let graphics = this.graphics.get(shape.id);
        if (!graphics) {
          graphics = new Graphics();
          this.graphics.set(shape.id, graphics);
          container.addChild(graphics);
        } else if (graphics.parent !== container) {
          graphics.parent?.removeChild(graphics);
          container.addChild(graphics);
        }
        const visible = isShapeVisible(shape, view);
        graphics.visible = visible;
        for (const text of this.labels.get(shape.id) ?? []) {
          text.visible = visible;
        }
        const existingHatch = this.hatches.get(shape.id);
        if (existingHatch) {
          if (existingHatch.sprite.parent !== container) {
            existingHatch.sprite.parent?.removeChild(existingHatch.sprite);
            existingHatch.mask.parent?.removeChild(existingHatch.mask);
            container.addChild(existingHatch.mask);
            container.addChild(existingHatch.sprite);
          }
          existingHatch.sprite.visible = visible;
          existingHatch.mask.visible = visible;
        }
        if (!visible) {
          continue;
        }
        const renderKey = JSON.stringify([
          shape,
          scene.distance,
          scene.objectOrder[layer].indexOf(shape.id),
          scene.pixelScale,
          scene.unit,
          zoom,
        ]);
        if (this.renderKeys.get(shape.id) === renderKey) {
          continue;
        }
        graphics.clear();
        const path = shapePath(shape);
        if (shape.style.backgroundType === 'fill') {
          trace(graphics, path);
          graphics.fill({ alpha: shape.style.backgroundOpacity, color: color(shape.style.backgroundColor) });
        } else if (shape.style.backgroundType === 'crosshatched') {
          this.hatchTexture ??= makeHatchTexture();
          let hatch = this.hatches.get(shape.id);
          if (!hatch) {
            const mask = new Graphics();
            const sprite = new TilingSprite({
              anchor: 0.5,
              applyAnchorToTexture: true,
              texture: this.hatchTexture,
            });
            sprite.mask = mask;
            hatch = { mask, sprite };
            this.hatches.set(shape.id, hatch);
            container.addChild(mask);
            container.addChild(sprite);
          }
          if (hatch.sprite.parent !== container) {
            hatch.sprite.parent?.removeChild(hatch.sprite);
            hatch.mask.parent?.removeChild(hatch.mask);
            container.addChild(hatch.mask);
            container.addChild(hatch.sprite);
          }
          hatch.mask.clear();
          trace(hatch.mask, path);
          hatch.mask.fill({ color: 0xffffff });
          hatch.mask.position.set(shape.x, shape.y);
          hatch.mask.angle = shape.rotation;
          hatch.mask.zIndex = sceneObjectZIndex(
            scene.objectOrder,
            layer,
            shape.id,
            index,
            0,
          );
          hatch.sprite.alpha = shape.style.backgroundOpacity;
          hatch.sprite.angle = shape.rotation;
          hatch.sprite.height = shape.height;
          hatch.sprite.position.set(shape.x, shape.y);
          hatch.sprite.tileScale.set(1 / zoom);
          hatch.sprite.tint = color(shape.style.backgroundColor);
          hatch.sprite.width = shape.width;
          hatch.sprite.zIndex = sceneObjectZIndex(
            scene.objectOrder,
            layer,
            shape.id,
            index,
            0,
          );
        }
        if (shape.style.backgroundType !== 'crosshatched') {
          const hatch = this.hatches.get(shape.id);
          if (hatch) {
            hatch.sprite.parent?.removeChild(hatch.sprite);
            hatch.mask.parent?.removeChild(hatch.mask);
            hatch.sprite.destroy();
            hatch.mask.destroy();
            this.hatches.delete(shape.id);
          }
        }
        if (shape.style.strokeOpacity > 0) {
          if (shape.style.strokeType === 'solid') {
            trace(graphics, path);
          } else {
            const dot = shape.style.strokeType === 'dotted';
            patternedPath(
              graphics,
              path,
              (dot ? 1 : 8) / zoom,
              (dot ? 5 : 6) / zoom,
              true,
              shape,
              view,
            );
          }
          graphics.stroke({ alpha: shape.style.strokeOpacity, color: color(shape.style.strokeColor), width: shape.style.strokeWidth / zoom });
        }
        const labelDescriptions: Array<{
          angle: number;
          content: string;
          localPoint: Point;
        }> = [];
        const addLabel = (
          content: string,
          localPoint: Point,
          angle: number,
        ) => {
          labelDescriptions.push({ angle, content, localPoint });
        };
        if (shape.kind === 'sphere') {
          const isEllipse = Math.abs(shape.width - shape.height) > 0.01;
          addLabel(
            `${isEllipse ? 'rₓ' : 'r'} = ${formatMeasurementDistance(shapeDistance(scene, shape.width / 2), scene.unit)}`,
            isEllipse
              ? { x: shape.width / 4, y: -12 / zoom }
              : { x: 0, y: 0 },
            shape.rotation,
          );
          if (isEllipse) {
            addLabel(
              `rᵧ = ${formatMeasurementDistance(shapeDistance(scene, shape.height / 2), scene.unit)}`,
              { x: -12 / zoom, y: shape.height / 4 },
              shape.rotation + 90,
            );
          }
        } else if (shape.kind === 'square') {
          addLabel(
            `w = ${formatMeasurementDistance(shapeDistance(scene, shape.width), scene.unit)}`,
            { x: 0, y: -shape.height / 2 + 18 / zoom },
            shape.rotation,
          );
          addLabel(
            `h = ${formatMeasurementDistance(shapeDistance(scene, shape.height), scene.unit)}`,
            { x: -shape.width / 2 + 18 / zoom, y: 0 },
            shape.rotation + 90,
          );
        } else {
          addLabel(
            `r = ${formatMeasurementDistance(shapeDistance(scene, shape.width), scene.unit)}`,
            coneSectorCentroid(shape),
            shape.rotation,
          );
          addLabel(
            `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, useGrouping: false }).format(shape.spread)}°`,
            {
              x: -shape.width / 2 + Math.min(shape.width / 4, 52 / zoom),
              y: 0,
            },
            shape.rotation,
          );
        }
        graphics.position.set(shape.x, shape.y);
        graphics.angle = shape.rotation;
        graphics.zIndex = sceneObjectZIndex(
          scene.objectOrder,
          layer,
          shape.id,
          index,
          1,
        );
        const texts = this.labels.get(shape.id) ?? [];
        while (texts.length < labelDescriptions.length) {
          const text = new Text({
            anchor: 0.5,
            style: labelStyle(shape),
            text: '',
          });
          container.addChild(text);
          texts.push(text);
        }
        while (texts.length > labelDescriptions.length) {
          const text = texts.pop();
          text?.parent?.removeChild(text);
          text?.destroy();
        }
        const styleKey = JSON.stringify(shape.style);
        const styleChanged = this.labelStyleKeys.get(shape.id) !== styleKey;
        for (let labelIndex = 0; labelIndex < texts.length; labelIndex += 1) {
          const text = texts[labelIndex];
          const description = labelDescriptions[labelIndex];
          if (text.parent !== container) {
            text.parent?.removeChild(text);
            container.addChild(text);
          }
          if (text.text !== description.content) {
            text.text = description.content;
          }
          if (styleChanged) {
            text.style = labelStyle(shape);
          }
          const point = fromShapeLocal(shape, description.localPoint);
          text.position.set(point.x, point.y);
          text.scale.set(1 / zoom);
          text.angle = readableShapeLabelAngle(description.angle);
          text.visible = visible;
          text.zIndex = sceneObjectZIndex(
            scene.objectOrder,
            layer,
            shape.id,
            index,
            2,
          );
        }
        this.labelStyleKeys.set(shape.id, styleKey);
        this.labels.set(shape.id, texts);
        this.renderKeys.set(shape.id, renderKey);
      }
    }
    for (const [id, graphics] of this.graphics) {
      if (!wanted.has(id)) {
        graphics.parent?.removeChild(graphics);
        graphics.destroy();
        this.graphics.delete(id);
        for (const text of this.labels.get(id) ?? []) {
          text.parent?.removeChild(text);
          text.destroy();
        }
        this.labels.delete(id);
        this.labelStyleKeys.delete(id);
        const hatch = this.hatches.get(id);
        if (hatch) {
          hatch.sprite.parent?.removeChild(hatch.sprite);
          hatch.mask.parent?.removeChild(hatch.mask);
          hatch.sprite.destroy();
          hatch.mask.destroy();
          this.hatches.delete(id);
        }
        this.renderKeys.delete(id);
      }
    }
    this.mapWorld.sortChildren(); this.tokenWorld.sortChildren(); this.gmWorld.sortChildren();
  }
}
