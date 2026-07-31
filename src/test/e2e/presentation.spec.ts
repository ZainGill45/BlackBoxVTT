import { expect, test } from '@playwright/test';
import { AppFixture, availablePort } from './support/app';
import {
  addPlayer,
  createAndOpenCampaign,
  joinCampaign,
  openTab,
  setHostPort,
} from './support/flows';
import { countDistinctColors, pixelDifferenceRatio } from './support/png';

/**
 * Two windows, one campaign.
 *
 * `networkIntegration.test.ts` covers the host/client protocol in a single
 * process, and the SceneRenderer tests cover the stage against a stubbed Pixi.
 * Neither covers them wired together, which is where a renderer that ignores a
 * scene update, or a host that never sends one, would actually show up.
 */

const CAMPAIGN = 'Emberfall';
const PASSWORD = 'password';

test.describe('scene presentation', () => {
  const apps = new AppFixture();
  test.afterEach(() => apps.disposeAll());

  test("presents the Game Master's scene to a connected player", async () => {
    const port = await availablePort();

    const gm = await apps.launch();
    await createAndOpenCampaign(gm.window, CAMPAIGN);
    await addPlayer(gm.window, 'Alice', PASSWORD);
    await setHostPort(gm.window, port);

    const alice = await apps.launch();
    await joinCampaign(alice.window, {
      campaign: CAMPAIGN,
      password: PASSWORD,
      port,
      username: 'Alice',
    });

    await expect(
      alice.window.getByText('No scene is being displayed.'),
    ).toBeAttached();
    const playerStage = alice.window.locator('canvas').first();
    await expect(playerStage).toBeVisible();
    const beforePresenting = await playerStage.screenshot();

    await openTab(gm.window, 'Scenes');
    await gm.window.getByRole('button', { name: 'Add scene' }).click();
    const settings = gm.window.getByRole('dialog', {
      name: 'Scene settings for New Scene',
    });
    await expect(settings).toBeVisible();
    await gm.window.keyboard.press('Escape');
    await expect(settings).toBeHidden();

    await gm.window.getByRole('button', { name: 'Present New Scene' }).click();

    // The accessible status is the semantic contract; the frame comparison
    // independently proves the renderer reacted rather than only updating
    // React state.
    await expect(
      alice.window.getByText('Viewing the scene New Scene.'),
    ).toBeAttached();
    await expect
      .poll(
        async () =>
          pixelDifferenceRatio(beforePresenting, await playerStage.screenshot()),
        {
          message: "the player's view never changed after the scene was presented",
        },
      )
      .toBeGreaterThan(0.1);

    // And what arrived is drawn, not a blank stage where a scene should be.
    expect(countDistinctColors(await playerStage.screenshot())).toBeGreaterThan(2);
  });
});
