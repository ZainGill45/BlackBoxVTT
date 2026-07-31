import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { AppFixture } from './support/app';
import type { LaunchedApp } from './support/app';
import { createAndOpenCampaign, openTab } from './support/flows';
import { pixelDifferenceRatio } from './support/png';
import {
  createLargeSceneWithMap,
  dragOnStage,
  dropAssetOnStage,
  importFixture,
  mapFixtureCentre,
  readScene,
  stage,
} from './support/stage';

/**
 * Editing objects on the stage with real pointer and keyboard input.
 *
 * The unit suite drives these paths against a stubbed Pixi, so it can prove the
 * renderer updated its own bookkeeping but never that anything moved, appeared
 * or vanished on screen. Each test here compares actual frames.
 *
 * Assertions stay coarse — "this region changed by more than N" — because exact
 * pixels vary with GPU and compositor. Golden images would flake; these do not.
 */

const CAMPAIGN = 'Emberfall';
/** Comfortably above compositor noise, far below a real object appearing. */
const VISIBLE_CHANGE = 0.002;

test.describe('stage editing', () => {
  const apps = new AppFixture();
  let gm: LaunchedApp;
  let canvas: Locator;
  let centre: { x: number; y: number };
  /** The stage with a map but nothing placed on it. */
  let bare: Buffer;

  test.beforeEach(async () => {
    gm = await apps.launch();
    await createAndOpenCampaign(gm.window, CAMPAIGN);
    await importFixture(gm.app, gm.window);
    await createLargeSceneWithMap(gm.window, CAMPAIGN);
    canvas = stage(gm.window);
    // The fit-to-scene camera settles asynchronously; a baseline taken mid
    // animation makes every later comparison noisy.
    await gm.window.waitForTimeout(800);
    const mapCentre = await mapFixtureCentre(gm.window);
    // The fixture token is the same size as the canonical map. Offset it into
    // the deliberately larger scene so it is valid, visible, and not merely
    // repainting identical pixels over the map.
    centre = { x: mapCentre.x + 220, y: mapCentre.y + 160 };
    bare = await canvas.screenshot();
  });

  test.afterEach(() => apps.disposeAll());

  /** Places the fixture on the stage and returns the resulting frame. */
  async function placeToken(): Promise<Buffer> {
    await dropAssetOnStage(gm.window, 'map.png', centre);
    await expect
      .poll(
        async () =>
          (await readScene(gm.window, CAMPAIGN)).images.token.length,
        { message: 'the dropped image was not saved to the token layer' },
      )
      .toBe(1);
    await expect
      .poll(async () => pixelDifferenceRatio(bare, await canvas.screenshot()))
      .toBeGreaterThan(VISIBLE_CHANGE);
    return canvas.screenshot();
  }

  /** Drags the placed token, which also leaves it selected. */
  async function dragToken(window: Page): Promise<void> {
    await dragOnStage(
      window,
      centre,
      { x: centre.x + 250, y: centre.y + 150 },
      { steps: 15 },
    );
  }

  test('places a dropped image on the stage', async () => {
    const placed = await placeToken();

    expect(pixelDifferenceRatio(bare, placed)).toBeGreaterThan(VISIBLE_CHANGE);
    expect((await readScene(gm.window, CAMPAIGN)).images.token).toHaveLength(1);
  });

  test('moves the image when it is dragged', async () => {
    const placed = await placeToken();
    const beforeTransform = (
      await readScene(gm.window, CAMPAIGN)
    ).images.token[0];

    await dragToken(gm.window);

    await expect
      .poll(async () => pixelDifferenceRatio(placed, await canvas.screenshot()), {
        message: 'dragging the image did not move it',
      })
      .toBeGreaterThan(VISIBLE_CHANGE);
    await expect
      .poll(async () => {
        const moved = (await readScene(gm.window, CAMPAIGN)).images.token[0];
        return Math.hypot(
          moved.x - beforeTransform.x,
          moved.y - beforeTransform.y,
        );
      }, {
        message: 'the drag changed pixels but not the saved token transform',
      })
      .toBeGreaterThan(1);
  });

  test('keeps a placed image on the scene across a reopen', async () => {
    await placeToken();
    await dragToken(gm.window);
    await gm.window.waitForTimeout(1200);

    await gm.window.getByRole('button', { name: 'Logout' }).click();
    await gm.window.getByRole('tab', { name: 'Create Campaign' }).click();
    await gm.window.getByRole('button', { name: `Open ${CAMPAIGN}` }).click();
    await expect(gm.window.getByRole('tab', { name: 'Chat' })).toBeVisible();
    await openTab(gm.window, 'Scenes');
    await gm.window.getByRole('button', { name: 'View New Scene' }).click();
    await gm.window.waitForTimeout(1500);

    expect((await readScene(gm.window, CAMPAIGN)).images.token).toHaveLength(1);
    // Compared against the same scene before anything was placed on it. The
    // camera refits on reopen, so this asserts the image survived rather than
    // that it landed on identical pixels.
    expect(
      pixelDifferenceRatio(bare, await stage(gm.window).screenshot()),
      'the placed image did not survive reopening the campaign',
    ).toBeGreaterThan(VISIBLE_CHANGE);
  });

  test('duplicates the selection with Ctrl+D', async () => {
    await placeToken();
    await dragToken(gm.window);
    await gm.window.waitForTimeout(800);
    const single = await canvas.screenshot();

    await gm.window.keyboard.press('Control+d');

    await expect
      .poll(
        async () =>
          (await readScene(gm.window, CAMPAIGN)).images.token.length,
        { message: 'Ctrl+D did not persist a second token' },
      )
      .toBe(2);
    await expect
      .poll(async () => pixelDifferenceRatio(single, await canvas.screenshot()), {
        message: 'the duplicate never appeared',
      })
      .toBeGreaterThan(VISIBLE_CHANGE);
  });

  test('deletes the selection with the Delete key', async () => {
    await placeToken();
    await dragToken(gm.window);
    await gm.window.waitForTimeout(800);
    const present = await canvas.screenshot();

    await gm.window.keyboard.press('Delete');

    await expect
      .poll(
        async () =>
          (await readScene(gm.window, CAMPAIGN)).images.token.length,
        { message: 'Delete changed the frame but left the token persisted' },
      )
      .toBe(0);
    await expect
      .poll(async () => pixelDifferenceRatio(present, await canvas.screenshot()), {
        message: 'the image was still drawn after Delete',
      })
      .toBeGreaterThan(VISIBLE_CHANGE);
  });

  test('restores a deleted image with Ctrl+Z', async () => {
    await placeToken();
    await dragToken(gm.window);
    await gm.window.waitForTimeout(800);
    const beforeDelete = (
      await readScene(gm.window, CAMPAIGN)
    ).images.token[0];
    const present = await canvas.screenshot();
    await gm.window.keyboard.press('Delete');
    await expect
      .poll(
        async () =>
          (await readScene(gm.window, CAMPAIGN)).images.token.length,
      )
      .toBe(0);

    await gm.window.keyboard.press('Control+z');

    await expect
      .poll(
        async () =>
          (await readScene(gm.window, CAMPAIGN)).images.token.length,
        { message: 'undo did not restore the token in persisted scene state' },
      )
      .toBe(1);
    expect(
      (await readScene(gm.window, CAMPAIGN)).images.token[0],
    ).toMatchObject({
      height: beforeDelete.height,
      rotation: beforeDelete.rotation,
      width: beforeDelete.width,
      x: beforeDelete.x,
      y: beforeDelete.y,
    });
    // Undo puts the scene back the way it looked before the delete.
    await expect
      .poll(async () => pixelDifferenceRatio(present, await canvas.screenshot()), {
        message: 'undo did not restore the deleted image',
      })
      .toBeLessThan(VISIBLE_CHANGE);
  });

  test('copies and pastes an image with Ctrl+C and Ctrl+V', async () => {
    await placeToken();
    await dragToken(gm.window);
    await gm.window.waitForTimeout(800);
    const single = await canvas.screenshot();

    await gm.window.keyboard.press('Control+c');
    await gm.window.keyboard.press('Control+v');

    await expect
      .poll(
        async () =>
          (await readScene(gm.window, CAMPAIGN)).images.token.length,
        { message: 'paste did not persist a second token' },
      )
      .toBe(2);
    await expect
      .poll(async () => pixelDifferenceRatio(single, await canvas.screenshot()), {
        message: 'the pasted copy never appeared',
      })
      .toBeGreaterThan(VISIBLE_CHANGE);
  });

  test('nudges the selection with the arrow keys', async () => {
    await placeToken();
    await dragToken(gm.window);
    await gm.window.waitForTimeout(800);
    const beforeTransform = (
      await readScene(gm.window, CAMPAIGN)
    ).images.token[0];
    const before = await canvas.screenshot();

    for (let press = 0; press < 8; press += 1) {
      await gm.window.keyboard.press('ArrowRight');
    }
    await gm.window.keyboard.up('ArrowRight');

    await expect
      .poll(
        async () =>
          (await readScene(gm.window, CAMPAIGN)).images.token[0].x,
        { message: 'arrow keys did not update the saved x coordinate' },
      )
      .toBeGreaterThan(beforeTransform.x);
    await expect
      .poll(async () => pixelDifferenceRatio(before, await canvas.screenshot()), {
        message: 'arrow keys did not move the selection',
      })
      .toBeGreaterThan(VISIBLE_CHANGE);
  });
});
