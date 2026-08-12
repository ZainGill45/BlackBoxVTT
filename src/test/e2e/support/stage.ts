import path from 'node:path';
import { expect } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import type { SceneRecord } from '../../../shared/scenes';
import { openTab } from './flows';
import { decodePng, pixelColorBounds, type Rgb } from './png';

/**
 * Driving the map stage the way a person does — real pointer input against a
 * real GL context.
 *
 * Everything the unit suite knows about SceneRenderer it learned from a stubbed
 * Pixi and synthetic events, so these helpers exist to reach the parts that
 * only behave under a real renderer: textures that must decode, hit tests
 * against actual geometry, and drags that have to survive pointer capture.
 */

const FIXTURE_DIRECTORY = path.resolve(__dirname, '../fixtures');
export const MAP_FIXTURE_COLORS: readonly Rgb[] = [
  { blue: 60, green: 40, red: 220 },
  { blue: 80, green: 200, red: 40 },
  { blue: 230, green: 90, red: 40 },
  { blue: 40, green: 180, red: 250 },
];

/** The Pixi canvas, which is the only canvas the play screen mounts. */
export function stage(window: Page): Locator {
  return window.locator('canvas').first();
}

/** The DOM overlay containing visible distance labels for live measurements. */
export function measurementLabels(window: Page): Locator {
  return stage(window).locator(
    'xpath=following-sibling::*[@aria-hidden="true"]',
  );
}

/** Waits until the renderer has produced at least one frame. */
export async function waitForStage(window: Page): Promise<Locator> {
  const canvas = stage(window);
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () => {
      const box = await canvas.boundingBox();
      return box ? Math.min(box.width, box.height) : 0;
    })
    .toBeGreaterThan(0);
  return canvas;
}

/**
 * Replaces the native file picker for the lifetime of the app under test.
 *
 * `dialog.showOpenDialog` opens an OS window that Playwright cannot drive, so
 * the main process is told in advance what the user "chose". Everything after
 * that — policy checks, hashing, the manifest write — runs for real.
 */
