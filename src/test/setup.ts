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

// Electron guarantees the preload bridge exists before the renderer runs. jsdom
// has no preload, so it is stubbed here to keep that guarantee true in tests.
beforeEach(() => {
  installBlackBoxStub();
});

afterEach(() => {
  cleanup();
});
