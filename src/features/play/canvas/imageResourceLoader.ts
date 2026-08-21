import { Texture } from 'pixi.js';
import type { GifSource, GifSprite } from 'pixi.js/gif';

export interface LoadedImageResource {
  gif: GifSource | null;
  gifSpriteClass: typeof GifSprite | null;
  texture: Texture | null;
}

export async function loadImageResource(
  url: string,
): Promise<LoadedImageResource> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Image request failed with ${response.status}.`);
  }
  const blob = await response.blob();
  if (blob.type === 'image/gif') {
    // Pixi exposes GIF support as an intentional package subpath; the ESLint
    // resolver does not understand package subpaths without `exports`.
    // eslint-disable-next-line import/no-unresolved
    const { GifSource, GifSprite } = await import('pixi.js/gif');
    return {
      gif: GifSource.from(await blob.arrayBuffer()),
      gifSpriteClass: GifSprite,
      texture: null,
    };
  }
  const source =
    typeof createImageBitmap === 'function'
      ? await createImageBitmap(blob)
      : await new Promise<HTMLImageElement>((resolve, reject) => {
          const objectUrl = URL.createObjectURL(blob);
          const image = new Image();
          image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
          };
          image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('The image could not decode.'));
          };
          image.src = objectUrl;
        });
  return {
    gif: null,
    gifSpriteClass: null,
    texture: Texture.from(source),
  };
}

/** Owns decoded additional-image resources and in-flight replacement state. */
export class SceneImageResourceCache {
  private destroyed = false;
  private retainUnused = false;
  private readonly gifs = new Map<string, GifSource>();
  private readonly loadTokens = new Map<string, number>();
  private readonly loadingUrls = new Map<string, string>();
  private readonly resourceUrls = new Map<string, string>();
  private readonly textures = new Map<string, Texture>();
  private spriteClassValue: typeof GifSprite | null = null;

  constructor(
    private readonly loader: typeof loadImageResource = loadImageResource,
  ) {}

  get spriteClass(): typeof GifSprite | null {
    return this.spriteClassValue;
  }

  gif(assetId: string): GifSource | null {
    return this.gifs.get(assetId) ?? null;
  }

  texture(assetId: string): Texture | null {
    return this.textures.get(assetId) ?? null;
  }

  has(assetId: string): boolean {
    return this.textures.has(assetId) || this.gifs.has(assetId);
  }

  matchesOrLoads(assetId: string, url: string): boolean {
    return (
      this.resourceUrls.get(assetId) === url ||
      this.loadingUrls.get(assetId) === url
    );
  }

  cancelLoad(assetId: string, url: string): void {
    if (this.loadingUrls.get(assetId) !== url) return;
    this.loadTokens.set(assetId, (this.loadTokens.get(assetId) ?? 0) + 1);
    this.loadingUrls.delete(assetId);
  }

  rememberSpriteClass(spriteClass: typeof GifSprite | null): void {
    if (spriteClass) {
      this.spriteClassValue = spriteClass;
    }
  }

  retainAll(): void {
    this.retainUnused = true;
  }

  adopt(
    assetId: string,
    url: string | null,
    resource: Pick<LoadedImageResource, 'gif' | 'texture'>,
  ): { gif: boolean; texture: boolean } {
    let gif = false;
    let texture = false;
    if (resource.texture && !this.textures.has(assetId)) {
      this.textures.set(assetId, resource.texture);
      texture = true;
    }
    if (resource.gif && !this.gifs.has(assetId)) {
      this.gifs.set(assetId, resource.gif);
      gif = true;
    }
    if (url && (gif || texture)) {
      this.resourceUrls.set(assetId, url);
    }
    return { gif, texture };
  }

  async load(
    assetId: string,
    url: string,
    isStillWanted: () => boolean,
    onReplaced: (gifKindChanged: boolean) => void,
  ): Promise<void> {
    const token = (this.loadTokens.get(assetId) ?? 0) + 1;
    this.loadTokens.set(assetId, token);
    this.loadingUrls.set(assetId, url);
    let resource: LoadedImageResource = {
      gif: null,
      gifSpriteClass: null,
      texture: null,
    };
    try {
      resource = await this.loader(url);
    } catch {
      // A missing or undecodable image remains a renderer placeholder.
    }
    const isCurrentLoad = this.loadTokens.get(assetId) === token;
    if (this.destroyed || !isCurrentLoad || !isStillWanted()) {
      if (isCurrentLoad) {
        this.loadingUrls.delete(assetId);
      }
      resource.texture?.destroy(true);
      resource.gif?.destroy();
      return;
    }
    this.loadingUrls.delete(assetId);
    if (resource.gifSpriteClass) {
      this.spriteClassValue = resource.gifSpriteClass;
    }
    if (!resource.texture && !resource.gif) {
      return;
    }
    const previousTexture = this.textures.get(assetId) ?? null;
    const previousGif = this.gifs.get(assetId) ?? null;
    this.textures.delete(assetId);
    this.gifs.delete(assetId);
    if (resource.texture) {
      this.textures.set(assetId, resource.texture);
    } else if (resource.gif) {
      this.gifs.set(assetId, resource.gif);
    }
    this.resourceUrls.set(assetId, url);
    onReplaced(Boolean(previousGif || resource.gif));
    if (previousTexture && previousTexture !== resource.texture) {
      previousTexture.destroy(true);
    }
    if (previousGif && previousGif !== resource.gif) {
      previousGif.destroy();
    }
  }

  releaseExcept(wantedAssetIds: Set<string>): void {
    if (this.retainUnused) return;
    for (const [assetId, texture] of this.textures) {
      if (!wantedAssetIds.has(assetId)) {
        texture.destroy(true);
        this.textures.delete(assetId);
        this.resourceUrls.delete(assetId);
      }
    }
    for (const [assetId, source] of this.gifs) {
      if (!wantedAssetIds.has(assetId)) {
        source.destroy();
        this.gifs.delete(assetId);
        this.resourceUrls.delete(assetId);
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const texture of this.textures.values()) {
      texture.destroy(true);
    }
    this.textures.clear();
    for (const source of this.gifs.values()) {
      source.destroy();
    }
    this.gifs.clear();
    this.loadTokens.clear();
    this.loadingUrls.clear();
    this.resourceUrls.clear();
  }
}
