import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { AppFixture } from './support/app';
import type { LaunchedApp } from './support/app';
import { createAndOpenCampaign } from './support/flows';
import { countDistinctColors } from './support/png';
import { importFixture, revealAsset } from './support/stage';

/**
 * Behaviour that only exists inside the real Electron shell.
 *
 * None of this is reachable from vitest: the file picker is an OS window, the
 * asset protocol is registered on the real session, and the lifecycle handlers
 * in main.ts run against a real app instance. Several of these guard failure
 * modes with no coverage of any kind before now — a second launch spawning a
 * duplicate app, a quit that skips shutdown, a window that never appears.
 */

const CAMPAIGN = 'Emberfall';
const require = createRequire(__filename);
const electronBinary = require('electron') as string;
const mainEntry = path.resolve(__dirname, '../../../.vite/build/main.js');

test.describe('asset pipeline through the shell', () => {
  const apps = new AppFixture();
  let gm: LaunchedApp;

  test.beforeEach(async () => {
    gm = await apps.launch();
    await createAndOpenCampaign(gm.window, CAMPAIGN);
  });

  test.afterEach(() => apps.disposeAll());

  test('imports the file chosen from the native picker', async () => {
    await importFixture(gm.app, gm.window);

    // Present in the manifest the panel renders from, which only happens after
    // the main process hashed and indexed the real bytes.
    await expect(gm.window.getByLabel('Name for map.png')).toBeAttached();
  });

  test('serves asset bytes to the renderer over the blackbox-asset protocol', async () => {
    await importFixture(gm.app, gm.window);
    await revealAsset(gm.window, 'map.png');

    await gm.window.getByRole('button', { name: 'Preview map.png' }).click();
    const image = gm.window.getByRole('img', { name: 'map.png' });
    await expect(image).toBeVisible();

    // A decoded bitmap proves the custom protocol answered with real bytes;
    // a broken URL would leave naturalWidth at zero.
    await expect
      .poll(async () =>
        image.evaluate((element: HTMLImageElement) => element.naturalWidth),
      )
      .toBe(256);
    await expect(gm.window.locator('img[src^="blackbox-asset://"]')).toBeAttached();
  });

  test('renders a page of an imported PDF', async () => {
    await importFixture(gm.app, gm.window, 'handout.pdf');
    await revealAsset(gm.window, 'handout.pdf');

    await gm.window.getByRole('button', { name: 'Preview handout.pdf' }).click();

    // pdf.js only exists as a worker in the real bundle, so this path has never
    // executed under vitest.
    const page = gm.window.getByLabel('PDF page 1');
    await expect(page).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate((element: HTMLCanvasElement) => element.width),
      )
      .toBeGreaterThan(0);
    await expect
      .poll(async () => countDistinctColors(await page.screenshot()), {
        message: 'pdf.js sized the canvas but never painted the PDF page',
      })
      .toBeGreaterThan(2);
  });

  test('plays an imported audio file', async () => {
    await importFixture(gm.app, gm.window, 'theme.wav');
    await revealAsset(gm.window, 'theme.wav');

    await gm.window.getByRole('button', { name: 'Preview theme.wav' }).click();
    await expect(gm.window.getByRole('button', { name: 'Play audio' })).toBeVisible();

    await gm.window.getByRole('button', { name: 'Play audio' }).click();

    // The element decoded the stream and the clock is running.
    await expect(gm.window.getByRole('button', { name: 'Pause audio' })).toBeVisible();
    await expect
      .poll(async () =>
        gm.window
          .locator('audio')
          .evaluate((element: HTMLAudioElement) => element.currentTime),
      )
      .toBeGreaterThan(0);
  });
});

test.describe('application lifecycle', () => {
  const apps = new AppFixture();

  test.afterEach(() => apps.disposeAll());

  test('hands a second launch back to the running instance', async () => {
    const first = await apps.launch();
    const windowsBefore = await first.app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    );

    // Same profile, so the single-instance lock is the one already held.
    const second = spawn(
      electronBinary,
      [mainEntry, `--user-data-dir=${first.userDataPath}`],
      { stdio: 'ignore' },
    );
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        second.kill();
        reject(new Error('the second instance never exited'));
      }, 30_000);
      second.once('error', reject);
      second.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    expect(exitCode).toBe(0);
    // And the original is still the only window serving the user.
    await expect(first.window.getByRole('tab', { name: 'Create Campaign' })).toBeVisible();
    expect(
      await first.app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(windowsBefore);
  });

  test('reveals the window when the renderer fails to load', async () => {
    const { app, window } = await apps.launch();

    const revealed = await app.evaluate(async ({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows()[0];
      target.hide();
      // A main-frame load failure would otherwise leave the window hidden with
      // no way for anyone to see what went wrong.
      await target.webContents
        .loadURL('file:///blackbox-missing-page.html')
        .catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
      return target.isVisible();
    });

    expect(revealed).toBe(true);
    expect(window).toBeDefined();
  });

  test('shuts down cleanly when a quit is requested', async () => {
    const { app, window } = await apps.launch();
    await createAndOpenCampaign(window, CAMPAIGN);

    // before-quit vetoes the first attempt and runs shutdown first, so this
    // asserts the app still reaches exit rather than hanging on its own veto.
    const closed = app.waitForEvent('close');
    await app.evaluate(({ app: electronApp }) => electronApp.quit());

    await closed;
  });

  test('opens the empty Journal collection shell', async () => {
    const { window } = await apps.launch();
    await createAndOpenCampaign(window, CAMPAIGN);

    await window.getByRole('tab', { name: 'Journal' }).click();
    await expect(
      window.getByRole('searchbox', { name: 'Search journal' }),
    ).toBeVisible();
    const add = window.getByRole('button', { name: 'Add journal entry' });
    await expect(add).toBeEnabled();
    await add.click();
    await expect(
      window.locator('[data-sidebar-icon="journal"] svg'),
    ).toBeVisible();
  });
});
