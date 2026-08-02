import { Container, Graphics, Sprite } from 'pixi.js';
import {
  createEmptyImageLayers,
  createEmptyObjectOrderLayers,
  SCENE_LAYERS,
  type SceneImage,
  type SceneMapImage,
  type SceneRecord,
} from '../../../shared/scenes';
import { SceneImageResourceCache } from './imageResourceLoader';
import { sceneObjectZIndex } from './sceneObjectOrder';

interface CanonicalImageResource {
  assetId: string | null;
  gif: ReturnType<SceneImageResourceCache['gif']>;
  texture: ReturnType<SceneImageResourceCache['texture']>;
  url: string | null;
}

interface ImageLayerContainers {
  gm: Container;
  map: Container;
  token: Container;
}

export function drawImagePlaceholder(
  graphic: Graphics,
  placement: SceneMapImage,
  centered: boolean,
  color: number,
): void {
  const left = centered ? -placement.width / 2 : 0;
  const top = centered ? -placement.height / 2 : 0;
  graphic
    .clear()
    .rect(left, top, placement.width, placement.height)
    .fill({ color: 0x24242a, alpha: 0.92 })
    .stroke({ color, width: 1 })
    .moveTo(left, top)
    .lineTo(left + placement.width, top + placement.height)
    .moveTo(left + placement.width, top)
    .lineTo(left, top + placement.height)
    .stroke({ color, width: 1 });
  graphic.position.set(placement.x, placement.y);
  graphic.angle = placement.rotation;
}

/** Reconciles placed-image sprites and placeholders against scene state. */
export class AdditionalImageRenderer {
  private destroyed = false;
  private imageUrls: Record<string, string> = {};
  private readonly placeholders = new Map<string, Graphics>();
  private scene: SceneRecord | null = null;
  private readonly spriteKinds = new Map<string, 'gif' | 'texture'>();
  private readonly sprites = new Map<string, Sprite>();
  private wantedAssetIds = new Set<string>();

  constructor(
    readonly resources: SceneImageResourceCache,
    private readonly placeholderColor: () => number,
    private readonly onResourcesChanged: () => void,
    private readonly onCanonicalKindChanged: (assetId: string) => void,
  ) {}

  sprite(id: string): Sprite | undefined {
    return this.sprites.get(id);
  }

  setSceneState(
    scene: SceneRecord | null,
    imageUrls: Record<string, string>,
  ): void {
    this.scene = scene;
    this.imageUrls = imageUrls;
    this.wantedAssetIds = new Set(
      Object.values(scene?.images ?? createEmptyImageLayers())
        .flat()
        .map((image) => image.assetId),
    );
    if (scene?.mapImage) {
      this.wantedAssetIds.add(scene.mapImage.assetId);
    }
  }

