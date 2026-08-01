import { pan, zoomAt, type Camera, type Viewport } from './camera';
import type { TrackedTouch } from './sceneInteractionEngine';

export interface PinchFrame {
  distance: number;
  x: number;
  y: number;
}

export function pinchFrame(touches: TrackedTouch[]): PinchFrame | null {
  if (touches.length < 2) {
    return null;
  }
  const [first, second] = touches;
  return {
    distance: Math.max(
      1,
      Math.hypot(
        second.clientX - first.clientX,
        second.clientY - first.clientY,
      ),
    ),
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  };
}

export function updatePinchCamera(
  camera: Camera,
  viewport: Viewport,
  containerOrigin: { x: number; y: number },
  previous: PinchFrame,
  next: PinchFrame,
): Camera {
  const panned = pan(camera, next.x - previous.x, next.y - previous.y);
  return zoomAt(
    panned,
    viewport,
    {
      x: next.x - containerOrigin.x,
      y: next.y - containerOrigin.y,
    },
    next.distance / Math.max(1, previous.distance),
  );
}

export function canBeginPendingPing(input: {
  editable: boolean;
  hasEditableDrawing: boolean;
  hasHandle: boolean;
  hasPingHandler: boolean;
  overPlacedImage: boolean;
  pingEnabled: boolean;
  pointInsideScene: boolean;
}): boolean {
  return (
    input.pingEnabled &&
    input.hasPingHandler &&
    input.pointInsideScene &&
    !input.overPlacedImage &&
    !(input.editable && (input.hasHandle || input.hasEditableDrawing))
  );
}

export function canSendPing(
  lastSentAt: number | null,
  now: number,
  cooldown: number,
): boolean {
  return lastSentAt === null || now - lastSentAt >= cooldown;
}
