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

  test('authors and restores a rich Journal note in one modal', async () => {
    const first = await apps.launch();
    let { window } = first;
    await createAndOpenCampaign(window, CAMPAIGN);

    await window.getByRole('tab', { name: 'Journal' }).click();
    await expect(
      window.getByRole('searchbox', { name: 'Search journal' }),
    ).toBeVisible();
    const add = window.getByRole('button', { name: 'Add journal entry' });
    await expect(add).toBeEnabled();
    await add.click();

    const actorMenu = window.getByRole('menu', {
      name: 'Choose journal entry type',
    });
    await expect(actorMenu.getByRole('menuitem', { name: 'Note' })).toBeVisible();
    await actorMenu.getByRole('menuitem', { name: 'Character' }).click();
    const characterSheet = window.getByRole('dialog', {
      name: 'New Character character sheet',
    });
    await expect(characterSheet).toBeVisible();
    await characterSheet.press('Escape');
    await expect(characterSheet).toHaveCount(0);

    await add.click();
    await window.getByRole('menuitem', { name: 'Note' }).click();

    const noteModal = window.getByRole('dialog').filter({
      has: window.getByRole('textbox', { name: 'Note name' }),
    });
    await expect(noteModal).toBeVisible();
    await expect(window.getByRole('dialog')).toHaveCount(1);
    await expect(
      noteModal.getByRole('toolbar', { name: 'Rich text formatting toolbar' }),
    ).toBeVisible();
    await expect(noteModal.getByRole('textbox', { name: 'Page content' })).toHaveAttribute(
      'contenteditable',
      'true',
    );
    await expect(noteModal.getByRole('button', { name: 'Close note' })).toHaveCount(0);
    const modalBounds = await noteModal.boundingBox();
    expect(modalBounds?.width).toBeGreaterThan(1186);
    expect(modalBounds?.width).toBeCloseTo(1280, 0);
    expect(modalBounds?.height).toBeGreaterThanOrEqual(820);
    expect(modalBounds?.height).toBeLessThanOrEqual(840);
    const titleGeometry = await noteModal.getByLabel('Note name').evaluate((input) => {
      const header = input.parentElement;
      if (!header) throw new Error('The note title header is missing.');
      const inputBounds = input.getBoundingClientRect();
      return {
        fontSize: Number.parseFloat(getComputedStyle(input).fontSize),
        headerHeight: header.clientHeight,
        headerWidth: header.clientWidth,
        inputHeight: inputBounds.height,
        inputWidth: inputBounds.width,
      };
    });
    expect(Math.abs(titleGeometry.inputWidth - titleGeometry.headerWidth))
      .toBeLessThanOrEqual(1);
    expect(titleGeometry.inputHeight).toBeCloseTo(titleGeometry.headerHeight, 0);
    expect(titleGeometry.fontSize).toBeGreaterThanOrEqual(20);
    await noteModal.getByLabel('Note name').fill('Campaign Chronicle');
    await noteModal.getByLabel('Note name').focus();
    await noteModal.getByRole('button', { name: 'Style: Title' }).click();
    await noteModal.getByRole('button', { name: 'Italic' }).click();
    await noteModal.getByRole('button', { name: 'Font Family: Default' }).click();
    await noteModal.getByRole('button', { name: 'Lora' }).click();
    await expect(noteModal.getByLabel('Note name')).toHaveCSS('font-style', 'italic');
    await expect(noteModal.getByLabel('Note name')).toHaveCSS('font-family', /Lora Variable/);
    await expect(noteModal.getByRole('button', { name: 'Text Color: Default' })).toBeVisible();
    await expect(noteModal.getByLabel('Highlight color')).toHaveCount(0);
    await expect(noteModal.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    await expect(noteModal.getByRole('button', { name: 'Redo' })).toHaveCount(0);
    const toolbar = noteModal.getByRole('toolbar', { name: 'Rich text formatting toolbar' });
    await expect(toolbar.locator(':scope > details')).toHaveCount(7);
    await expect(toolbar.locator(':scope > select, :scope > label')).toHaveCount(0);
    await expect(noteModal.getByLabel('Page title')).toHaveCount(0);
    const prose = noteModal.locator('.ProseMirror');
    await prose.fill('The brass key opens the western vault.');
    await prose.press('Control+A');
    await noteModal.getByRole('button', { name: 'Style: Paragraph' }).click();
    await noteModal.getByRole('button', { name: 'Italic' }).click();
    await expect(prose.locator('em')).toHaveCSS('font-style', 'italic');
    await prose.press('End');

    const pastedImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64').toString('base64');
    await prose.evaluate((element, bytesBase64) => {
      const bytes = Uint8Array.from(atob(bytesBase64), (value) => value.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'pasted-map.png', { type: 'image/png' }));
      element.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }));
    }, pastedImage);
    const embeddedImages = noteModal.locator('figure img');
    const embeddedImage = embeddedImages.first();
    await expect(embeddedImage).toBeVisible();
    await expect
      .poll(() =>
        embeddedImage.evaluate((image) =>
          getComputedStyle(image.closest('figure')!).marginLeft,
        ),
      )
      .toBe('0px');
    await expect
      .poll(() =>
        embeddedImage.evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    const embeddedSource = await embeddedImage.getAttribute('src');
    await noteModal.getByRole('button', { name: 'Insert' }).click();
    await noteModal.getByRole('button', { name: 'Image' }).click();
    const imageChooser = window.getByRole('dialog', {
      name: 'Choose a Journal image',
    });
    await expect(imageChooser).toBeVisible();
    await imageChooser.getByRole('button', { name: 'pasted-map.png' }).click();
    await expect(embeddedImages).toHaveCount(2);
    await prose.press('Control+A');
    await noteModal.getByRole('button', { name: 'Style: Paragraph' }).click();
    await noteModal.getByRole('button', { name: 'Bold' }).click();
    await noteModal.getByLabel('Note name').blur();
    await expect(noteModal.getByText('Saved', { exact: true })).toBeVisible();
    await expect(embeddedImage).toHaveAttribute('src', embeddedSource!);
    await window.mouse.click(10, 10);
    await expect(noteModal).not.toBeVisible();
    const deleteNote = window.getByRole('button', {
      name: 'Delete Campaign Chronicle',
    });
    await expect(deleteNote).toHaveAttribute('aria-pressed', 'false');
    expect(
      await deleteNote.evaluate((button) => getComputedStyle(button).backgroundImage),
    ).not.toBe('none');
    await deleteNote.click();
    const confirmDeleteNote = window.getByRole('button', {
      name: 'Confirm deletion of Campaign Chronicle',
    });
    await expect(confirmDeleteNote).toHaveAttribute('aria-pressed', 'true');
    expect(
      await confirmDeleteNote.evaluate(
        (button) => getComputedStyle(button).backgroundImage,
      ),
    ).toBe('none');
    await window.getByRole('tab', { name: 'Storage' }).click();
    await expect(window.getByLabel('Name for pasted-map.png')).toBeAttached();

    await first.app.close();
    const restarted = await apps.launchInto(first.userDataPath);
    window = restarted.window;
    await window.getByRole('tab', { name: 'Create Campaign' }).click();
    await window.getByRole('button', { name: `Open ${CAMPAIGN}` }).click();
    await window.getByRole('tab', { name: 'Journal' }).click();
    await window.locator('button[aria-expanded]', { hasText: 'Notes' }).click();
    await window.getByRole('button', {
      exact: true,
      name: 'Open Campaign Chronicle',
    }).click();
    const restored = window.getByRole('dialog', { name: 'Campaign Chronicle' });
    await expect(restored.getByLabel('Page title')).toHaveCount(0);
    await expect(restored.getByLabel('Note name')).toHaveCSS('font-family', /Lora Variable/);
    await expect(restored.getByLabel('Note name')).toHaveCSS('font-style', 'italic');
    await expect(restored.getByText('The brass key opens the western vault.')).toBeVisible();
  });

  test('persists the D&D Character lifecycle in its grouped Journal slice', async () => {
    const first = await apps.launch();
    let { window } = first;
    await createAndOpenCampaign(window, CAMPAIGN);
    await window.getByRole('tab', { name: 'Journal' }).click();
    const add = window.getByRole('button', { name: 'Add journal entry' });

    await add.click();
    await window.getByRole('menuitem', { name: 'Character' }).click();
    let sheet = window.getByRole('dialog', { name: 'New Character character sheet' });
    await expect(sheet).toBeVisible();
    await sheet.press('Escape');

    const characterRows = window.locator(
      '[data-journal-group-id="dnd5e.characters"]',
    );
    const firstCharacterId = await characterRows.first().getAttribute(
      'data-journal-order-id',
    );
    expect(firstCharacterId).not.toBeNull();

    const firstCharacterName = window.getByRole('textbox', {
      name: 'Name for New Character',
    });
    await firstCharacterName.fill('Rowen');
    await firstCharacterName.press('Enter');
    await expect(window.getByRole('textbox', { name: 'Name for Rowen' })).toHaveValue('Rowen');

    await window.getByRole('button', {
      exact: true,
      name: 'Open Rowen',
    }).click();
    sheet = window.getByRole('dialog', { name: 'Rowen character sheet' });
    await expect(sheet).toBeVisible();
    await sheet.press('Escape');

    await window.getByRole('button', {
      exact: true,
      name: 'Open Rowen',
    }).click({ button: 'right' });
    await expect(window.getByRole('menuitem', { name: 'Rename Character' })).toHaveCount(0);
    await window.keyboard.press('Escape');

    await add.click();
    await window.getByRole('menuitem', { name: 'Character' }).click();
    await window.getByRole('dialog', { name: 'New Character character sheet' }).press('Escape');
    await expect(characterRows).toHaveCount(2);
    const secondCharacterId = await characterRows.nth(1).getAttribute(
      'data-journal-order-id',
    );
    await characterRows.nth(1).getByRole('button', {
      exact: true,
      name: 'Open New Character',
    }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: 'Move Character Up' }).click();
    await expect.poll(async () =>
      characterRows.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-journal-order-id'))),
    ).toEqual([secondCharacterId, firstCharacterId]);

    const deleteCharacter = characterRows.first().getByRole('button', {
      name: 'Delete New Character',
    });
    await deleteCharacter.click();
    await characterRows.first().getByRole('button', {
      name: 'Confirm deletion of New Character',
    }).click();
    await expect(characterRows).toHaveCount(1);

    await first.app.close();
    const restarted = await apps.launchInto(first.userDataPath);
    window = restarted.window;
    await window.getByRole('tab', { name: 'Create Campaign' }).click();
    await window.getByRole('button', { name: `Open ${CAMPAIGN}` }).click();
    await window.getByRole('tab', { name: 'Journal' }).click();
    await window.locator('button[aria-expanded]', { hasText: 'Characters' }).click();
    await expect(window.getByRole('button', {
      exact: true,
      name: 'Open Rowen',
    })).toHaveCount(1);
    const restartedCharacterRows = window.locator(
      '[data-journal-group-id="dnd5e.characters"]',
    );
    await expect(restartedCharacterRows.first()).toHaveAttribute(
      'data-journal-order-id',
      firstCharacterId!,
    );
  });
});