  render(
    scene: SceneRecord | null,
    imageUrls: Record<string, string>,
    containers: ImageLayerContainers,
    canonical: CanonicalImageResource,
  ): void {
    this.setSceneState(scene, imageUrls);
    const layers = scene?.images ?? createEmptyImageLayers();
    const objectOrder = scene?.objectOrder ?? createEmptyObjectOrderLayers();
    const wanted = new Set<string>();
    for (const layer of SCENE_LAYERS) {
      const container = containers[layer];
      for (
        let imageIndex = 0;
        imageIndex < layers[layer].length;
        imageIndex += 1
      ) {
        const image = layers[layer][imageIndex];
        wanted.add(image.id);
        const url = imageUrls[image.assetId];
        const sharesCanonicalResource = canonical.assetId === image.assetId;
        const texture =
          this.resources.texture(image.assetId) ??
          (sharesCanonicalResource ? canonical.texture : null);
        const gif =
          this.resources.gif(image.assetId) ??
          (sharesCanonicalResource ? canonical.gif : null);
        const gifSpriteClass = this.resources.spriteClass;
        const resourceReady = Boolean(texture || (gif && gifSpriteClass));
        const nextKind = gif ? 'gif' : 'texture';
        let sprite = this.sprites.get(image.id);
        if (resourceReady) {
          if (sprite && this.spriteKinds.get(image.id) !== nextKind) {
            sprite.parent?.removeChild(sprite);
            sprite.destroy();
            this.sprites.delete(image.id);
            this.spriteKinds.delete(image.id);
            sprite = undefined;
          }
          if (!sprite) {
            sprite =
              gif && gifSpriteClass
                ? new gifSpriteClass(gif)
                : new Sprite();
            sprite.anchor.set(0.5);
            this.sprites.set(image.id, sprite);
            this.spriteKinds.set(image.id, nextKind);
            container.addChild(sprite);
          } else if (sprite.parent !== container) {
            sprite.parent?.removeChild(sprite);
            container.addChild(sprite);
          }
          sprite.zIndex = sceneObjectZIndex(
            objectOrder,
            layer,
            image.id,
            imageIndex,
          );
          sprite.width = image.width;
          sprite.height = image.height;
          sprite.position.set(image.x, image.y);
          sprite.angle = image.rotation;
          if (texture) {
            sprite.texture = texture;
          }
          this.removePlaceholder(image.id);
        } else {
          if (sprite) {
            sprite.parent?.removeChild(sprite);
            sprite.destroy();
            this.sprites.delete(image.id);
            this.spriteKinds.delete(image.id);
          }
          let placeholder = this.placeholders.get(image.id);
          if (!placeholder) {
            placeholder = new Graphics();
            this.placeholders.set(image.id, placeholder);
            container.addChild(placeholder);
          } else if (placeholder.parent !== container) {
            placeholder.parent?.removeChild(placeholder);
            container.addChild(placeholder);
          }
          placeholder.zIndex = sceneObjectZIndex(
            objectOrder,
            layer,
            image.id,
            imageIndex,
          );
          drawImagePlaceholder(
            placeholder,
            image,
            true,
            this.placeholderColor(),
          );
        }
        if (
          url &&
          !this.resources.matchesOrLoads(image.assetId, url) &&
          !(
            scene?.mapImage?.assetId === image.assetId &&
            canonical.assetId === image.assetId &&
            canonical.url === url
          )
        ) {
          void this.loadAsset(image.assetId, url);
        }
      }
    }
    for (const [id, sprite] of this.sprites) {
      if (!wanted.has(id)) {
        sprite.parent?.removeChild(sprite);
        sprite.destroy();
        this.sprites.delete(id);
        this.spriteKinds.delete(id);
      }
    }
    for (const id of this.placeholders.keys()) {
      if (!wanted.has(id)) {
        this.removePlaceholder(id);
      }
    }
    this.resources.releaseExcept(this.wantedAssetIds);
    containers.map.sortChildren();
    containers.token.sortChildren();
    containers.gm.sortChildren();
  }

  destroy(): void {
    this.destroyed = true;
    for (const sprite of this.sprites.values()) {
      sprite.parent?.removeChild(sprite);
      sprite.destroy();
    }
    this.sprites.clear();
    this.spriteKinds.clear();
    for (const placeholder of this.placeholders.values()) {
      placeholder.parent?.removeChild(placeholder);
      placeholder.destroy();
    }
    this.placeholders.clear();
    this.resources.destroy();
  }

  async loadAsset(assetId: string, url: string): Promise<void> {
    await this.resources.load(
      assetId,
      url,
      () =>
        !this.destroyed &&
        this.wantedAssetIds.has(assetId) &&
        this.imageUrls[assetId] === url,
      (gifKindChanged) => {
        if (gifKindChanged) {
          this.replaceAssetSprites(assetId);
          if (this.scene?.mapImage?.assetId === assetId) {
            this.onCanonicalKindChanged(assetId);
          }
        }
        this.onResourcesChanged();
      },
    );
  }

  private removePlaceholder(id: string): void {
    const placeholder = this.placeholders.get(id);
    if (!placeholder) {
      return;
    }
    placeholder.parent?.removeChild(placeholder);
    placeholder.destroy();
    this.placeholders.delete(id);
  }

  private replaceAssetSprites(assetId: string): void {
    for (const layer of Object.values(
      this.scene?.images ?? createEmptyImageLayers(),
    ) as SceneImage[][]) {
      for (const image of layer) {
        if (image.assetId !== assetId) {
          continue;
        }
        const sprite = this.sprites.get(image.id);
        sprite?.parent?.removeChild(sprite);
        sprite?.destroy();
        this.sprites.delete(image.id);
        this.spriteKinds.delete(image.id);
      }
    }
  }
}
