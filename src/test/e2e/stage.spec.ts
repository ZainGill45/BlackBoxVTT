import { expect, test } from '@playwright/test';
import { AppFixture } from './support/app';
import type { LaunchedApp } from './support/app';
import { createAndOpenCampaign } from './support/flows';
import {
  pixelColorCoverage,
  pixelDifferenceRatio,
} from './support/png';
import {
  MAP_FIXTURE_COLORS,
  createEmptyScene,
  createSceneWithMap,
  importFixture,
  readScene,
  setMapOnScene,
  stage,
} from './support/stage';

/**
 * The renderer against a real GL context.
 *
 * Every SceneRenderer unit test runs against `pixiStub.ts` with synthetic
 * pointer events, so none of them has ever decoded a texture, hit-tested real
 * geometry, or drawn a pixel. These do.
 */

const CAMPAIGN = 'Emberfall';

test.describe('map rendering', () => {
  const apps = new AppFixture();
  let gm: LaunchedApp;

  test.beforeEach(async () => {
    gm = await apps.launch();
    await createAndOpenCampaign(gm.window, CAMPAIGN);
    await importFixture(gm.app, gm.window);
  });

  test.afterEach(() => apps.disposeAll());

  test('decodes the map image and draws it on the stage', async () => {
    await createSceneWithMap(gm.window, CAMPAIGN);

    // Assert the fixture's actual four quadrants. A hatch, outline, or other
    // non-empty canvas can have many colours and used to satisfy this test
    // without the map texture ever decoding.
    await expect
      .poll(async () => {
        const frame = await stage(gm.window).screenshot();
        return Math.min(
          ...MAP_FIXTURE_COLORS.map((color) =>
            pixelColorCoverage(frame, color, 40),
          ),
        );
      }, {
        message: 'one or more map fixture quadrants never reached the canvas',
      })
      .toBeGreaterThan(0.001);

    expect((await readScene(gm.window, CAMPAIGN)).mapImage).not.toBeNull();
  });

  test('changes what is drawn once a map is attached to the scene', async () => {
    await createEmptyScene(gm.window);
    const canvas = stage(gm.window);
    const withoutMap = await canvas.screenshot();

    await setMapOnScene(gm.window, CAMPAIGN);
    await expect
      .poll(async () => (await readScene(gm.window, CAMPAIGN)).mapImage)
      .not.toBeNull();

    // The same scene, before and after: the difference is the map itself.
    await expect
      .poll(async () => pixelDifferenceRatio(withoutMap, await canvas.screenshot()), {
        message: 'attaching a map changed nothing on the stage',
      })
      .toBeGreaterThan(0.05);
  });

  test('reveals the prepared map rather than a placeholder after reopening', async () => {
    await createSceneWithMap(gm.window, CAMPAIGN);
    const present = gm.window.getByRole('button', {
      name: 'Present New Scene',
    });
    await present.click();
    await expect(present).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(async () => {
        const frame = await stage(gm.window).screenshot();
        return Math.min(
          ...MAP_FIXTURE_COLORS.map((color) =>
            pixelColorCoverage(frame, color, 40),
          ),
        );
      })
      .toBeGreaterThan(0.001);

    await gm.window.getByRole('button', { name: 'Logout' }).click();
    await gm.window.getByRole('tab', { name: 'Create Campaign' }).click();
    await gm.window.getByRole('button', { name: `Open ${CAMPAIGN}` }).click();
    await expect(gm.window.getByRole('tab', { name: 'Chat' })).toBeVisible();

    const firstExposedFrame = await stage(gm.window).screenshot();
    expect(
      Math.min(
        ...MAP_FIXTURE_COLORS.map((color) =>
          pixelColorCoverage(firstExposedFrame, color, 40),
        ),
      ),
      'campaign readiness exposed the map placeholder on reopen',
    ).toBeGreaterThan(0.001);
  });
});
