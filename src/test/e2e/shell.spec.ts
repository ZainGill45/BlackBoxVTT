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
});

test.describe('local Journal durability', () => {
  const apps = new AppFixture();

  test.afterEach(() => apps.disposeAll());

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
    await deleteNote.click();
    const confirmDeleteNote = window.getByRole('button', {
      name: 'Confirm deletion of Campaign Chronicle',
    });
    await expect(confirmDeleteNote).toHaveAttribute('aria-pressed', 'true');
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
    const tabList = sheet.getByRole('tablist', { name: 'Character sheet sections' });
    await expect(tabList.getByRole('tab')).toHaveCount(3);
    await expect(tabList.getByRole('tab', { name: 'Home' }))
      .toHaveAttribute('aria-selected', 'true');
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
    for (const label of headerFieldLabels) {
      await expect(sheet.getByRole(
        dropdownFieldLabels.has(label) ? 'button' : 'textbox',
        { exact: true, name: label },
      )).toHaveAttribute('title', headerFieldTitles[label]);
    }
    const nameInput = sheet.getByRole('textbox', { exact: true, name: 'Name' });
    await expect(nameInput).toHaveValue('New Character');
    await expect(nameInput).toHaveAttribute('placeholder', 'Name');
    const subclassInput = sheet.getByRole('textbox', { exact: true, name: 'Subclass' });
    await expect(subclassInput).toHaveAttribute('placeholder', 'Subclass');
    const emptyClassDropdown = sheet.getByRole('button', { exact: true, name: 'Class' });
    const importantStatDefaults = [
      ['Initiative', '0'],
      ['Armor Class', '10'],
      ['Current Speed', '30'],
      ['Concentration Save', '0'],
      ['Proficiency Bonus', '+2'],
      ['Inspiration Count', '0'],
    ] as const;
    for (const [label, defaultValue] of importantStatDefaults) {
      await expect(sheet.getByLabel(label)).toHaveValue(defaultValue);
    }
    const skillsPanel = sheet.getByRole('heading', { name: 'Skills' }).locator('..');
    const skillTrainingControls = skillsPanel.locator('button[data-training]');
    await expect(skillTrainingControls).toHaveCount(18);
    expect(await skillTrainingControls.evaluateAll((controls) =>
      controls.map((control) => control.getAttribute('aria-label')),
    )).toEqual(DND5E_SKILLS.map(({ label }) => `${label} training: Untrained`));
    for (const skill of DND5E_SKILLS) {
      const output = skillsPanel.getByLabel(`${skill.label} bonus and passive score`);
      await expect(output).toHaveText('0 / 10');
      const row = output.locator('..');
      await expect(row.getByText(skill.abbreviation, { exact: true })).toBeVisible();
    }
    const addCustomSkill = skillsPanel.getByRole('button', { name: 'Add Custom Skill' });
    await expect(addCustomSkill).toBeEnabled();
    const healthPanel = sheet.getByRole('heading', { name: 'Health', exact: true }).locator('..');
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
    const panelAddButtons = [
      'Add Action',
      'Add Item',
      'Add Container',
      'Add Resource',
      'Add Feature',
    ].map((name) => sheet.getByRole('button', { name }));
    for (const button of panelAddButtons) {
      await expect(button).toBeEnabled();
    }
    const abilityNames = [
      'Strength',
      'Dexterity',
      'Constitution',
      'Intelligence',
      'Wisdom',
      'Charisma',
    ] as const;
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
    await classOptions.getByRole('button', { name: 'Fighter' }).click();
    const levelDropdown = sheet.getByRole('button', { exact: true, name: 'Level' });
    await levelDropdown.click();
    const levelOptions = sheet.getByRole('group', { name: 'Level options' });
    expect(await levelOptions.getByRole('button').allTextContents())
      .toEqual(Array.from({ length: 20 }, (_, index) => String(index + 1)));
    await levelOptions.getByRole('button', { exact: true, name: '7' }).click();
    await expect(sheet.getByLabel('Proficiency Bonus')).toHaveValue('+3');
    const strengthScore = sheet.getByLabel('Strength score');
    await strengthScore.fill('17');
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
    await rageCurrent.fill('-123456789');
    await expect(rageCurrent).toHaveValue('-123456789');
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
    await expect(window.getByRole('menu', { name: 'Ki actions' })).toBeVisible();
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
