import { describe, expect, it } from 'vitest';
import {
  canBeginPendingPing,
  canSendPing,
  pinchFrame,
  updatePinchCamera,
} from '../../../../../features/play/canvas/sceneNavigationInteraction';
import { createCamera } from '../../../../../features/play/canvas/camera';

describe('scene navigation interaction', () => {
  it('derives pinch frames and applies pan plus anchored zoom', () => {
    const previous = pinchFrame([
      { clientX: 0, clientY: 0, startX: 0, startY: 0 },
      { clientX: 100, clientY: 0, startX: 100, startY: 0 },
    ]);
    const next = pinchFrame([
      { clientX: 10, clientY: 10, startX: 0, startY: 0 },
      { clientX: 210, clientY: 10, startX: 100, startY: 0 },
    ]);
    expect(previous).not.toBeNull();
    expect(next).not.toBeNull();

    const camera = updatePinchCamera(
      createCamera(),
      { height: 600, width: 800 },
      { x: 0, y: 0 },
      previous!,
      next!,
    );
    expect(camera.zoom).toBe(2);
  });

  it('keeps ping eligibility and cooldown independent of the renderer', () => {
    const eligible = {
      editable: true,
      hasEditableDrawing: false,
      hasHandle: false,
      hasPingHandler: true,
      overPlacedImage: false,
      pingEnabled: true,
      pointInsideScene: true,
    };
    expect(canBeginPendingPing(eligible)).toBe(true);
    expect(canBeginPendingPing({ ...eligible, hasHandle: true })).toBe(false);
    expect(canSendPing(null, 100, 500)).toBe(true);
    expect(canSendPing(100, 599, 500)).toBe(false);
    expect(canSendPing(100, 600, 500)).toBe(true);
  });
});
