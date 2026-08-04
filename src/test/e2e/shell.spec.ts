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
    expect(modalBounds?.width).toBeLessThanOrEqual(1122);
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
    expect(titleGeometry.inputWidth).toBeCloseTo(titleGeometry.headerWidth, 0);
    expect(titleGeometry.inputHeight).toBeCloseTo(titleGeometry.headerHeight, 0);
    expect(titleGeometry.fontSize).toBeGreaterThanOrEqual(20);
    await noteModal.getByLabel('Note name').fill('Campaign Chronicle');
    await noteModal.getByLabel('Note name').focus();
    await noteModal.getByRole('button', { name: 'Italic' }).click();
    await noteModal.getByRole('combobox', { name: 'Font family' }).selectOption('lora');
    await expect(noteModal.getByLabel('Note name')).toHaveCSS('font-style', 'italic');
    await expect(noteModal.getByLabel('Note name')).toHaveCSS('font-family', /Lora Variable/);
    await expect(noteModal.getByLabel('Text color')).toHaveValue('#f0f0f0');
    await expect(noteModal.getByLabel('Highlight color')).toHaveCount(0);
    await expect(noteModal.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    await expect(noteModal.getByRole('button', { name: 'Redo' })).toHaveCount(0);
    const fontSelectAppearance = await noteModal
      .getByRole('combobox', { name: 'Font family' })
      .evaluate((element) => {
        const select = element as HTMLSelectElement;
        return {
          appearance: getComputedStyle(select).appearance,
          colorScheme: getComputedStyle(select).colorScheme,
          optionBackground: getComputedStyle(select.options[0]).backgroundColor,
          optionColor: getComputedStyle(select.options[0]).color,
          width: select.getBoundingClientRect().width,
        };
      });
    expect(fontSelectAppearance.appearance).toBe('none');
    expect(fontSelectAppearance.colorScheme).toBe('dark');
    expect(fontSelectAppearance.optionBackground).toBe('rgb(29, 29, 29)');
    expect(fontSelectAppearance.optionColor).toBe('rgb(240, 240, 240)');
    expect(fontSelectAppearance.width).toBeGreaterThan(100);
    await noteModal.getByLabel('Page title').fill('Session Zero');
    await noteModal.getByLabel('Page title').focus();
    await noteModal.getByRole('button', { name: 'Underline' }).click();
    await expect(noteModal.getByLabel('Page title')).toHaveCSS('text-decoration-line', 'underline');
    const prose = noteModal.locator('.ProseMirror');
    const titleToBodyGap = await noteModal.evaluate((modal) => {
      const title = modal.querySelector<HTMLInputElement>('[aria-label="Page title"]');
      const body = modal.querySelector<HTMLElement>('.ProseMirror');
      if (!title || !body) throw new Error('The Journal page layout is incomplete.');
      return body.getBoundingClientRect().top - title.getBoundingClientRect().bottom;
    });
    expect(titleToBodyGap).toBeLessThanOrEqual(10);
    await prose.fill('The brass key opens the western vault.');
    await prose.press('Control+A');
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
    const pageTitleTop = await noteModal.getByLabel('Page title').evaluate(
      (input) => input.getBoundingClientRect().top,
    );
    await prose.evaluate((content) => {
      if (content.parentElement) content.parentElement.scrollTop = 500;
    });
    await expect
      .poll(() => noteModal.getByLabel('Page title').evaluate(
        (input) => input.getBoundingClientRect().top,
      ))
      .toBeCloseTo(pageTitleTop, 0);
    const embeddedSource = await embeddedImage.getAttribute('src');
    await noteModal.getByRole('button', { name: 'Image' }).click();
    const imageChooser = window.getByRole('dialog', {
      name: 'Choose a Journal image',
    });
    await expect(imageChooser).toBeVisible();
    await imageChooser.getByRole('button', { name: 'pasted-map.png' }).click();
    await expect(embeddedImages).toHaveCount(2);
    await prose.press('Control+A');
    await noteModal.getByRole('button', { name: 'Bold' }).click();
    await noteModal.getByLabel('Note name').blur();
    await expect(noteModal.getByText('Saved', { exact: true })).toBeVisible();
    await expect(embeddedImage).toHaveAttribute('src', embeddedSource!);
    await window.mouse.click(10, 10);
    await expect(noteModal).not.toBeVisible();
    await window
      .getByRole('button', { name: /Campaign Chronicle/ })
      .click({ button: 'right' });
    const deleteNote = window.getByRole('menuitem', { name: 'Delete Note' });
    await expect(deleteNote).toHaveAttribute('aria-pressed', 'false');
    expect(
      await deleteNote.evaluate((button) => getComputedStyle(button).backgroundImage),
    ).not.toBe('none');
    await deleteNote.click();
    const confirmDeleteNote = window.getByRole('menuitem', {
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
    await window.getByRole('button', { name: /Campaign Chronicle/ }).click();
    const restored = window.getByRole('dialog', { name: 'Campaign Chronicle' });
    await expect(restored.getByLabel('Page title')).toHaveValue('Session Zero');
    await expect(restored.getByLabel('Note name')).toHaveCSS('font-family', /Lora Variable/);
    await expect(restored.getByLabel('Note name')).toHaveCSS('font-style', 'italic');
    await expect(restored.getByLabel('Page title')).toHaveCSS('text-decoration-line', 'underline');
    await expect(restored.getByText('The brass key opens the western vault.')).toBeVisible();
  });
});
