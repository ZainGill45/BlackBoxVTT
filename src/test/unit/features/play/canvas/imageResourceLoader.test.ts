import type { Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import {
  SceneImageResourceCache,
  type LoadedImageResource,
} from '../../../../../features/play/canvas/imageResourceLoader';

function textureResource() {
  const destroy = vi.fn();
  return {
    destroy,
    resource: {
      gif: null,
      gifSpriteClass: null,
      texture: { destroy } as unknown as Texture,
    } satisfies LoadedImageResource,
  };
}

describe('SceneImageResourceCache', () => {
  it('commits a wanted resource and destroys the resource it replaces', async () => {
    const first = textureResource();
    const second = textureResource();
    const loader = vi
      .fn<() => Promise<LoadedImageResource>>()
      .mockResolvedValueOnce(first.resource)
      .mockResolvedValueOnce(second.resource);
    const cache = new SceneImageResourceCache(loader);
    const replaced = vi.fn();

    await cache.load('asset', 'first', () => true, replaced);
    await cache.load('asset', 'second', () => true, replaced);

    expect(cache.texture('asset')).toBe(second.resource.texture);
    expect(first.destroy).toHaveBeenCalledWith(true);
    expect(replaced).toHaveBeenCalledTimes(2);
  });

  it('discards an unwanted load and permits the same URL to retry', async () => {
    const stale = textureResource();
    const current = textureResource();
    const loader = vi
      .fn<() => Promise<LoadedImageResource>>()
      .mockResolvedValueOnce(stale.resource)
      .mockResolvedValueOnce(current.resource);
    const cache = new SceneImageResourceCache(loader);

    await cache.load('asset', 'url', () => false, vi.fn());
    expect(cache.matchesOrLoads('asset', 'url')).toBe(false);
    expect(stale.destroy).toHaveBeenCalledWith(true);

    await cache.load('asset', 'url', () => true, vi.fn());
    expect(cache.texture('asset')).toBe(current.resource.texture);
  });
});
