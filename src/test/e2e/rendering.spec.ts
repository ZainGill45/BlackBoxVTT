import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { AppFixture } from './support/app';
import { createAndOpenCampaign, openTab } from './support/flows';
import { countDistinctColors, pixelDifferenceRatio } from './support/png';

/**
 * The one thing the unit suite structurally cannot check.
 *
 * `vitest.config.mts` aliases `pixi.js` to a stub because jsdom has no GPU, so
 * every SceneRenderer test exercises scene-graph bookkeeping against a fake
 * renderer and `HTMLCanvasElement.getContext` throws throughout. Nothing under
 * vitest has ever produced a pixel. These tests run the real renderer on a real
 * GL context, which is the only place a broken texture, a lost context, or a
 * silently empty stage shows up.
 */

const CAMPAIGN = 'Emberfall';

test.describe('scene rendering', () => {
  const apps = new AppFixture();
  test.afterEach(() => apps.disposeAll());

  test('mounts the scene on a real WebGL context', async () => {
    const { window } = await apps.launch();
    await createAndOpenCampaign(window, CAMPAIGN);
    await addScene(window);

    const canvas = window.locator('canvas').first();
    await expect(canvas).toBeVisible();

    const context = await canvas.evaluate((element: HTMLCanvasElement) => {
      // Pixi has already taken the context; asking again returns the same one
      // rather than allocating a second.
      const gl =
        element.getContext('webgl2') ??
        element.getContext('webgl') ??
        element.getContext('experimental-webgl');
      return {
        hasContext: gl !== null,
        height: element.height,
        width: element.width,
      };
    });

    expect(context.hasContext).toBe(true);
    expect(context.width).toBeGreaterThan(0);
    expect(context.height).toBeGreaterThan(0);
  });

  test('draws a scene rather than presenting an empty stage', async () => {
    const { window } = await apps.launch();
    await createAndOpenCampaign(window, CAMPAIGN);

    const canvas = window.locator('canvas').first();
    await expect(canvas).toBeVisible();
    await expect(
      window.getByText('No scene is being displayed.'),
    ).toBeAttached();
    const withoutScene = await canvas.screenshot();

    await addScene(window);
    await expect(
      window.getByText('Viewing the scene New Scene.'),
    ).toBeAttached();

    // Count alone is weak because the empty hatch backdrop also contains
    // several colours. Comparing the same canvas before and after creation
    // proves the scene surface itself was painted.
    await expect
      .poll(
        async () =>
          pixelDifferenceRatio(withoutScene, await canvas.screenshot()),
        {
          message: 'creating a scene did not change the rendered stage',
        },
      )
      .toBeGreaterThan(0.1);
    expect(countDistinctColors(await canvas.screenshot()), {
      message: 'the scene canvas rendered as a flat colour',
    }).toBeGreaterThan(2);
  });
});

/** Creates a scene, closes the settings modal it opens, and views it. */
async function addScene(window: Page): Promise<void> {
  await openTab(window, 'Scenes');
  await window.getByRole('button', { name: 'Add scene' }).click();

  // Creation drops straight into the settings modal, which covers the stage.
  // It is dismissed by Escape or a backdrop click and has no close button, so
  // the dialog has to be on screen before the key is sent.
  const settings = window.getByRole('dialog', {
    name: 'Scene settings for New Scene',
  });
  await expect(settings).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(settings).toBeHidden();

  await window.getByRole('button', { name: 'View New Scene' }).click();
}
