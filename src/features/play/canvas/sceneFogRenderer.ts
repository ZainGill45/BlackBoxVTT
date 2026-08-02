import {
  Container,
  Graphics,
  RenderTexture,
  Sprite,
  type Application,
} from 'pixi.js';
import type {
  SceneFog,
  SceneFogOperation,
  SceneFogPoint,
  SceneRecord,
} from '../../../shared/scenes';
import type { Camera, Viewport } from './camera';
import { softBrushPasses } from './softBrush';

type PixiRenderer = Pick<Application['renderer'], 'render'>;

const MAX_COMMITTED_FOG_TEXTURE_DIMENSION = 4_096;

export interface FogRenderInput {
  camera: Camera;
  gmOpacity: number;
  isGameMaster: boolean;
  localOperation?: SceneFogOperation | null;
  scene: SceneRecord | null;
  viewport: Viewport;
}

interface LiveFogState {
  cameraKey: string;
  hardness?: number;
  id: string;
  kind: SceneFogOperation['kind'];
  mode: SceneFogOperation['mode'];
  pointCount: number;
  width: number;
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

/**
 * Large scenes keep their logical dimensions while the backing GPU texture is
 * capped to a safe desktop WebGL size. Pixi applies the fractional resolution
 * when rendering, so all fog geometry can stay in scene coordinates.
 */
export function committedFogTextureResolution(
  scene: Pick<SceneRecord, 'height' | 'width'>,
): number {
  return Math.min(
    1,
    MAX_COMMITTED_FOG_TEXTURE_DIMENSION / scene.width,
    MAX_COMMITTED_FOG_TEXTURE_DIMENSION / scene.height,
  );
}

function drawBrush(
  graphics: Graphics,
  operation: Extract<SceneFogOperation, { kind: 'brush' }>,
  color: string,
): void {
  for (const pass of softBrushPasses(
    operation.width,
    1,
    operation.hardness,
  )) {
    if (operation.points.length === 1) {
      graphics
        .circle(operation.points[0].x, operation.points[0].y, pass.width / 2)
        .fill({ alpha: pass.alpha, color });
      continue;
    }
    graphics.moveTo(operation.points[0].x, operation.points[0].y);
    for (let index = 1; index < operation.points.length; index += 1) {
      graphics.lineTo(operation.points[index].x, operation.points[index].y);
    }
    graphics.stroke({
      alpha: pass.alpha,
      cap: 'round',
      color,
      join: 'round',
      width: pass.width,
    });
  }
}

function operationGraphics(
  operation: SceneFogOperation,
  color: string,
  asMask = false,
): Graphics {
  const graphics = new Graphics();
  graphics.blendMode = asMask || operation.mode === 'hide' ? 'normal' : 'erase';
  if (operation.kind === 'box') {
    graphics
      .rect(operation.x, operation.y, operation.width, operation.height)
      .fill({ color });
  } else {
    drawBrush(graphics, operation, color);
  }
  return graphics;
}

function screenFogRoot(
  scene: SceneRecord,
  camera: Camera,
  viewport: Viewport,
): { content: Container; root: Container } {
  const root = new Container();
  root.scale.set(camera.zoom);
  root.position.set(
    viewport.width / 2 - camera.x * camera.zoom,
    viewport.height / 2 - camera.y * camera.zoom,
  );
  const content = new Container();
  const clip = new Graphics()
    .rect(0, 0, scene.width, scene.height)
    .fill({ color: 0xffffff });
  content.mask = clip;
  root.addChild(content);
  root.addChild(clip);
  return { content, root };
}

function sameLiveBrush(
  state: LiveFogState | null,
  operation: Extract<SceneFogOperation, { kind: 'brush' }>,
  cameraKey: string,
): boolean {
  return state?.cameraKey === cameraKey &&
    state.id === operation.id &&
    state.kind === 'brush' &&
    state.mode === operation.mode &&
    state.width === operation.width &&
    state.hardness === operation.hardness &&
    state.pointCount <= operation.points.length;
}

/**
 * Keeps committed fog in a camera-independent GPU texture. Camera changes only
 * update the displayed sprite transform; they never replay fog operations.
 * Live brush input remains in a separate viewport texture and appends only the
 * newly accepted path segment while the camera is unchanged.
 */
export class SceneFogRenderer {
  readonly sprite = new Sprite();
  private committedBase: SceneFog['base'] | null = null;
  private committedColor: string | null = null;
  private committedOperationIds: string[] = [];
  private committedSceneKey: string | null = null;
  private committedTexture: RenderTexture | null = null;
  private liveState: LiveFogState | null = null;
  private liveTexture: RenderTexture | null = null;
  private outputTexture: RenderTexture | null = null;
  private renderer: PixiRenderer | null = null;
  private viewportKey: string | null = null;

