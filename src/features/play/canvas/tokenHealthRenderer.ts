import { Container, Graphics } from 'pixi.js';
import {
  DEFAULT_GRID_SIZE,
  isSceneToken,
  SCENE_LAYERS,
  type SceneRecord,
  type SceneTokenHealthPresentation,
} from '../../../shared/scenes';
import { sceneObjectZIndex } from './sceneObjectOrder';

/**
 * Bar geometry is scene units at the default grid, so a bar keeps one apparent
 * size at every zoom and stays uniform across tokens of differing sizes.
 */
const BAR_THICKNESS_UNITS = 7;
const BAR_GAP_UNITS = 5;
const BAR_BORDER_UNITS = 1;
const BAR_OVERHANG_UNITS = 3;
const DOWN_STROKE_UNITS = 4;

/** A bar's rectangle in scene units, before the camera is applied. */
interface BarGeometry {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface BarToken {
  height: number;
  width: number;
  x: number;
  y: number;
}

/**
 * The single source of a bar's rectangle.
 */
function barGeometry(token: BarToken, scale: number): BarGeometry {
  const thickness = BAR_THICKNESS_UNITS * scale;
  const width = token.width + BAR_OVERHANG_UNITS * scale * 2;
  return {
    height: thickness,
    left: token.x - width / 2,
    top: token.y - token.height / 2 - BAR_GAP_UNITS * scale - thickness,
    width,
  };
}

interface LayerContainers {
  gm: Container;
  map: Container;
  token: Container;
}

function gridScale(scene: SceneRecord): number {
  return scene.grid.size / DEFAULT_GRID_SIZE;
}

/** Draws system-provided health without knowing which game-system fields own it. */
export class TokenHealthRenderer {
  private readonly containers: LayerContainers;
  private readonly graphics = new Map<string, Graphics>();
  private health = new Map<string, SceneTokenHealthPresentation>();

  constructor(containers: LayerContainers) {
    this.containers = containers;
  }

  setHealth(health: readonly SceneTokenHealthPresentation[]): void {
    this.health = new Map(health.map((value) => [value.tokenId, value]));
  }

  render(scene: SceneRecord | null): void {
    const wanted = new Set<string>();
    if (scene) {
      const scale = gridScale(scene);
      const border = BAR_BORDER_UNITS * scale;
      for (const layer of SCENE_LAYERS) {
        for (
          let imageIndex = 0;
          imageIndex < scene.images[layer].length;
          imageIndex += 1
        ) {
          const token = scene.images[layer][imageIndex];
          if (!isSceneToken(token)) continue;
          const health = this.health.get(token.id);
          if (!health) continue;
          wanted.add(token.id);
          let graphic = this.graphics.get(token.id);
          if (!graphic) {
            graphic = new Graphics();
            graphic.eventMode = 'none';
            this.graphics.set(token.id, graphic);
            this.containers[layer].addChild(graphic);
          } else if (graphic.parent !== this.containers[layer]) {
            graphic.parent?.removeChild(graphic);
            this.containers[layer].addChild(graphic);
          }
          graphic.clear();
          graphic.zIndex = sceneObjectZIndex(
            scene.objectOrder,
            layer,
            token.id,
            imageIndex,
            2,
          );
          const bar = barGeometry(token, scale);
          graphic
            .rect(bar.left, bar.top, bar.width, bar.height)
            .fill({ color: 0x16161a, alpha: 0.92 });
          if (health.ratio > 0) {
            graphic
              .rect(bar.left, bar.top, bar.width * health.ratio, bar.height)
              .fill({ color: 0xe02626, alpha: 1 });
          }
          graphic
            .rect(bar.left, bar.top, bar.width, bar.height)
            .stroke({
              alpha: 1,
              color: 0x000000,
              width: border,
            });
          if (health.down) {
            const halfWidth = token.width * 0.38;
            const halfHeight = token.height * 0.38;
            graphic
              .moveTo(token.x - halfWidth, token.y - halfHeight)
              .lineTo(token.x + halfWidth, token.y + halfHeight)
              .moveTo(token.x + halfWidth, token.y - halfHeight)
              .lineTo(token.x - halfWidth, token.y + halfHeight)
              .stroke({
                color: 0xe02626,
                width: DOWN_STROKE_UNITS * scale,
              });
          }
        }
      }
    }
    for (const [tokenId, graphic] of this.graphics) {
      if (wanted.has(tokenId)) continue;
      graphic.parent?.removeChild(graphic);
      graphic.destroy();
      this.graphics.delete(tokenId);
    }
  }

  destroy(): void {
    for (const graphic of this.graphics.values()) {
      graphic.parent?.removeChild(graphic);
      graphic.destroy();
    }
    this.graphics.clear();
    this.health.clear();
  }
}
