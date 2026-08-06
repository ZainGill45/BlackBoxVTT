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

// ProseMirror asks the browser for selection geometry after keyboard-driven
// selections. jsdom does not implement Range geometry, so return the empty
// layout box that its no-layout environment represents.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    toJSON: () => ({}),
    top: 0,
    width: 0,
    x: 0,
    y: 0,
  });
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
