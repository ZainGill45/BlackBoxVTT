import { Graphics } from 'pixi.js';
import { sceneToScreen, type Camera, type Viewport } from './camera';
import { selectionFrame, type EditTarget } from './sceneSelection';

const HANDLE_SIZE = 10;
const HANDLE_HIT_SIZE = 24;
const ROTATION_HANDLE_RADIUS = 5;
const ROTATION_HANDLE_OFFSET = 44;

type ReadColor = (name: string, fallback: string) => number;

export function rotationHandle(points: Array<{ x: number; y: number }>) {
  const top = {
    x: (points[0].x + points[1].x) / 2,
    y: (points[0].y + points[1].y) / 2,
  };
  const center = {
    x: (points[0].x + points[2].x) / 2,
    y: (points[0].y + points[2].y) / 2,
  };
  const dx = top.x - center.x;
  const dy = top.y - center.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  return {
    top,
    handle: {
      x: top.x + (dx / length) * ROTATION_HANDLE_OFFSET,
      y: top.y + (dy / length) * ROTATION_HANDLE_OFFSET,
    },
  };
}

export function selectionScreenCorners(input: {
  camera: Camera;
  groupRotation: number;
  targets: EditTarget[];
  viewport: Viewport;
}): Array<{ x: number; y: number }> {
  const frame = selectionFrame(input.targets, input.groupRotation);
  return (frame?.corners ?? []).map((point) =>
    sceneToScreen(input.camera, input.viewport, point),
  );
}

export class SceneSelectionOverlay {
  readonly marquee = new Graphics();
  readonly selection = new Graphics();

  constructor(private readonly readColor: ReadColor) {}

  clearMarquee(): void {
    this.marquee.clear();
  }

  drawMarquee(
    start: { x: number; y: number },
    end: { x: number; y: number },
  ): void {
    const color = this.readColor('--color-focus', '#eeeeee');
    this.marquee
      .clear()
      .rect(
        Math.min(start.x, end.x),
        Math.min(start.y, end.y),
        Math.abs(end.x - start.x),
        Math.abs(end.y - start.y),
      )
      .fill({ alpha: 0.12, color })
      .stroke({ color, width: 1 });
  }

  draw(input: {
    camera: Camera;
    editable: boolean;
    groupRotation: number;
    targets: EditTarget[];
    viewport: Viewport;
  }): void {
    this.selection.clear();
    if (!input.editable || input.targets.length === 0) {
      return;
    }
    const points = selectionScreenCorners(input);
    if (points.length !== 4) {
      return;
    }
    const focus = this.readColor('--color-focus', '#eeeeee');
    const surface = this.readColor('--color-surface-raised', '#1d1d1d');
    this.selection.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      this.selection.lineTo(points[index].x, points[index].y);
    }
    this.selection.lineTo(points[0].x, points[0].y);
    this.selection.stroke({ color: focus, width: 2 });
    for (const point of points) {
      this.selection
        .rect(
          point.x - HANDLE_SIZE / 2,
          point.y - HANDLE_SIZE / 2,
          HANDLE_SIZE,
          HANDLE_SIZE,
        )
        .fill({ color: surface })
        .stroke({ color: focus, width: 2 });
    }
    const rotate = rotationHandle(points);
    this.selection.moveTo(rotate.top.x, rotate.top.y);
    this.selection.lineTo(rotate.handle.x, rotate.handle.y);
    this.selection
      .stroke({ color: focus, width: 2 })
      .circle(
        rotate.handle.x,
        rotate.handle.y,
        ROTATION_HANDLE_RADIUS,
      )
      .fill({ color: surface })
      .stroke({ color: focus, width: 2 });
  }

  handleAt(
    point: { x: number; y: number },
    input: {
      camera: Camera;
      groupRotation: number;
      targets: EditTarget[];
      viewport: Viewport;
    },
  ):
    | { mode: 'resize'; corner: number }
    | { mode: 'rotate' }
    | null {
    const points = selectionScreenCorners(input);
    if (points.length !== 4) {
      return null;
    }
    const threshold = HANDLE_HIT_SIZE / 2;
    for (let index = 0; index < points.length; index += 1) {
      if (
        Math.hypot(point.x - points[index].x, point.y - points[index].y) <=
        threshold
      ) {
        return { mode: 'resize', corner: index };
      }
    }
    const rotate = rotationHandle(points).handle;
    return Math.hypot(point.x - rotate.x, point.y - rotate.y) <= threshold
      ? { mode: 'rotate' }
      : null;
  }

  resizeCursor(
    corner: number,
    targets: EditTarget[],
    groupRotation: number,
  ): 'nesw-resize' | 'nwse-resize' {
    const angle = selectionFrame(targets, groupRotation)?.angle ?? 0;
    const diagonal =
      ((angle + (corner % 2 === 0 ? 45 : 135)) % 180 + 180) % 180;
    return diagonal < 90 ? 'nwse-resize' : 'nesw-resize';
  }
}
