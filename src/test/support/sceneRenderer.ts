import { vi } from 'vitest';
import type { SceneRendererHandle } from '../../features/play/canvas/SceneRenderer';

/** Total renderer test adapter: production capabilities cannot disappear in fakes. */
export function createFakeSceneRenderer(): SceneRendererHandle {
  return {
    clientToScene: vi.fn(() => ({ x: 0, y: 0 })),
    destroy: vi.fn(),
    fitToScene: vi.fn(),
    mount: vi.fn(async () => undefined),
    resize: vi.fn(),
    selectImages: vi.fn(),
    setInteraction: vi.fn(),
    setScene: vi.fn(),
    showDrawingPreview: vi.fn(),
    showFogPreview: vi.fn(),
    showMeasurement: vi.fn(),
    showShapePreview: vi.fn(),
    showPing: vi.fn(),
    showTransformCancelled: vi.fn(),
    showTransformPreview: vi.fn(),
    showTransformStarted: vi.fn(),
  };
}
