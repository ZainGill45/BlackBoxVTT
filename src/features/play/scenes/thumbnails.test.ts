import { afterEach, describe, expect, it, vi } from 'vitest';
import { createThumbnail, fitWithin, THUMBNAIL_MAX_EDGE } from './thumbnails';

const original = globalThis.createImageBitmap;

afterEach(() => {
  globalThis.createImageBitmap = original;
  vi.restoreAllMocks();
});

describe('fitWithin', () => {
  it('scales a landscape source down by its long edge', () => {
    expect(fitWithin({ height: 3000, width: 4000 }, 512)).toEqual({
      height: 384,
      width: 512,
    });
  });

  it('scales a portrait source down by its long edge', () => {
    expect(fitWithin({ height: 4000, width: 3000 }, 512)).toEqual({
      height: 512,
      width: 384,
    });
  });

  it('never enlarges a source that already fits', () => {
    expect(fitWithin({ height: 90, width: 160 }, 512)).toEqual({
      height: 90,
      width: 160,
    });
  });

  it('keeps a sliver at least one pixel wide', () => {
    expect(fitWithin({ height: 10_000, width: 3 }, 512).width).toBe(1);
  });

  it('reports nothing for a degenerate source', () => {
    expect(fitWithin({ height: 0, width: 0 }, 512)).toEqual({
      height: 0,
      width: 0,
    });
  });
});

describe('createThumbnail', () => {
  it('gives up gracefully when the platform cannot decode', async () => {
    // jsdom has no createImageBitmap; callers fall back to the full image.
    globalThis.createImageBitmap =
      undefined as unknown as typeof createImageBitmap;

    expect(await createThumbnail(new Blob())).toBeNull();
  });

  it('gives up gracefully when the source will not decode', async () => {
    globalThis.createImageBitmap = (() =>
      Promise.reject(new Error('bad image'))) as unknown as typeof createImageBitmap;

    expect(await createThumbnail(new Blob())).toBeNull();
  });

  it('reports the source dimensions, not the thumbnail ones', async () => {
    const close = vi.fn();
    const bitmaps: Array<{ height: number; width: number }> = [];
    globalThis.createImageBitmap = ((
      _blob: Blob,
      options?: { resizeHeight?: number; resizeWidth?: number },
    ) => {
      const bitmap = {
        close,
        height: options?.resizeHeight ?? 3000,
        width: options?.resizeWidth ?? 4000,
      };
      bitmaps.push(bitmap);
      return Promise.resolve(bitmap as unknown as ImageBitmap);
    }) as unknown as typeof createImageBitmap;

    const encoded = new Blob(['thumb'], { type: 'image/webp' });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      ((callback: (blob: Blob) => void) => callback(encoded)) as never,
    );

    const result = await createThumbnail(new Blob(), THUMBNAIL_MAX_EDGE);

    expect(result).not.toBeNull();
    // Scenes are sized from these, so they must describe the map itself.
    expect(result?.sourceWidth).toBe(4000);
    expect(result?.sourceHeight).toBe(3000);
    expect(result?.blob).toBe(encoded);
    // Decoded a second time at the reduced size, off the main thread.
    expect(bitmaps[1]).toMatchObject({ height: 384, width: 512 });
  });
});
