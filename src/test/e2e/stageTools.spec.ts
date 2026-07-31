import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { AppFixture } from './support/app';
import type { LaunchedApp } from './support/app';
import { createAndOpenCampaign, openTab } from './support/flows';
import { pixelDifferenceRatio } from './support/png';
import {
  closeSceneSettings,
  createSceneWithMap,
  dragOnStage,
  hoverStage,
  mapFixtureCentre,
  measurementLabels,
  readScene,
  stage,
} from './support/stage';

/**
 * Camera control and the drawing tools, against a real renderer.
 *
 * `camera.test.ts` and `grid.test.ts` prove the maths in isolation and the
 * SceneRenderer tests prove the bookkeeping against a stub. What none of them
 * can show is that turning the wheel or dragging a brush changes the picture.
 */

const CAMPAIGN = 'Emberfall';
const VISIBLE_CHANGE = 0.002;
/**
 * Strokes and rulers are a few pixels wide, so they move far less of the frame
 * than a placed image does. Measured compositor noise between identical frames
 * sits at or below 0.0001, so this still fails closed on "nothing was drawn".
 */
const THIN_LINE_CHANGE = 0.0005;

test.describe('stage camera and tools', () => {
  const apps = new AppFixture();
  let gm: LaunchedApp;
  let canvas: Locator;
  let centre: { x: number; y: number };
  let settled: Buffer;

  test.beforeEach(async () => {
    gm = await apps.launch();
    await createAndOpenCampaign(gm.window, CAMPAIGN);
    await createSceneWithMapFixture();
    canvas = stage(gm.window);
    await gm.window.waitForTimeout(800);
    centre = await mapFixtureCentre(gm.window);
    settled = await canvas.screenshot();
  });

  test.afterEach(() => apps.disposeAll());

  /** Imports the fixture and builds a scene that uses it as the map. */
  async function createSceneWithMapFixture() {
    const { importFixture } = await import('./support/stage');
    await importFixture(gm.app, gm.window);
    await createSceneWithMap(gm.window, CAMPAIGN);
  }

  test('zooms the view from the wheel', async () => {
    await hoverStage(gm.window, centre);

    await gm.window.mouse.wheel(0, -600);

    await expect
      .poll(async () => pixelDifferenceRatio(settled, await canvas.screenshot()), {
        message: 'the wheel did not zoom the camera',
      })
      .toBeGreaterThan(VISIBLE_CHANGE);
  });

  test('pans the view while the middle button is held', async () => {
    await dragOnStage(
      gm.window,
      centre,
      { x: centre.x + 260, y: centre.y + 180 },
      { button: 'middle', steps: 12 },
    );

    await expect
      .poll(async () => pixelDifferenceRatio(settled, await canvas.screenshot()), {
        message: 'a middle-button drag did not pan the camera',
      })
      .toBeGreaterThan(VISIBLE_CHANGE);
  });

  test('moves the camera from the Center View action', async () => {
    await dragOnStage(
      gm.window,
      centre,
      { x: centre.x + 300, y: centre.y + 200 },
      { button: 'middle', steps: 12 },
    );
    await expect
      .poll(async () => pixelDifferenceRatio(settled, await canvas.screenshot()))
      .toBeGreaterThan(VISIBLE_CHANGE);
    const panned = await canvas.screenshot();

    await gm.window.getByRole('button', { name: 'Center View' }).click();

    // Asserts the control acts on the camera. It does not restore the opening
    // framing — centring and fit-to-scene are not the same operation.
    await expect
      .poll(async () => pixelDifferenceRatio(panned, await canvas.screenshot()), {
        message: 'Center View did not move the camera',
      })
      .toBeGreaterThan(VISIBLE_CHANGE);
  });

  test('draws the grid once the scene is given one', async () => {
    await openTab(gm.window, 'Scenes');
    await gm.window.getByRole('button', { name: 'Edit New Scene' }).click();
    const settings = gm.window.getByRole('dialog', {
      name: 'Scene settings for New Scene',
    });
    await expect(settings).toBeVisible();
    await settings.getByLabel('Grid', { exact: true }).selectOption('square');
    await closeSceneSettings(gm.window, settings);
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).grid.type)
      .toBe('square');

    // grid.test.ts computes the lines; only this proves they are stroked.
    // Grid lines are one pixel wide and drawn at low opacity, so they are
    // compared at a tighter tolerance than solid content needs.
    await expect
      .poll(
        async () => pixelDifferenceRatio(settled, await canvas.screenshot(), 2),
        { message: 'enabling the square grid drew nothing' },
      )
      .toBeGreaterThan(THIN_LINE_CHANGE);
  });

  test('commits a freeform paint stroke', async () => {
    await gm.window.getByRole('button', { name: 'Paint' }).click();

    await dragOnStage(
      gm.window,
      { x: centre.x - 50, y: centre.y - 35 },
      { x: centre.x + 50, y: centre.y + 35 },
      { steps: 20 },
    );

    await expect
      .poll(
        async () =>
          (await readScene(gm.window, CAMPAIGN)).drawings.token.length,
        { message: 'the paint gesture did not persist a token-layer drawing' },
      )
      .toBe(1);
    expect(
      (await readScene(gm.window, CAMPAIGN)).drawings.token[0].points.length,
    ).toBeGreaterThan(1);
    await expect
      .poll(async () => pixelDifferenceRatio(settled, await canvas.screenshot()), {
        message: 'the paint stroke never appeared',
      })
      .toBeGreaterThan(THIN_LINE_CHANGE);
  });

  test('shows a ruler while measuring', async () => {
    await gm.window.getByRole('button', { name: 'Measure' }).click();

    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error('The stage has no layout box.');
    }
    await gm.window.mouse.move(box.x + centre.x - 50, box.y + centre.y - 35);
    await gm.window.mouse.down();
    for (let step = 1; step <= 12; step += 1) {
      await gm.window.mouse.move(
        box.x + centre.x - 50 + (100 * step) / 12,
        box.y + centre.y - 35 + (70 * step) / 12,
      );
    }

    // Asserted mid-drag: the label is the semantic ruler output and the pixel
    // comparison proves its line and markers are also painted.
    await expect(measurementLabels(gm.window).locator('span')).toHaveCount(1);
    await expect(measurementLabels(gm.window).locator('span')).not.toHaveText(
      '0 ft',
    );
    await expect
      .poll(async () => pixelDifferenceRatio(settled, await canvas.screenshot()), {
        message: 'no ruler was drawn while measuring',
      })
      .toBeGreaterThan(THIN_LINE_CHANGE);

    await gm.window.mouse.up();
  });
});
