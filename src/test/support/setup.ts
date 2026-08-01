import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { installBlackBoxStub } from './blackBox';

if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    disconnect() {}
    observe() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom does not decode images; the map texture load resolves instead of hanging.
if (!HTMLImageElement.prototype.decode) {
  HTMLImageElement.prototype.decode = () => Promise.resolve();
}

// The Pixi test adapter does not consume a drawing context. Returning null is
// the platform-defined fallback and avoids jsdom reporting a not-implemented
// error for every SceneRenderer mount. Tests that exercise canvas drawing spy
// on this method with their own context.
HTMLCanvasElement.prototype.getContext = (() => null) as never;

// Electron guarantees the preload bridge exists before the renderer runs. jsdom
// has no preload, so it is stubbed here to keep that guarantee true in tests.
beforeEach(() => {
  installBlackBoxStub();
});

afterEach(() => {
  cleanup();
});