  attach(renderer: PixiRenderer): void {
    this.renderer = renderer;
  }

  render({
    camera,
    gmOpacity,
    isGameMaster,
    localOperation = null,
    scene,
    viewport,
  }: FogRenderInput): void {
    this.sprite.alpha = isGameMaster ? gmOpacity : 1;
    this.sprite.visible = Boolean(scene);
    if (!scene || !this.renderer) {
      return;
    }

    const { committedChanged, viewportChanged } = this.ensureTextures(
      scene,
      viewport,
    );
    if (viewportChanged) {
      this.liveState = null;
    }
    this.syncCommittedFog(scene, committedChanged);

    if (!localOperation) {
      this.liveState = null;
      this.displayCommitted(camera, viewport);
      return;
    }

    this.updateLiveTexture(localOperation, scene, camera, viewport);
    this.composeLive(localOperation.mode, camera, viewport);
  }

  destroy(): void {
    this.sprite.parent?.removeChild(this.sprite);
    this.sprite.destroy();
    this.committedTexture?.destroy(true);
    this.liveTexture?.destroy(true);
    this.outputTexture?.destroy(true);
    this.committedTexture = null;
    this.liveTexture = null;
    this.outputTexture = null;
    this.renderer = null;
  }

  private ensureTextures(
    scene: SceneRecord,
    viewport: Viewport,
  ): { committedChanged: boolean; viewportChanged: boolean } {
    const resolution = committedFogTextureResolution(scene);
    const nextCommittedSceneKey = `${scene.width}:${scene.height}:${resolution}`;
    const committedChanged = this.committedSceneKey !== nextCommittedSceneKey;
    if (committedChanged) {
      this.committedTexture?.destroy(true);
      this.committedTexture = RenderTexture.create({
        height: scene.height,
        resolution,
        width: scene.width,
      });
      this.committedSceneKey = nextCommittedSceneKey;
    }

    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));
    const nextViewportKey = `${width}:${height}`;
    const viewportChanged = this.viewportKey !== nextViewportKey;
    if (viewportChanged) {
      this.liveTexture?.destroy(true);
      this.outputTexture?.destroy(true);
      this.liveTexture = RenderTexture.create({ height, resolution: 1, width });
      this.outputTexture = RenderTexture.create({ height, resolution: 1, width });
      this.viewportKey = nextViewportKey;
    }
    return { committedChanged, viewportChanged };
  }

  private syncCommittedFog(scene: SceneRecord, textureChanged: boolean): void {
    const fog = scene.fog;
    const isAppend = !textureChanged &&
      this.committedBase === fog.base &&
      this.committedColor === fog.color &&
      this.committedOperationIds.length <= fog.operations.length &&
      this.committedOperationIds.every(
        (id, index) => fog.operations[index]?.id === id,
      );

    if (!isAppend) {
      this.rebuildCommitted(scene);
    } else if (fog.operations.length > this.committedOperationIds.length) {
      this.appendCommitted(
        fog.operations.slice(this.committedOperationIds.length),
        fog.color,
      );
    }

    this.committedBase = fog.base;
    this.committedColor = fog.color;
    this.committedOperationIds = fog.operations.map((operation) => operation.id);
  }

  private rebuildCommitted(scene: SceneRecord): void {
    const root = new Container();
    if (scene.fog.base === 'covered') {
      root.addChild(
        new Graphics()
          .rect(0, 0, scene.width, scene.height)
          .fill({ color: scene.fog.color }),
      );
    }
    for (const operation of scene.fog.operations) {
      root.addChild(operationGraphics(operation, scene.fog.color));
    }
    this.renderer!.render({
      clear: true,
      container: root,
      target: this.committedTexture!,
    });
    root.destroy({ children: true });
  }

  private appendCommitted(
    operations: SceneFogOperation[],
    color: string,
  ): void {
    const root = new Container();
    for (const operation of operations) {
      root.addChild(operationGraphics(operation, color));
    }
    this.renderer!.render({
      clear: false,
      container: root,
      target: this.committedTexture!,
    });
    root.destroy({ children: true });
  }

  private updateLiveTexture(
    operation: SceneFogOperation,
    scene: SceneRecord,
    camera: Camera,
    viewport: Viewport,
  ): void {
    const cameraKey = [
      camera.x,
      camera.y,
      camera.zoom,
      viewport.width,
      viewport.height,
    ].join(':');
    if (
      operation.kind === 'brush' &&
      sameLiveBrush(this.liveState, operation, cameraKey)
    ) {
      const previousCount = this.liveState!.pointCount;
      if (operation.points.length > previousCount) {
        const segment = {
          ...operation,
          points: operation.points.slice(Math.max(0, previousCount - 1)),
        };
        this.renderLiveOperation(segment, scene, camera, viewport, false);
      }
    } else {
      this.renderLiveOperation(operation, scene, camera, viewport, true);
    }
    this.liveState = {
      ...(operation.kind === 'brush' ? { hardness: operation.hardness } : {}),
      cameraKey,
      id: operation.id,
      kind: operation.kind,
      mode: operation.mode,
      pointCount: operation.kind === 'brush' ? operation.points.length : 0,
      width: operation.width,
    };
  }

  private renderLiveOperation(
    operation: SceneFogOperation,
    scene: SceneRecord,
    camera: Camera,
    viewport: Viewport,
    clear: boolean,
  ): void {
    const { content, root } = screenFogRoot(scene, camera, viewport);
    content.addChild(operationGraphics(operation, scene.fog.color, true));
    this.renderer!.render({
      clear,
      container: root,
      target: this.liveTexture!,
    });
    root.destroy({ children: true });
  }

  private composeLive(
    mode: SceneFogOperation['mode'],
    camera: Camera,
    viewport: Viewport,
  ): void {
    const root = new Container();
    root.addChild(this.createCommittedSprite(camera, viewport));
    const live = new Sprite();
    live.texture = this.liveTexture!;
    live.blendMode = mode === 'hide' ? 'normal' : 'erase';
    root.addChild(live);
    this.renderer!.render({
      clear: true,
      container: root,
      target: this.outputTexture!,
    });
    root.destroy({ children: true });
    this.displayOutput();
  }

  private createCommittedSprite(
    camera: Camera,
    viewport: Viewport,
  ): Sprite {
    const sprite = new Sprite();
    sprite.texture = this.committedTexture!;
    sprite.position.set(
      viewport.width / 2 - camera.x * camera.zoom,
      viewport.height / 2 - camera.y * camera.zoom,
    );
    sprite.scale.set(camera.zoom);
    return sprite;
  }

  private displayCommitted(
    camera: Camera,
    viewport: Viewport,
  ): void {
    this.sprite.texture = this.committedTexture!;
    this.sprite.position.set(
      viewport.width / 2 - camera.x * camera.zoom,
      viewport.height / 2 - camera.y * camera.zoom,
    );
    this.sprite.scale.set(camera.zoom);
  }

  private displayOutput(): void {
    this.sprite.texture = this.outputTexture!;
    this.sprite.position.set(0, 0);
    this.sprite.scale.set(1);
  }
}