export async function stubFilePicker(
  app: ElectronApplication,
  fixtureName: string,
): Promise<void> {
  await app.evaluate(async ({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, path.join(FIXTURE_DIRECTORY, fixtureName));
}

/** Imports a fixture into campaign storage through the Storage panel. */
export async function importFixture(
  app: ElectronApplication,
  window: Page,
  fixtureName = 'map.png',
): Promise<void> {
  await stubFilePicker(app, fixtureName);
  await openTab(window, 'Storage');
  await window.getByRole('button', { name: 'Add campaign assets' }).click();
  // Storage groups render collapsed, so the row exists without being on screen.
  // Its presence is what proves the import reached the manifest.
  await expect(window.getByLabel(`Name for ${fixtureName}`)).toBeAttached();
}

/** Reveals an imported asset by searching for it, which expands its group. */
export async function revealAsset(
  window: Page,
  fixtureName: string,
): Promise<Locator> {
  await openTab(window, 'Storage');
  await window.getByPlaceholder('Search assets').fill(fixtureName);
  const row = window.getByLabel(`Name for ${fixtureName}`);
  await expect(row).toBeVisible();
  return row;
}

/**
 * Reads the persisted scene through the production preload bridge.
 *
 * Pointer tests still perform every mutation through the UI; this read-only
 * oracle makes them assert the exact saved object count and transforms as well
 * as the rendered pixels, so a selection outline cannot impersonate a copy,
 * move, delete, or undo.
 */
export async function readScene(
  page: Page,
  campaignName: string,
  sceneName = 'New Scene',
): Promise<SceneRecord> {
  return page.evaluate(
    async ({ expectedCampaign, expectedScene }) => {
      const campaigns = await window.blackBox.campaigns.list();
      if (!campaigns.ok) {
        throw new Error(`Could not list campaigns: ${campaigns.error.message}`);
      }
      const campaign = campaigns.value.find(
        ({ name }) => name === expectedCampaign,
      );
      if (!campaign) {
        throw new Error(`Campaign "${expectedCampaign}" was not found.`);
      }

      const scenes = await window.blackBox.scenes.list({
        campaignId: campaign.id,
      });
      if (!scenes.ok) {
        throw new Error(`Could not list scenes: ${scenes.error.message}`);
      }
      const scene = scenes.value.scenes.find(
        ({ name }) => name === expectedScene,
      );
      if (!scene) {
        throw new Error(`Scene "${expectedScene}" was not found.`);
      }
      return scene;
    },
    { expectedCampaign: campaignName, expectedScene: sceneName },
  );
}

/** Creates a scene and leaves its settings modal open. */
export async function createScene(window: Page): Promise<Locator> {
  await openTab(window, 'Scenes');
  await window.getByRole('button', { name: 'Add scene' }).click();
  const settings = window.getByRole('dialog', {
    name: 'Scene settings for New Scene',
  });
  await expect(settings).toBeVisible();
  return settings;
}

/** Closes the scene settings modal, which has no close button of its own. */
export async function closeSceneSettings(
  window: Page,
  settings: Locator,
): Promise<void> {
  await window.keyboard.press('Escape');
  await expect(settings).toBeHidden();
}

/** Creates a scene with no map image and puts it on the stage. */
export async function createEmptyScene(window: Page): Promise<void> {
  const settings = await createScene(window);
  await closeSceneSettings(window, settings);
  await window.getByRole('button', { name: 'View New Scene' }).click();
  await waitForStage(window);
}

/**
 * Creates a scene whose canonical map is the given fixture, then views it.
 * This is the only path that puts a decoded texture on the stage.
 */
export async function createSceneWithMap(
  window: Page,
  campaignName: string,
  fixtureName = 'map.png',
): Promise<void> {
  const settings = await createScene(window);
  await settings.getByRole('button', { name: 'Import/Replace' }).click();
  await window.getByRole('button', { name: fixtureName }).click();
  await expect
    .poll(async () => (await readScene(window, campaignName)).mapImage?.assetId)
    .toBeTruthy();
  await closeSceneSettings(window, settings);
  await window.getByRole('button', { name: 'View New Scene' }).click();
  await waitForStage(window);
}

/**
 * A scene with a map that is also big enough to place objects on.
 *
 * A first-time map sizes the scene to the image, so a scene built from the
 * 256x256 fixture is 256 scene units square — the same size as anything dropped
 * onto it. Widening the bounds afterwards is what leaves room for a token to
 * sit inside the scene, which is where it has to be for players to receive it.
 */
export async function createLargeSceneWithMap(
  window: Page,
  campaignName: string,
  fixtureName = 'map.png',
  size = 2000,
): Promise<void> {
  let settings = await createScene(window);
  await settings.getByRole('button', { name: 'Import/Replace' }).click();
  await window.getByRole('button', { name: fixtureName }).click();
  await expect
    .poll(async () => (await readScene(window, campaignName)).mapImage?.assetId)
    .not.toBeUndefined();
  await closeSceneSettings(window, settings);

  // Each blur is an optimistic, revisioned update. Reopening between them
  // guarantees the second field is submitted against the first update's new
  // revision; firing both blurs back-to-back races and intermittently leaves a
  // 256×2000 or 2000×256 scene behind a conflict dialog.
  await window.getByRole('button', { name: 'Edit New Scene' }).click();
  settings = window.getByRole('dialog', {
    name: 'Scene settings for New Scene',
  });
  await expect(settings).toBeVisible();
  const width = settings.getByLabel('Scene width', { exact: true });
  await width.fill(String(size));
  await width.blur();
  await expect
    .poll(async () => (await readScene(window, campaignName)).width)
    .toBe(size);
  await closeSceneSettings(window, settings);

  await window.getByRole('button', { name: 'Edit New Scene' }).click();
  settings = window.getByRole('dialog', {
    name: 'Scene settings for New Scene',
  });
  await expect(settings).toBeVisible();
  const height = settings.getByLabel('Scene height', { exact: true });
  await height.fill(String(size));
  await height.blur();
  await expect
    .poll(async () => (await readScene(window, campaignName)).height)
    .toBe(size);
  await closeSceneSettings(window, settings);
  await window.getByRole('button', { name: 'View New Scene' }).click();
  await waitForStage(window);
}

/** Gives the single existing scene a canonical map image. */
export async function setMapOnScene(
  window: Page,
  campaignName: string,
  fixtureName = 'map.png',
): Promise<void> {
  await openTab(window, 'Scenes');
  await window.getByRole('button', { name: 'Edit New Scene' }).click();
  const settings = window.getByRole('dialog', {
    name: 'Scene settings for New Scene',
  });
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'Import/Replace' }).click();
  await window.getByRole('button', { name: fixtureName }).click();
  await expect
    .poll(async () => (await readScene(window, campaignName)).mapImage?.assetId)
    .toBeTruthy();
  await closeSceneSettings(window, settings);
}

