import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { DND5E_SKILLS } from '../../systems/dnd5e/characterData';
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
    const pageName = noteModal.getByRole('textbox', { name: 'Name for New Page' });
    const pageRow = pageName.locator('..').locator('..');
    await expect(pageRow.getByRole('button', { name: 'Open New Page' }))
      .toHaveAttribute('aria-current', 'page');
    await expect(pageRow.getByRole('button', { name: 'Delete New Page' }))
      .toBeDisabled();
    await expect(pageRow.getByText('Inherits', { exact: true })).toBeVisible();
    await pageName.fill('Vault Records');
    await pageName.press('Enter');
    await expect(noteModal.getByRole('textbox', { name: 'Name for Vault Records' }))
      .toHaveValue('Vault Records');
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
    await expect(restored.getByRole('textbox', { name: 'Name for Vault Records' }))
      .toHaveValue('Vault Records');
    await expect(restored.getByRole('button', { name: 'Open Vault Records' }))
      .toHaveAttribute('aria-current', 'page');
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
    let sheet = window.getByRole('dialog', { name: /character sheet$/ });
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAccessibleName('New Character character sheet');
    const sheetBounds = await sheet.boundingBox();
    expect(sheetBounds).not.toBeNull();
    expect(sheetBounds!.width / sheetBounds!.height).toBeGreaterThan(0.75);
    expect(sheetBounds!.width / sheetBounds!.height).toBeLessThan(0.80);
    const tokenBounds = await sheet.getByLabel('Character token').boundingBox();
    const abilitiesBounds = await sheet.getByRole('region', { name: 'Abilities' }).boundingBox();
    const tabList = sheet.getByRole('tablist', { name: 'Character sheet sections' });
    const tabBounds = await tabList.boundingBox();
    const homeBounds = await sheet.getByRole('tabpanel').boundingBox();
    expect(tokenBounds!.height / sheetBounds!.height).toBeGreaterThan(0.10);
    expect(tokenBounds!.height / sheetBounds!.height).toBeLessThan(0.13);
    expect(abilitiesBounds!.height / sheetBounds!.height).toBeGreaterThan(0.10);
    expect(abilitiesBounds!.height / sheetBounds!.height).toBeLessThan(0.13);
    expect(tabBounds!.height / sheetBounds!.height).toBeGreaterThan(0.025);
    expect(tabBounds!.height / sheetBounds!.height).toBeLessThan(0.05);
    expect(homeBounds!.height / sheetBounds!.height).toBeGreaterThan(0.66);
    const tabCells = await Promise.all(
      (await tabList.getByRole('tab').all()).map((tab) => tab.boundingBox()),
    );
    expect(Math.max(...tabCells.map((box) => box!.width)) - Math.min(...tabCells.map((box) => box!.width)))
      .toBeLessThan(2);
    expect(Math.abs(tabCells[0]!.x + tabCells[0]!.width - tabCells[1]!.x)).toBeLessThan(2);
    expect(Math.abs(tabCells[1]!.x + tabCells[1]!.width - tabCells[2]!.x)).toBeLessThan(2);
    expect(await tabList.getByRole('tab', { name: 'Home' }).evaluate((tab) => {
      const style = tab.ownerDocument.defaultView!.getComputedStyle(tab);
      return {
        backgroundImage: style.backgroundImage,
        boxShadow: style.boxShadow,
      };
    })).toEqual({
      backgroundImage: expect.stringContaining('repeating-linear-gradient'),
      boxShadow: 'none',
    });
    const headerFieldLabels = [
      'Name',
      'Class',
      'Subclass',
      'Level',
      'Experience',
      'Species',
      'Lineage',
      'Creature Type',
      'Age',
      'Height',
      'Weight',
      'Eyes',
      'Skin',
      'Hair',
      'Size',
    ] as const;
    const dropdownFieldLabels = new Set<string>(['Class', 'Level']);
    const headerFieldTitles = {
      Age: "The character's age.",
      Class: "The character's primary adventuring class.",
      'Creature Type': "The character's creature type, such as Humanoid.",
      Experience: "The character's accumulated experience points.",
      Eyes: "The character's eye color or appearance.",
      Hair: "The character's hair color or appearance.",
      Height: "The character's height.",
      Level: "The character's current class level, from 1 to 20.",
      Lineage: "The character's lineage, if applicable.",
      Name: 'The name used to identify this character.',
      Size: "The character's size category, such as Medium or Small.",
      Skin: "The character's skin color or appearance.",
      Species: "The character's species.",
      Subclass: "The specialization chosen within the character's class.",
      Weight: "The character's weight.",
    } satisfies Record<(typeof headerFieldLabels)[number], string>;
    const headerFieldBounds = Object.fromEntries(await Promise.all(
      headerFieldLabels.map(async (label) => [
        label,
        (await sheet.getByRole(
          dropdownFieldLabels.has(label) ? 'button' : 'textbox',
          { exact: true, name: label },
        )
          .locator('..')
          .boundingBox())!,
      ] as const),
    ));
    for (const label of headerFieldLabels) {
      await expect(sheet.getByRole(
        dropdownFieldLabels.has(label) ? 'button' : 'textbox',
        { exact: true, name: label },
      )).toHaveAttribute('title', headerFieldTitles[label]);
    }
    const headerRowHeights = ['Name', 'Species', 'Weight']
      .map((label) => headerFieldBounds[label].height);
    expect(Math.max(...headerRowHeights) - Math.min(...headerRowHeights)).toBeLessThan(2);
    const nameInput = sheet.getByRole('textbox', { exact: true, name: 'Name' });
    await expect(nameInput).toHaveValue('New Character');
    await expect(nameInput).toHaveAttribute('placeholder', 'Name');
    const subclassInput = sheet.getByRole('textbox', { exact: true, name: 'Subclass' });
    await expect(subclassInput).toHaveAttribute('placeholder', 'Subclass');
    const placeholderTypography = await subclassInput.evaluate((input) => {
      const style = input.ownerDocument.defaultView!.getComputedStyle(input, '::placeholder');
      return {
        color: style.color,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        textTransform: style.textTransform,
      };
    });
    expect(placeholderTypography.fontWeight).toBe('400');
    expect(placeholderTypography.textTransform).toBe('none');
    const emptyClassDropdown = sheet.getByRole('button', { exact: true, name: 'Class' });
    const emptyLevelDropdown = sheet.getByRole('button', { exact: true, name: 'Level' });
    await expect(emptyClassDropdown.locator('svg')).toHaveCount(0);
    await expect(emptyLevelDropdown.locator('svg')).toHaveCount(0);
    expect(await emptyClassDropdown.evaluate((control) => {
      const style = control.ownerDocument.defaultView!.getComputedStyle(control);
      return {
        color: style.color,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        textTransform: style.textTransform,
      };
    })).toEqual(placeholderTypography);
    const sectionRatio = async (heading: string) => {
      const bounds = await sheet.getByRole('heading', { name: heading }).locator('..').boundingBox();
      return bounds!.height / homeBounds!.height;
    };
    expect(await sectionRatio('Important Statistics')).toBeGreaterThan(0.25);
    expect(await sectionRatio('Important Statistics')).toBeLessThan(0.29);
    const importantStatsPanel = sheet.getByRole('heading', { name: 'Important Statistics' })
      .locator('..');
    const importantStatsHeaderStyle = await sheet.getByRole('heading', { name: 'Important Statistics' })
      .evaluate((heading) => {
        const style = heading.ownerDocument.defaultView!.getComputedStyle(heading);
        return {
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          borderBottomWidth: style.borderBottomWidth,
          color: style.color,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
        };
      });
    const importantStatsPanelBackground = await importantStatsPanel.evaluate((panel) =>
      panel.ownerDocument.defaultView!.getComputedStyle(panel).backgroundColor);
    expect(importantStatsHeaderStyle.backgroundColor).not.toBe(importantStatsPanelBackground);
    expect(importantStatsHeaderStyle.backgroundImage).toContain('linear-gradient');
    expect(importantStatsHeaderStyle.borderBottomWidth).not.toBe('0px');
    expect(Number.parseFloat(importantStatsHeaderStyle.fontSize)).toBeLessThanOrEqual(11);
    expect(importantStatsHeaderStyle.fontWeight).toBe('500');
    const matchingPanelHeadings = [
      'Health',
      'Resources',
      'Actions',
      'Inventory',
      'Skills',
      'Features',
    ] as const;
    for (const headingName of matchingPanelHeadings) {
      const heading = sheet.getByRole('heading', { name: headingName });
      const [headingBounds, panelBounds, headingStyle] = await Promise.all([
        heading.boundingBox(),
        heading.locator('..').boundingBox(),
        heading.evaluate((element) => {
          const style = element.ownerDocument.defaultView!.getComputedStyle(element);
          return {
            backgroundImage: style.backgroundImage,
            borderBottomWidth: style.borderBottomWidth,
            color: style.color,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
          };
        }),
      ]);
      expect(headingBounds!.width / panelBounds!.width).toBeGreaterThan(0.99);
      expect(headingStyle).toEqual({
        backgroundImage: importantStatsHeaderStyle.backgroundImage,
        borderBottomWidth: importantStatsHeaderStyle.borderBottomWidth,
        color: importantStatsHeaderStyle.color,
        fontSize: importantStatsHeaderStyle.fontSize,
        fontWeight: importantStatsHeaderStyle.fontWeight,
      });
    }
    const importantStatDefaults = [
      ['Initiative', '0'],
      ['Armor Class', '10'],
      ['Current Speed', '30'],
      ['Concentration Save', '0'],
      ['Proficiency Bonus', '+2'],
      ['Inspiration Count', '0'],
    ] as const;
    const importantStatRows = await Promise.all(importantStatDefaults.map(async ([label]) => (
      await sheet.getByLabel(label).locator('..').boundingBox()
    )!));
    for (const [label, defaultValue] of importantStatDefaults) {
      await expect(sheet.getByLabel(label)).toHaveValue(defaultValue);
    }
    expect(Math.max(...importantStatRows.map(({ x }) => x)) -
      Math.min(...importantStatRows.map(({ x }) => x))).toBeLessThan(2);
    expect(Math.max(...importantStatRows.map(({ width }) => width)) -
      Math.min(...importantStatRows.map(({ width }) => width))).toBeLessThan(2);
    const importantStatsBounds = await importantStatsPanel.boundingBox();
    expect(importantStatRows[0].width / importantStatsBounds!.width).toBeGreaterThan(0.94);
    expect(Math.min(...importantStatRows.map(({ height }) => height))).toBeGreaterThanOrEqual(27);
    expect(Math.max(...importantStatRows.map(({ height }) => height))).toBeLessThanOrEqual(29);
    for (let index = 1; index < importantStatRows.length; index += 1) {
      expect(Math.abs(
        importantStatRows[index].y -
        (importantStatRows[index - 1].y + importantStatRows[index - 1].height),
      )).toBeLessThan(1);
    }
    expect(await sheet.getByLabel('Initiative').locator('..').evaluate((row) => {
      const style = row.ownerDocument.defaultView!.getComputedStyle(row);
      const labelStyle = row.ownerDocument.defaultView!.getComputedStyle(row.querySelector('span')!);
      return {
        backgroundColor: style.backgroundColor,
        borderLeftWidth: style.borderLeftWidth,
        borderRightWidth: style.borderRightWidth,
        borderTopWidth: style.borderTopWidth,
        borderBottomWidth: style.borderBottomWidth,
        labelFontSize: labelStyle.fontSize,
      };
    })).toEqual({
      backgroundColor: 'rgba(0, 0, 0, 0)',
      borderLeftWidth: '0px',
      borderRightWidth: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '1px',
      labelFontSize: '10px',
    });
    const initiativeRow = sheet.getByLabel('Initiative').locator('..');
    await initiativeRow.hover();
    await sheet.getByLabel('Initiative').focus();
    expect(await initiativeRow.evaluate((row) => {
      const style = row.ownerDocument.defaultView!.getComputedStyle(row);
      return { backgroundColor: style.backgroundColor, boxShadow: style.boxShadow };
    })).toEqual({ backgroundColor: 'rgba(0, 0, 0, 0)', boxShadow: 'none' });
    expect(await sheet.getByLabel('Initiative').evaluate((input) => {
      const style = input.ownerDocument.defaultView!.getComputedStyle(input);
      return {
        backgroundColor: style.backgroundColor,
        borderWidth: style.borderWidth,
        fontSize: style.fontSize,
        textAlign: style.textAlign,
      };
    })).toEqual({
      backgroundColor: 'rgba(0, 0, 0, 0)',
      borderWidth: '0px',
      fontSize: '11px',
      textAlign: 'right',
    });
    const skillsPanel = sheet.getByRole('heading', { name: 'Skills' }).locator('..');
    const skillTrainingControls = skillsPanel.locator('button[data-training]');
    await expect(skillTrainingControls).toHaveCount(18);
    expect(await skillTrainingControls.evaluateAll((controls) =>
      controls.map((control) => control.getAttribute('aria-label')),
    )).toEqual(DND5E_SKILLS.map(({ label }) => `${label} training: Untrained`));
    const skillRows = await Promise.all(DND5E_SKILLS.map(async (skill) => {
      const output = skillsPanel.getByLabel(`${skill.label} bonus and passive score`);
      await expect(output).toHaveText('0 / 10');
      const row = output.locator('..');
      await expect(row.getByText(skill.abbreviation, { exact: true })).toBeVisible();
      return (await row.boundingBox())!;
    }));
    const skillsPanelBounds = await skillsPanel.boundingBox();
    expect(Math.min(...skillRows.map(({ width }) => width)) / skillsPanelBounds!.width)
      .toBeGreaterThan(0.98);
    expect(Math.min(...skillRows.map(({ height }) => height))).toBeGreaterThan(27);
    expect(Math.max(...skillRows.map(({ height }) => height))).toBeLessThan(29);
    for (let index = 1; index < skillRows.length; index += 1) {
      expect(Math.abs(
        skillRows[index].y - (skillRows[index - 1].y + skillRows[index - 1].height),
      )).toBeLessThan(1);
    }
    const addCustomSkill = skillsPanel.getByRole('button', { name: 'Add Custom Skill' });
    await expect(addCustomSkill).toBeEnabled();
    const addCustomSkillBounds = await addCustomSkill.boundingBox();
    const lastSkillRow = skillRows.at(-1)!;
    expect(addCustomSkillBounds!.y).toBeGreaterThanOrEqual(
      lastSkillRow.y + lastSkillRow.height,
    );
    expect(await addCustomSkill.evaluate((button) => {
      const style = button.ownerDocument.defaultView!.getComputedStyle(button);
      return {
        backgroundColor: style.backgroundColor,
        borderStyle: style.borderStyle,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        textTransform: style.textTransform,
      };
    })).toEqual({
      backgroundColor: 'rgba(0, 0, 0, 0)',
      borderStyle: 'dashed',
      fontSize: '10px',
      fontWeight: '400',
      textTransform: 'none',
    });
    await addCustomSkill.click();
    await expect(skillTrainingControls).toHaveCount(18);
    const skillRowStyle = await skillTrainingControls.first().locator('..').evaluate((row) => {
      const view = row.ownerDocument.defaultView!;
      const style = view.getComputedStyle(row);
      const label = row.querySelector('span')!;
      const text = label.querySelectorAll(':scope > span');
      const output = row.querySelector('output')!;
      return {
        abilityFontSize: view.getComputedStyle(text[0]!).fontSize,
        baselineOffset: Math.abs(
          text[0]!.getBoundingClientRect().bottom - text[1]!.getBoundingClientRect().bottom,
        ),
        backgroundColor: style.backgroundColor,
        borderBottomWidth: style.borderBottomWidth,
        borderLeftWidth: style.borderLeftWidth,
        borderRightWidth: style.borderRightWidth,
        borderTopWidth: style.borderTopWidth,
        labelAlignItems: view.getComputedStyle(label).alignItems,
        nameFontSize: view.getComputedStyle(text[1]!).fontSize,
        valueFontSize: view.getComputedStyle(output).fontSize,
      };
    });
    expect(skillRowStyle).toMatchObject({
      abilityFontSize: '9px',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      borderBottomWidth: '1px',
      borderLeftWidth: '0px',
      borderRightWidth: '0px',
      borderTopWidth: '0px',
      labelAlignItems: 'baseline',
      nameFontSize: '10px',
      valueFontSize: '10px',
    });
    expect(skillRowStyle.baselineOffset).toBeLessThan(1);
    const firstSkillRow = skillTrainingControls.first().locator('..');
    await firstSkillRow.hover();
    await skillTrainingControls.first().focus();
    expect(await firstSkillRow.evaluate((row) => {
      const style = row.ownerDocument.defaultView!.getComputedStyle(row);
      return { backgroundColor: style.backgroundColor, boxShadow: style.boxShadow };
    })).toEqual({ backgroundColor: 'rgba(0, 0, 0, 0)', boxShadow: 'none' });
    const healthPanel = sheet.getByRole('heading', { name: 'Health', exact: true }).locator('..');
    const healthPanelBounds = await healthPanel.boundingBox();
    expect(healthPanelBounds!.height).toBeGreaterThan(110);
    expect(healthPanelBounds!.height).toBeLessThan(120);
    expect(healthPanelBounds!.height / homeBounds!.height).toBeLessThan(0.2);
    const currentHitPoints = healthPanel.getByLabel('Current hit points');
    const maximumHitPoints = healthPanel.getByLabel('Maximum hit points');
    for (const [label, defaultValue] of [
      ['Current hit points', '1'],
      ['Maximum hit points', '1'],
      ['Temporary hit points', '0'],
      ['Current hit dice', '1'],
      ['Maximum hit dice', '1'],
      ['Hit die', 'd8'],
    ] as const) {
      await expect(healthPanel.getByLabel(label)).toHaveValue(defaultValue);
    }
    expect(await currentHitPoints.evaluate((input) => {
      const style = input.ownerDocument.defaultView!.getComputedStyle(input);
      return {
        backgroundColor: style.backgroundColor,
        borderWidth: style.borderWidth,
        boxShadow: style.boxShadow,
        fontSize: style.fontSize,
      };
    })).toEqual({
      backgroundColor: 'rgba(0, 0, 0, 0)',
      borderWidth: '0px',
      boxShadow: 'none',
      fontSize: '12px',
    });
    const healthQuadrants = await Promise.all([
      currentHitPoints.locator('..').locator('..').boundingBox(),
      healthPanel.getByLabel('Temporary hit points').locator('..').boundingBox(),
      healthPanel.getByLabel('Current hit dice').locator('..').locator('..').boundingBox(),
      healthPanel.getByRole('group', { name: 'Death save successes' })
        .locator('..')
        .locator('..')
        .boundingBox(),
    ]);
    expect(
      Math.max(...healthQuadrants.map((bounds) => bounds!.width)) -
      Math.min(...healthQuadrants.map((bounds) => bounds!.width)),
    ).toBeLessThan(1);
    expect(
      Math.max(...healthQuadrants.map((bounds) => bounds!.height)) -
      Math.min(...healthQuadrants.map((bounds) => bounds!.height)),
    ).toBeLessThan(1);
    expect(Math.abs(
      healthQuadrants[0]!.x + healthQuadrants[0]!.width -
      (healthPanelBounds!.x + healthPanelBounds!.width / 2),
    )).toBeLessThan(1);
    const deathSaveSuccesses = healthPanel.getByRole('group', {
      name: 'Death save successes',
    }).getByRole('button');
    const deathSaveFailures = healthPanel.getByRole('group', {
      name: 'Death save failures',
    }).getByRole('button');
    await expect(deathSaveSuccesses).toHaveCount(3);
    await expect(deathSaveFailures).toHaveCount(3);
    expect(await deathSaveSuccesses.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-pressed')))).toEqual([
      'false',
      'false',
      'false',
    ]);
    const collapsedPanelBounds = await Promise.all([
      'Actions',
      'Inventory',
      'Resources',
      'Features',
    ].map(async (name) => (
      await sheet.getByRole('heading', { name }).locator('..').boundingBox()
    )!));
    expect(Math.min(...collapsedPanelBounds.map(({ height }) => height))).toBeGreaterThan(70);
    expect(Math.max(...collapsedPanelBounds.map(({ height }) => height))).toBeLessThan(75);
    expect(
      Math.max(...collapsedPanelBounds.map(({ height }) => height)) -
      Math.min(...collapsedPanelBounds.map(({ height }) => height)),
    ).toBeLessThan(1);
    const panelAddButtons = [
      'Add Action',
      'Add Inventory Item',
      'Add Resource',
      'Add Feature',
    ].map((name) => sheet.getByRole('button', { name }));
    for (const button of panelAddButtons) {
      await expect(button).toBeEnabled();
      await expect(button).toHaveCSS('border-style', 'dashed');
    }
    const abilityNames = [
      'Strength',
      'Dexterity',
      'Constitution',
      'Intelligence',
      'Wisdom',
      'Charisma',
    ] as const;
    const abilityBoxes = await Promise.all(abilityNames.map(async (name) => (
      await sheet.getByRole('article', { name: `${name} ability` }).boundingBox()
    )!));
    expect(Math.max(...abilityBoxes.map(({ y }) => y)) - Math.min(...abilityBoxes.map(({ y }) => y)))
      .toBeLessThan(2);
    const strengthBounds = abilityBoxes[0];
    expect(Math.abs(tokenBounds!.x - strengthBounds!.x)).toBeLessThan(2);
    expect(Math.abs(tokenBounds!.width - strengthBounds!.width)).toBeLessThan(2);
    const classFieldBoxes = ['Name', 'Class', 'Subclass', 'Level', 'Experience']
      .map((label) => headerFieldBounds[label]);
    expect(
      Math.max(...classFieldBoxes.map(({ width }) => width)) -
      Math.min(...classFieldBoxes.map(({ width }) => width)),
    ).toBeLessThan(2);
    const detailFieldLabels = [
      'Species',
      'Lineage',
      'Creature Type',
      'Age',
      'Height',
      'Weight',
      'Eyes',
      'Skin',
      'Hair',
      'Size',
    ] as const;
    for (const [index, label] of detailFieldLabels.entries()) {
      const abilityBounds = abilityBoxes[index % 5 + 1];
      expect(Math.abs(headerFieldBounds[label].x - abilityBounds.x)).toBeLessThan(2);
      expect(Math.abs(headerFieldBounds[label].width - abilityBounds.width)).toBeLessThan(2);
    }
    const detailFieldBoxes = detailFieldLabels.slice(0, 5)
      .map((label) => headerFieldBounds[label]);
    const horizontalGaps = [...classFieldBoxes, ...detailFieldBoxes].flatMap(
      (_box, index, boxes) => index > 0
        ? [boxes[index].x - (boxes[index - 1].x + boxes[index - 1].width)]
        : [],
    ).filter((gap) => gap > 0);
    expect(Math.max(...horizontalGaps) - Math.min(...horizontalGaps)).toBeLessThan(2);
    const strengthModifier = sheet.getByLabel('Strength modifier');
    for (const ability of abilityNames) {
      await expect(sheet.getByLabel(`${ability} modifier`)).toHaveValue('0');
      await expect(sheet.getByLabel(`${ability} score`)).toHaveValue('10');
      await expect(sheet.getByLabel(`${ability} saving throw`)).toHaveValue('0');
    }
    await expect(strengthModifier).not.toHaveAttribute('placeholder');
    await expect(sheet.getByLabel('Strength score')).not.toHaveAttribute('placeholder');
    await expect(sheet.getByLabel('Strength saving throw')).not.toHaveAttribute('placeholder');
    expect(await strengthModifier.evaluate((input) => input.parentElement?.tagName))
      .toBe('LABEL');
    const strengthCard = sheet.getByRole('article', { name: 'Strength ability' });
    await expect(strengthCard.getByText('Score', { exact: true })).toBeVisible();
    await expect(strengthCard.getByText('Throw', { exact: true })).toBeVisible();
    const strengthHeading = strengthCard.getByRole('heading', { name: 'Strength' });
    const strengthLabelBounds = await strengthHeading.boundingBox();
    expect(Math.abs(
      strengthLabelBounds!.x + strengthLabelBounds!.width / 2 -
      (strengthBounds!.x + strengthBounds!.width / 2),
    )).toBeLessThan(1);
    const strengthHeadingStyle = await strengthHeading.evaluate((heading) => {
      const style = heading.ownerDocument.defaultView!.getComputedStyle(heading);
      return {
        backgroundImage: style.backgroundImage,
        borderBottomWidth: style.borderBottomWidth,
        color: style.color,
        fontSize: style.fontSize,
      };
    });
    expect(strengthHeadingStyle.backgroundImage).toBe(importantStatsHeaderStyle.backgroundImage);
    expect(strengthHeadingStyle.borderBottomWidth).toBe(importantStatsHeaderStyle.borderBottomWidth);
    expect(strengthHeadingStyle.color).toBe(importantStatsHeaderStyle.color);
    expect(strengthHeadingStyle.fontSize).toBe(importantStatsHeaderStyle.fontSize);
    const strengthFooterBounds = await sheet.getByLabel('Strength score')
      .locator('..')
      .locator('..')
      .boundingBox();
    expect(strengthFooterBounds!.height / strengthBounds!.height).toBeGreaterThan(0.30);
    expect(strengthFooterBounds!.height / strengthBounds!.height).toBeLessThan(0.34);
    const scoreLabelBounds = await strengthCard.getByText('Score', { exact: true }).boundingBox();
    const scoreInputBounds = await sheet.getByLabel('Strength score').boundingBox();
    expect(scoreInputBounds!.y - (scoreLabelBounds!.y + scoreLabelBounds!.height))
      .toBeGreaterThanOrEqual(1.5);
    await strengthModifier.focus();
    const strengthModifierMetrics = await strengthModifier.evaluate((input) => {
      const view = input.ownerDocument.defaultView!;
      const style = view.getComputedStyle(input);
      return {
        backgroundColor: style.backgroundColor,
        borderWidth: style.borderWidth,
        fontSize: Number.parseFloat(style.fontSize),
        parentBoxShadow: view.getComputedStyle(input.parentElement!).boxShadow,
      };
    });
    expect(strengthModifierMetrics.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(strengthModifierMetrics.borderWidth).toBe('0px');
    expect(strengthModifierMetrics.parentBoxShadow).toBe('none');
    const dexterityModifier = sheet.getByLabel('Dexterity modifier');
    const acrobaticsValues = sheet.getByLabel('Acrobatics bonus and passive score');
    const acrobaticsRow = acrobaticsValues.locator('..');
    const acrobaticsTraining = acrobaticsRow.getByRole('button');
    await dexterityModifier.fill('+3');
    await dexterityModifier.blur();
    await expect(acrobaticsValues).toHaveText('+3 / 13');
    await acrobaticsTraining.click();
    await expect(acrobaticsTraining).toHaveAccessibleName('Acrobatics training: Proficient');
    await expect(acrobaticsTraining).toHaveAttribute('data-training', 'proficient');
    await expect(acrobaticsValues).toHaveText('+5 / 15');
    await acrobaticsTraining.click();
    await expect(acrobaticsTraining).toHaveAccessibleName('Acrobatics training: Expertise');
    await expect(acrobaticsTraining).toHaveAttribute('data-training', 'expertise');
    await expect(acrobaticsValues).toHaveText('+7 / 17');
    await currentHitPoints.fill('7');
    await currentHitPoints.blur();
    await maximumHitPoints.fill('12');
    await maximumHitPoints.blur();
    await deathSaveSuccesses.nth(1).click();
    await expect(deathSaveSuccesses.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(deathSaveSuccesses.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(deathSaveSuccesses.nth(2)).toHaveAttribute('aria-pressed', 'false');
    await deathSaveFailures.first().click();
    await expect(deathSaveFailures.first()).toHaveAttribute('aria-pressed', 'true');
    await nameInput.fill('Rowen');
    await nameInput.blur();
    await expect(sheet).toHaveAccessibleName('Rowen character sheet');
    const classDropdown = emptyClassDropdown;
    await classDropdown.click();
    const classOptions = sheet.getByRole('group', { name: 'Class options' });
    expect(await classOptions.getByRole('button').allTextContents()).toEqual([
      'Artificer',
      'Barbarian',
      'Bard',
      'Cleric',
      'Druid',
      'Fighter',
      'Monk',
      'Paladin',
      'Ranger',
      'Rogue',
      'Sorcerer',
      'Warlock',
      'Wizard',
    ]);
    await expect(classOptions.locator('svg')).toHaveCount(13);
    const classIconNames = await classOptions.locator('svg').evaluateAll((icons) =>
      icons.map((icon) => icon.getAttribute('class')));
    expect(new Set(classIconNames).size).toBe(13);
    await classOptions.getByRole('button', { name: 'Fighter' }).click();
    const levelDropdown = sheet.getByRole('button', { exact: true, name: 'Level' });
    await levelDropdown.click();
    const levelOptions = sheet.getByRole('group', { name: 'Level options' });
    expect(await levelOptions.getByRole('button').allTextContents())
      .toEqual(Array.from({ length: 20 }, (_, index) => String(index + 1)));
    await expect(levelOptions.locator('svg')).toHaveCount(20);
    const levelIconNames = await levelOptions.locator('svg').evaluateAll((icons) =>
      icons.map((icon) => icon.getAttribute('class')));
    expect(new Set(levelIconNames).size).toBe(4);
    await levelOptions.getByRole('button', { exact: true, name: '7' }).click();
    await expect(sheet.getByLabel('Proficiency Bonus')).toHaveValue('+3');
    const strengthScore = sheet.getByLabel('Strength score');
    await strengthScore.fill('17');
    const strengthScoreMetrics = await strengthScore.evaluate((input) => {
      const view = input.ownerDocument.defaultView;
      const lineHeight = Number.parseFloat(view!.getComputedStyle(input).lineHeight);
      const style = view!.getComputedStyle(input);
      return {
        backgroundColor: style.backgroundColor,
        borderWidth: style.borderWidth,
        clientHeight: input.clientHeight,
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight,
      };
    });
    expect(strengthScoreMetrics.clientHeight).toBeGreaterThan(
      Math.ceil(strengthScoreMetrics.lineHeight),
    );
    expect(strengthScoreMetrics.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(strengthScoreMetrics.borderWidth).toBe('0px');
    expect(strengthModifierMetrics.fontSize).toBeGreaterThan(strengthScoreMetrics.fontSize * 2);
    await strengthScore.blur();
    await expect(strengthModifier).toHaveValue('+3');
    await expect(sheet.getByLabel('Strength saving throw')).toHaveValue('+6');
    await expect(sheet.getByLabel('Athletics bonus and passive score')).toHaveText('+3 / 13');
    await expect(acrobaticsValues).toHaveText('+9 / 19');
    await sheet.getByLabel('Initiative').fill('+5');
    await sheet.getByLabel('Initiative').blur();
    const resourceList = sheet.getByRole('list', { name: 'Character resources' });
    await sheet.getByRole('button', { name: 'Add Resource' }).click();
    const rageName = resourceList.locator('[data-resource-name]').last();
    await expect(rageName).toHaveValue('New Resource');
    await rageName.fill('Rage');
    await rageName.blur();
    await sheet.getByLabel('Rage current').fill('-2');
    await sheet.getByLabel('Rage current').blur();
    await sheet.getByLabel('Rage maximum').fill('3');
    await sheet.getByLabel('Rage maximum').blur();
    const rageCurrent = sheet.getByLabel('Rage current');
    const rageValues = resourceList.locator('[data-resource-values]').first();
    const compactValueBounds = await rageValues.boundingBox();
    expect(compactValueBounds!.width).toBeLessThan(55);
    const shortCurrentBounds = await rageCurrent.boundingBox();
    await rageCurrent.fill('-123456789');
    const longCurrentBounds = await rageCurrent.boundingBox();
    expect(longCurrentBounds!.width).toBeGreaterThan(shortCurrentBounds!.width + 30);
    await rageCurrent.fill('-2');
    await rageCurrent.blur();
    await sheet.getByRole('button', { name: 'Add Resource' }).click();
    const kiName = resourceList.locator('[data-resource-name]').last();
    await kiName.fill('Ki');
    await kiName.blur();
    await sheet.getByLabel('Ki current').fill('5');
    await sheet.getByLabel('Ki current').blur();
    await sheet.getByLabel('Ki maximum').fill('4');
    await sheet.getByLabel('Ki maximum').blur();
    await kiName.click({ button: 'right' });
    const resourceMenu = window.getByRole('menu', { name: 'Ki actions' });
    const resourceMenuBounds = await resourceMenu.boundingBox();
    expect(resourceMenuBounds!.width).toBeLessThan(300);
    expect(resourceMenuBounds!.height).toBeLessThan(250);
    await window.getByRole('menuitem', { name: 'Move Resource Up' }).click();
    await expect.poll(() => resourceList.locator('[data-resource-name]')
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)))
      .toEqual(['Ki', 'Rage']);
    await resourceList.locator('[data-resource-name]').nth(1).click({ button: 'right' });
    await window.getByRole('menuitem', { name: 'Delete Resource' }).click();
    await window.getByRole('menuitem', { name: 'Confirm deletion of Rage' }).click();
    await expect.poll(() => resourceList.locator('[data-resource-name]')
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)))
      .toEqual(['Ki']);
    await sheet.press('Escape');

    const characterRows = window.locator(
      '[data-journal-group-id="dnd5e.characters"]',
    );
    const firstCharacterId = await characterRows.first().getAttribute(
      'data-journal-order-id',
    );
    expect(firstCharacterId).not.toBeNull();

    await expect(window.getByRole('textbox', { name: 'Name for Rowen' })).toHaveValue('Rowen');

    await window.getByRole('button', {
      exact: true,
      name: 'Open Rowen',
    }).click();
    sheet = window.getByRole('dialog', { name: 'Rowen character sheet' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { exact: true, name: 'Class' }))
      .toHaveText('Fighter');
    await expect(sheet.getByRole('button', { exact: true, name: 'Level' })).toHaveText('7');
    await expect(sheet.getByLabel('Strength score')).toHaveValue('17');
    await expect(sheet.getByLabel('Initiative')).toHaveValue('+5');
    await expect(sheet.getByLabel('Current hit points')).toHaveValue('7');
    await expect(sheet.getByLabel('Maximum hit points')).toHaveValue('12');
    await expect(sheet.getByRole('button', { name: 'Success 2' }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByRole('button', { name: 'Failure 1' }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByLabel('Dexterity modifier')).toHaveValue('+3');
    await expect(sheet.getByRole('button', { name: 'Acrobatics training: Expertise' }))
      .toHaveAttribute('data-training', 'expertise');
    await expect(sheet.getByLabel('Acrobatics bonus and passive score')).toHaveText('+9 / 19');
    await expect(sheet.getByLabel('Ki current')).toHaveValue('5');
    await expect(sheet.getByLabel('Ki maximum')).toHaveValue('4');
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
    await window.getByRole('button', { exact: true, name: 'Open Rowen' }).click();
    sheet = window.getByRole('dialog', { name: 'Rowen character sheet' });
    await expect(sheet.getByRole('button', { exact: true, name: 'Class' }))
      .toHaveText('Fighter');
    await expect(sheet.getByRole('button', { exact: true, name: 'Level' })).toHaveText('7');
    await expect(sheet.getByLabel('Strength score')).toHaveValue('17');
    await expect(sheet.getByLabel('Initiative')).toHaveValue('+5');
    await expect(sheet.getByLabel('Current hit points')).toHaveValue('7');
    await expect(sheet.getByLabel('Maximum hit points')).toHaveValue('12');
    await expect(sheet.getByRole('button', { name: 'Success 2' }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByRole('button', { name: 'Failure 1' }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByLabel('Dexterity modifier')).toHaveValue('+3');
    await expect(sheet.getByRole('button', { name: 'Acrobatics training: Expertise' }))
      .toHaveAttribute('data-training', 'expertise');
    await expect(sheet.getByLabel('Acrobatics bonus and passive score')).toHaveText('+9 / 19');
    await expect(sheet.getByLabel('Ki current')).toHaveValue('5');
    await expect(sheet.getByLabel('Ki maximum')).toHaveValue('4');
  });
});
