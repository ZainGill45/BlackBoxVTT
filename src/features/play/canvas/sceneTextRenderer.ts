import { Container, Text, type TextStyleOptions } from 'pixi.js';
import {
  createEmptyObjectOrderLayers,
  type SceneObjectOrderLayers,
  type SceneText,
  type SceneTextFamily,
  type SceneTextLayers,
} from '../../../shared/scenes';
import {
  SCENE_LAYERS,
  SCENE_TEXT_TEXTURE_RESOLUTION,
} from '../../../shared/scenes';

import { OBJECT_PREVIEW_Z_INDEX, sceneObjectZIndex } from './sceneObjectOrder';

const TEXT_PREVIEW_Z_INDEX = OBJECT_PREVIEW_Z_INDEX + 1_000_000;
const DEFAULT_FONT_SAMPLE = 'BlackBox VTT';
const SCENE_TEXT_FONT_LICENSE_URL = new URL(
  '../../../assets/fonts/OFL-1.1.txt',
  import.meta.url,
).href;

export const SCENE_TEXT_FONT_NAMES: Record<SceneTextFamily, string> = {
  cinzel: 'Cinzel Variable',
  inter: 'Inter Variable',
  lora: 'Lora Variable',
  'roboto-mono': 'Roboto Mono Variable',
};

export const SCENE_TEXT_FALLBACK_FONT_NAMES = [
  'Noto Sans Variable',
  'Noto Sans SC Variable',
  'Unifont',
] as const;

const SCENE_TEXT_FONT_STACKS = new Map<SceneTextFamily, string[]>();
const SCENE_TEXT_FONT_LOADS = new WeakMap<
  FontFaceSet,
  { base: Promise<void>; contents: Map<string, Promise<void>> }
>();

export function sceneTextFontStack(fontFamily: SceneTextFamily): string[] {
  let stack = SCENE_TEXT_FONT_STACKS.get(fontFamily);
  if (!stack) {
    stack = [SCENE_TEXT_FONT_NAMES[fontFamily], ...SCENE_TEXT_FALLBACK_FONT_NAMES];
    SCENE_TEXT_FONT_STACKS.set(fontFamily, stack);
  }
  return stack;
}

export function ensureSceneTextFontsLoaded(
  content = DEFAULT_FONT_SAMPLE,
): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) {
    return Promise.resolve();
  }
  if (!document.head.querySelector('link[data-scene-text-font-license]')) {
    const license = document.createElement('link');
    license.dataset.sceneTextFontLicense = '';
    license.href = SCENE_TEXT_FONT_LICENSE_URL;
    license.rel = 'license';
    document.head.appendChild(license);
  }
  const fontSet = document.fonts;
  let loads = SCENE_TEXT_FONT_LOADS.get(fontSet);
  if (!loads) {
    loads = {
      base: Promise.all([
        ...Object.values(SCENE_TEXT_FONT_NAMES).flatMap((family) =>
          [400, 500, 600, 700].map((weight) =>
            fontSet.load(`${weight} 16px "${family}"`, DEFAULT_FONT_SAMPLE),
          ),
        ),
        ...SCENE_TEXT_FALLBACK_FONT_NAMES.map((family) =>
          fontSet.load(`400 16px "${family}"`, DEFAULT_FONT_SAMPLE),
        ),
      ]).then(() => undefined),
      contents: new Map(),
    };
    SCENE_TEXT_FONT_LOADS.set(fontSet, loads);
  }
  if (content === DEFAULT_FONT_SAMPLE) {
    return loads.base;
  }
  let contentLoad = loads.contents.get(content);
  if (!contentLoad) {
    if (loads.contents.size >= 64) {
      const oldest = loads.contents.keys().next().value;
      if (oldest) {
        loads.contents.delete(oldest);
      }
    }
    contentLoad = Promise.all([
      ...Object.values(SCENE_TEXT_FONT_NAMES).flatMap((family) =>
        [400, 500, 600, 700].map((weight) =>
          fontSet.load(`${weight} 16px "${family}"`, content),
        ),
      ),
      ...SCENE_TEXT_FALLBACK_FONT_NAMES.map((family) =>
        fontSet.load(`400 16px "${family}"`, content),
      ),
    ]).then(() => undefined);
    loads.contents.set(content, contentLoad);
  }
  return Promise.all([loads.base, contentLoad]).then(() => undefined);
}

export interface SceneTextLocalBounds {
  height: number;
  width: number;
}

interface TextLayerContainers {
  gm: Container;
  map: Container;
  token: Container;
}

function styleOf(text: SceneText): TextStyleOptions {
  return {
    fill: text.style.primaryColor,
    fontFamily: sceneTextFontStack(text.style.fontFamily),
    fontSize: text.style.fontSize,
    fontWeight: String(
      text.style.fontWeight,
    ) as TextStyleOptions['fontWeight'],
    padding: text.style.strokeWidth + 2,
    stroke:
      text.style.strokeWidth > 0
        ? {
            color: text.style.strokeColor,
            width: text.style.strokeWidth,
          }
        : undefined,
    whiteSpace: 'pre' as const,
    wordWrap: false,
  };
}