/** Drags on the stage in viewport coordinates, one step at a time. */
export async function dragOnStage(
  window: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { button?: 'left' | 'middle' | 'right'; steps?: number } = {},
): Promise<void> {
  const { button = 'left', steps = 12 } = options;
  const box = await stage(window).boundingBox();
  if (!box) {
    throw new Error('The stage has no layout box.');
  }
  await window.mouse.move(box.x + from.x, box.y + from.y);
  await window.mouse.down({ button });
  for (let step = 1; step <= steps; step += 1) {
    await window.mouse.move(
      box.x + from.x + ((to.x - from.x) * step) / steps,
      box.y + from.y + ((to.y - from.y) * step) / steps,
    );
  }
  await window.mouse.up({ button });
}

/** Moves the pointer to a stage-relative point without pressing anything. */
export async function hoverStage(
  window: Page,
  point: { x: number; y: number },
): Promise<void> {
  const box = await stage(window).boundingBox();
  if (!box) {
    throw new Error('The stage has no layout box.');
  }
  await window.mouse.move(box.x + point.x, box.y + point.y);
}

/** Creates committed text through the real inline editor. */
export async function placeTextOnStage(
  window: Page,
  point: { x: number; y: number },
  content: string,
): Promise<{ height: number; width: number }> {
  await window.getByRole('button', { name: 'Text', exact: true }).click();
  await stage(window).click({ position: point });
  const editor = window.getByLabel('New map text');
  await expect(editor).toBeVisible();
  await editor.fill(content);
  const box = await editor.boundingBox();
  if (!box) {
    throw new Error('The inline text editor has no layout box.');
  }
  await editor.press('Control+Enter');
  await expect(editor).toBeHidden();
  return { height: box.height, width: box.width };
}

/** The centre of the stage in stage-relative coordinates. */
export async function stageCentre(
  window: Page,
): Promise<{ x: number; y: number }> {
  const box = await stage(window).boundingBox();
  if (!box) {
    throw new Error('The stage has no layout box.');
  }
  return { x: box.width / 2, y: box.height / 2 };
}

/**
 * Centre of the rendered four-colour map fixture in stage-relative CSS pixels.
 *
 * The renderer intentionally preserves camera state, so the scene is not
 * guaranteed to sit at the canvas centre. Tool tests must aim at content that
 * is actually inside the scene rather than at a guessed viewport coordinate.
 */
export async function mapFixtureCentre(
  window: Page,
): Promise<{ x: number; y: number }> {
  const canvas = stage(window);
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('The stage has no layout box.');
  }
  await expect
    .poll(async () => {
      const screenshot = await canvas.screenshot();
      const image = decodePng(screenshot);
      const bounds = pixelColorBounds(
        screenshot,
        MAP_FIXTURE_COLORS,
        40,
      );
      return bounds ? bounds.width * (box.width / image.width) : 0;
    }, {
      message: 'the full-size rendered map fixture never appeared',
    })
    .toBeGreaterThan(90);
  const screenshot = await canvas.screenshot();
  const image = decodePng(screenshot);
  const bounds = pixelColorBounds(
    screenshot,
    MAP_FIXTURE_COLORS,
    40,
  );
  if (!bounds) {
    throw new Error('The rendered map fixture could not be located.');
  }
  return {
    x: (bounds.x + bounds.width / 2) * (box.width / image.width),
    y: (bounds.y + bounds.height / 2) * (box.height / image.height),
  };
}

/**
 * Places a storage image onto the stage with an HTML5 drag.
 *
 * MapStage accepts a drop carrying the asset id, so the drag has to go through
 * the DataTransfer path rather than a plain mouse move.
 */
export async function dropAssetOnStage(
  window: Page,
  fixtureName: string,
  target: { x: number; y: number },
): Promise<void> {
  await revealAsset(window, fixtureName);
  // The drag handle is the row's preview thumbnail, not the row itself.
  const source = window.getByRole('button', { name: `Preview ${fixtureName}` });
  await expect(source).toBeVisible();

  // Drive the HTML5 DataTransfer contract explicitly. Playwright's pointer
  // drag can end without a drop when the source thumbnail rerenders during the
  // gesture; dispatching one shared DataTransfer through the native drag event
  // sequence still exercises the source's dragstart and MapStage's drop path
  // without that unrelated pointer race.
  const canvas = stage(window);
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('The stage has no layout box.');
  }
  const dataTransfer = await window.evaluateHandle(() => new DataTransfer());
  const event = {
    clientX: box.x + target.x,
    clientY: box.y + target.y,
    dataTransfer,
  };
  try {
    await source.dispatchEvent('dragstart', { dataTransfer });
    await canvas.dispatchEvent('dragenter', event);
    await canvas.dispatchEvent('dragover', event);
    await canvas.dispatchEvent('drop', event);
    await source.dispatchEvent('dragend', { dataTransfer });
  } finally {
    await dataTransfer.dispose();
  }
}
