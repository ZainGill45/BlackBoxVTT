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
  stageCentre,
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
/** A fitted scene's low-opacity grid changes fewer pixels than solid tool marks. */
const GRID_CHANGE = 0.0004;

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

  test('centers the presented scene when entering a campaign', async () => {
    const present = gm.window.getByRole('button', {
      name: 'Present New Scene',
    });
    await present.click();
    await expect(present).toHaveAttribute('aria-pressed', 'true');

    await gm.window.getByRole('button', { name: 'Logout' }).click();
    await gm.window.getByRole('tab', { name: 'Create Campaign' }).click();
    await gm.window.getByRole('button', { name: `Open ${CAMPAIGN}` }).click();
    await expect(
      gm.window.getByText('Viewing the scene New Scene.'),
    ).toBeVisible();
    await gm.window.waitForTimeout(800);

    centre = await mapFixtureCentre(gm.window);
    const viewportCentre = await stageCentre(gm.window);

    expect(Math.abs(centre.x - viewportCentre.x)).toBeLessThan(3);
    expect(Math.abs(centre.y - viewportCentre.y)).toBeLessThan(3);
  });

  test('draws the grid once the scene is given one', async () => {
    await openTab(gm.window, 'Scenes');
    await gm.window.getByRole('button', { name: 'Edit New Scene' }).click();
    let settings = gm.window.getByRole('dialog', {
      name: 'Scene settings for New Scene',
    });
    await expect(settings).toBeVisible();
    await settings.getByLabel('Grid', { exact: true }).selectOption('gridless');
    await closeSceneSettings(gm.window, settings);
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).grid.type)
      .toBe('gridless');
    const withoutGrid = await canvas.screenshot();

    await gm.window.getByRole('button', { name: 'Edit New Scene' }).click();
    settings = gm.window.getByRole('dialog', {
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
        async () =>
          pixelDifferenceRatio(withoutGrid, await canvas.screenshot(), 2),
        { message: 'enabling the square grid drew nothing' },
      )
      .toBeGreaterThan(GRID_CHANGE);
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

  test('renders a stable 5-unit shape while zooming', async () => {
    await gm.window.getByRole('button', { name: 'Shape', exact: true }).click();
    const rail = gm.window.getByRole('toolbar', { name: 'Shape tools' });
    await expect(rail.getByRole('button', { name: 'Sphere' }))
      .toHaveAttribute('aria-pressed', 'true');

    await dragOnStage(
      gm.window,
      centre,
      { x: centre.x + 60, y: centre.y },
      { steps: 16 },
    );

    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).shapes.token.length, {
        message: 'the shape gesture did not persist a sphere',
      })
      .toBe(1);
    const storedScene = await readScene(gm.window, CAMPAIGN);
    const sphere = storedScene.shapes.token[0];
    expect(sphere).toMatchObject({
      height: sphere.width,
      kind: 'sphere',
      style: { backgroundType: 'crosshatched' },
    });
    const radius = ((sphere.width / 2) / storedScene.pixelScale) *
      storedScene.distance;
    expect(radius % 5).toBeCloseTo(0);
    expect(
      (sphere.x - storedScene.grid.offsetX) % storedScene.grid.size,
    ).not.toBeCloseTo(0);
    await expect
      .poll(async () => pixelDifferenceRatio(settled, await canvas.screenshot()), {
        message: 'the committed sphere never appeared',
      })
      .toBeGreaterThan(THIN_LINE_CHANGE);

    await hoverStage(gm.window, centre);
    for (let index = 0; index < 8; index += 1) {
      await gm.window.mouse.wheel(0, -250);
    }
    await gm.window.waitForTimeout(100);
    const firstZoomedFrame = await canvas.screenshot();
    const secondZoomedFrame = await canvas.screenshot();
    expect(
      pixelDifferenceRatio(firstZoomedFrame, secondZoomedFrame),
      'the shape fill changed between settled frames at the same zoom',
    ).toBeLessThan(0.0002);
  });

  test('renders and persists styled multiline text with packaged fonts', async () => {
    await gm.window.getByRole('button', { name: 'Text' }).click();
    const rail = gm.window.getByRole('toolbar', { name: 'Text tools' });
    await rail.getByRole('button', { name: 'Text settings' }).click();
    const settings = gm.window.getByRole('dialog', { name: 'Text settings' });
    await expect(settings).toBeVisible();
    await settings.getByLabel('Font family').selectOption('roboto-mono');
    await settings.getByLabel('Font weight').selectOption('700');
    await settings.getByLabel('Font size').fill('48');
    await settings.getByLabel('Font size').press('Enter');
    await settings.getByLabel('Primary color', { exact: true }).fill('#e02b2b');
    await settings.getByLabel('Primary color', { exact: true }).press('Enter');
    await settings.getByLabel('Stroke width').fill('4');
    await settings.getByLabel('Stroke width').press('Enter');
    await gm.window.keyboard.press('Escape');
    await expect(settings).toBeHidden();

    await canvas.click({ position: centre });
    const editor = gm.window.getByLabel('New map text');
    await expect(editor).toBeVisible();
    await editor.fill('Iron Keep\n門楼 Привет');
    await expect
      .poll(async () => pixelDifferenceRatio(settled, await canvas.screenshot()), {
        message: 'the local Pixi text preview never appeared while editing',
      })
      .toBeGreaterThan(THIN_LINE_CHANGE);
    await editor.press('Control+Enter');
    await expect(editor).toBeHidden();
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).texts.token.length)
      .toBe(1);
    expect((await readScene(gm.window, CAMPAIGN)).texts.token[0]).toMatchObject({
      content: 'Iron Keep\n門楼 Привет',
      style: {
        fontFamily: 'roboto-mono',
        fontSize: 48,
        fontWeight: 700,
        primaryColor: '#e02b2b',
        strokeWidth: 4,
      },
    });
    await expect
      .poll(async () => pixelDifferenceRatio(settled, await canvas.screenshot()), {
        message: 'committed text never appeared on the WebGL stage',
      })
      .toBeGreaterThan(THIN_LINE_CHANGE);

    const fontsReady = await gm.window.evaluate(() =>
      [
        ['Inter Variable', 700],
        ['Lora Variable', 700],
        ['Roboto Mono Variable', 700],
        ['Cinzel Variable', 700],
        ['Noto Sans Variable', 400],
        ['Noto Sans SC Variable', 400],
        ['Unifont', 400],
      ].every(([family, weight]) =>
        document.fonts.check(`${weight} 16px "${family}"`),
      ),
    );
    expect(fontsReady, 'a packaged scene-text font was unavailable').toBe(true);
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