/** Reconciles persistent scene text with measured Pixi text instances. */
export class SceneTextRenderer {
  private readonly boundsById = new Map<string, SceneTextLocalBounds>();
  private readonly instances = new Map<string, Text>();
  private readonly renderKeys = new Map<string, string>();
  private hiddenTextId: string | null = null;
  private previewInstance: Text | null = null;
  private previewRenderKey: string | null = null;

  bounds(id: string): SceneTextLocalBounds | null {
    return this.boundsById.get(id) ?? null;
  }

  clear(): void {
    this.clearPreview();
    for (const [id, instance] of this.instances) {
      instance.parent?.removeChild(instance);
      instance.destroy();
      this.instances.delete(id);
    }
    this.boundsById.clear();
    this.renderKeys.clear();
  }

  clearPreview(): void {
    this.hiddenTextId = null;
    for (const instance of this.instances.values()) {
      instance.visible = true;
    }
    this.previewInstance?.parent?.removeChild(this.previewInstance);
    this.previewInstance?.destroy();
    this.previewInstance = null;
    this.previewRenderKey = null;
  }

  /**
   * Draws a local-only editor preview through Pixi so its glyph metrics and
   * stroke rasterization are identical to committed scene text.
   */
  renderPreview(
    preview: {
      hiddenTextId: string | null;
      layer: keyof SceneTextLayers;
      text: SceneText | null;
    },
    containers: TextLayerContainers,
  ): SceneTextLocalBounds | null {
    this.hiddenTextId = preview.hiddenTextId;
    for (const [id, instance] of this.instances) {
      instance.visible = id !== this.hiddenTextId;
    }
    if (!preview.text) {
      this.previewInstance?.parent?.removeChild(this.previewInstance);
      this.previewInstance?.destroy();
      this.previewInstance = null;
      this.previewRenderKey = null;
      return null;
    }
    const container = containers[preview.layer];
    const instance =
      this.previewInstance ??
      new Text({ anchor: 0.5, resolution: SCENE_TEXT_TEXTURE_RESOLUTION });
    this.previewInstance = instance;
    if (instance.parent !== container) {
      instance.parent?.removeChild(instance);
      container.addChild(instance);
    }
    const key = renderKey(preview.text);
    const bounds = updateInstance(
      instance,
      preview.text,
      key !== this.previewRenderKey,
    );
    this.previewRenderKey = key;
    instance.zIndex = TEXT_PREVIEW_Z_INDEX;
    container.sortChildren();
    return bounds;
  }

  render(
    layers: SceneTextLayers | null,
    containers: TextLayerContainers,
    objectOrder: SceneObjectOrderLayers = createEmptyObjectOrderLayers(),
  ): void {
    if (!layers) {
      this.clear();
      return;
    }
    const wanted = new Set<string>();
    for (const layer of SCENE_LAYERS) {
      const container = containers[layer];
      for (let index = 0; index < layers[layer].length; index += 1) {
        const text = layers[layer][index];
        wanted.add(text.id);
        let instance = this.instances.get(text.id);
        if (!instance) {
          instance = new Text({
            anchor: 0.5,
            resolution: SCENE_TEXT_TEXTURE_RESOLUTION,
          });
          this.instances.set(text.id, instance);
          container.addChild(instance);
        } else if (instance.parent !== container) {
          instance.parent?.removeChild(instance);
          container.addChild(instance);
        }
        const key = renderKey(text);
        this.boundsById.set(
          text.id,
          updateInstance(instance, text, key !== this.renderKeys.get(text.id)),
        );
        this.renderKeys.set(text.id, key);
        instance.visible = text.id !== this.hiddenTextId;
        instance.zIndex = sceneObjectZIndex(
          objectOrder,
          layer,
          text.id,
          index,
        );
      }
    }
    for (const [id, instance] of this.instances) {
      if (!wanted.has(id)) {
        instance.parent?.removeChild(instance);
        instance.destroy();
        this.instances.delete(id);
        this.boundsById.delete(id);
        this.renderKeys.delete(id);
      }
    }
    containers.map.sortChildren();
    containers.token.sortChildren();
    containers.gm.sortChildren();
  }
}

function renderKey(text: SceneText): string {
  return JSON.stringify([text.content, text.style]);
}

function updateInstance(
  instance: Text,
  text: SceneText,
  contentOrStyleChanged: boolean,
): SceneTextLocalBounds {
  instance.scale.set(1);
  if (contentOrStyleChanged) {
    instance.text = text.content;
    instance.style = styleOf(text);
  }
  const bounds = {
    height: Math.max(1, instance.height),
    width: Math.max(1, instance.width),
  };
  instance.position.set(text.x, text.y);
  instance.scale.set(text.scaleX, text.scaleY);
  instance.angle = text.rotation;
  return bounds;
}
