import { expect, test } from '@playwright/test';
import { AppFixture } from './support/app';

/**
 * The floor the rest of the suite stands on: the production-shaped build boots,
 * the preload bridge is installed, and the renderer paints a real screen. When
 * this fails, every other failure in the suite is noise.
 */
test.describe('application launch', () => {
  const apps = new AppFixture();
  test.afterEach(() => apps.disposeAll());

  test('boots to the connection screen with the preload bridge installed', async () => {
    const { window } = await apps.launch();

    await expect(window.getByRole('tab', { name: 'Create Campaign' })).toBeVisible();
    await expect(window.getByRole('tab', { name: 'Join Campaign' })).toBeVisible();

    // contextIsolation is on, so this proves the bridge crossed the boundary
    // rather than that the renderer has Node access.
    const bridge = await window.evaluate(() =>
      Object.keys(
        (window as unknown as { blackBox?: Record<string, unknown> }).blackBox ?? {},
      ).sort(),
    );
    expect(bridge).toEqual([
      'application',
      'assets',
      'campaigns',
      'network',
      'scenes',
    ]);
  });

  test('runs the Electron build under the expected Node runtime', async () => {
    const { app } = await apps.launch();

    // Carried over from the packaged smoke test: a major Node bump under
    // Electron changes crypto and fs behaviour the network layer depends on.
    const nodeVersion = await app.evaluate(() => process.versions.node);
    expect(nodeVersion.startsWith('24.')).toBe(true);
  });
});
