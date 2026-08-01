import { Container, Graphics } from 'pixi.js';
import type { SceneDrawing, SceneDrawingLayers } from '../../../shared/scenes';
import { softBrushPasses } from './softBrush';

export interface DrawingGraphics {
  circle(x: number, y: number, radius: number): DrawingGraphics;
  fill(options: { alpha?: number; color: number }): DrawingGraphics;
  lineTo(x: number, y: number): DrawingGraphics;
  moveTo(x: number, y: number): DrawingGraphics;
  stroke(options: {
    alpha?: number;
    cap?: 'round';
    color: number;
    join?: 'round';
    width: number;
  }): DrawingGraphics;
}

export function strokeDrawingPath(
  graphics: DrawingGraphics,
  drawing: Pick<SceneDrawing, 'closed' | 'points' | 'style'>,
): void {
  const points = drawing.points;
  const color = Number.parseInt(drawing.style.strokeColor.slice(1), 16);
  const passes =
    drawing.style.edge === 'soft'
      ? softBrushPasses(
          drawing.style.strokeWidth,
          drawing.style.strokeOpacity,
          drawing.style.hardness,
        )
      : [
          {
            alpha: drawing.style.strokeOpacity,
            width: drawing.style.strokeWidth,
          },
        ];
  if (points.length === 1) {
    const point = points[0];
    for (const pass of passes) {
      graphics
        .circle(point.x, point.y, pass.width / 2)
        .fill({ alpha: pass.alpha, color });
    }
    return;
  }
  const trace = () => {
    graphics.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      graphics.lineTo(points[index].x, points[index].y);
    }
    if (drawing.closed) {
      graphics.lineTo(points[0].x, points[0].y);
    }
  };
  if (drawing.closed && drawing.style.fillEnabled) {
    trace();
    graphics.fill({
      alpha: drawing.style.fillOpacity,
      color: Number.parseInt(drawing.style.fillColor.slice(1), 16),
    });
  }
  for (const pass of passes) {
    trace();
    graphics.stroke({
      alpha: pass.alpha,
      cap: 'round',
      color,
      join: 'round',
      width: pass.width,
    });
  }
}

export class SceneDrawingRenderer {
  private readonly graphics = new Map<string, Graphics>();

  constructor(
    private readonly mapWorld: Container,
    private readonly tokenWorld: Container,
    private readonly gmWorld: Container,
  ) {}

  clear(): void {
    for (const [id, graphics] of this.graphics) {
      graphics.parent?.removeChild(graphics);
      graphics.destroy();
      this.graphics.delete(id);
    }
  }

  render(layers: SceneDrawingLayers | null): void {
    if (!layers) {
      this.clear();
      return;
    }
    const wanted = new Set<string>();
    for (const layer of ['map', 'token', 'gm'] as const) {
      const container =
        layer === 'map'
          ? this.mapWorld
          : layer === 'token'
            ? this.tokenWorld
            : this.gmWorld;
      for (let index = 0; index < layers[layer].length; index += 1) {
        const drawing = layers[layer][index];
        wanted.add(drawing.id);
        let graphics = this.graphics.get(drawing.id);
        if (!graphics) {
          graphics = new Graphics();
          this.graphics.set(drawing.id, graphics);
          container.addChild(graphics);
        } else if (graphics.parent !== container) {
          graphics.parent?.removeChild(graphics);
          container.addChild(graphics);
        }
        graphics.clear();
        strokeDrawingPath(graphics, drawing);
        graphics.position.set(drawing.x, drawing.y);
        graphics.scale.set(drawing.scaleX, drawing.scaleY);
        graphics.angle = drawing.rotation;
        graphics.zIndex = 1_000_000 + index;
      }
    }
    for (const [id, graphics] of this.graphics) {
      if (!wanted.has(id)) {
        graphics.parent?.removeChild(graphics);
        graphics.destroy();
        this.graphics.delete(id);
      }
    }
    this.mapWorld.sortChildren();
    this.tokenWorld.sortChildren();
    this.gmWorld.sortChildren();
  }
}
