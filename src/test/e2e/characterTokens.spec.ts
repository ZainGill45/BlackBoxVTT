import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { DEFAULT_TOKEN_ASSET_ID, type SceneRecord, type SceneToken } from '../../shared/scenes';
import { AppFixture, availablePort } from './support/app';
import type { LaunchedApp } from './support/app';
import {
  addPlayer,
  createAndOpenCampaign,
  joinCampaign,
  openTab,
  setHostPort,
} from './support/flows';
import {
  createLargeSceneWithMap,
  dragOnStage,
  importFixture,
  readScene,
  stage,
  stageCentre,
} from './support/stage';

const CAMPAIGN = 'Token Workshop';
const ARTWORK = 'map.png';
const USERNAME = 'Alice';
const PASSWORD = 'token-password';

function characterRow(window: Page): Locator {
  return window.locator('[data-journal-group-id="dnd5e.characters"]').first();
}

function characterSheet(window: Page, name = 'New Character'): Locator {
  return window.getByRole('dialog', { name: `${name} character sheet` });
}

function sceneTokens(scene: SceneRecord): SceneToken[] {
  return Object.values(scene.images)
    .flat()
    .filter((image): image is SceneToken => 'source' in image);
}

async function createCharacter(
  window: Page,
  name = 'New Character',
): Promise<{ entryId: string; sheet: Locator }> {
  await openTab(window, 'Journal');
  await window.getByRole('button', { name: 'Add journal entry' }).click();
  await window.getByRole('menuitem', { name: 'Character' }).click();
  let sheet = characterSheet(window);
  if (name !== 'New Character') {
    const field = sheet.getByRole('textbox', { exact: true, name: 'Name' });
    await field.fill(name);
    await field.blur();
    sheet = characterSheet(window, name);
    await expect(sheet).toHaveAccessibleName(`${name} character sheet`);
  }
  const entryId = await characterRow(window).getAttribute('data-journal-order-id');
  if (!entryId) throw new Error('The Character row has no entry id.');
  return { entryId, sheet };
}

async function chooseTokenArtwork(sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Choose Character Token image' }).click();
  const chooser = sheet.page().getByRole('dialog', {
    name: 'Choose Character Token image',
  });
  await chooser.getByRole('button', { name: ARTWORK }).click();
  await expect(chooser).toBeHidden();
  await expect(
    sheet.getByRole('button', { name: 'Choose Character Token image' }).locator('img'),
  ).toBeVisible();
}

async function removeTokenArtwork(sheet: Locator): Promise<void> {
  await sheet
    .getByRole('button', { name: 'Choose Character Token image' })
    .click({ button: 'right' });
  await sheet.page().getByRole('menuitem', {
    name: 'Remove Character Token Image',
  }).click();
  await expect(
    sheet.getByRole('button', { name: 'Choose Character Token image' }).locator('img'),
  ).toHaveCount(0);
}

async function setTokenType(sheet: Locator, type: 'Linked' | 'Template'): Promise<void> {
  await sheet.getByRole('tab', { name: 'Settings' }).click();
  const trigger = sheet.getByRole('button', { name: 'Token Type' });
  if (await trigger.textContent() === type) return;
  await trigger.click();
  await sheet
    .getByRole('listbox', { name: 'Token Type options' })
    .getByRole('option', { exact: true, name: type })
    .click();
  const confirmation = sheet.page().getByRole('dialog', {
    name: 'Change Token Type?',
  });
  if (await confirmation.isVisible()) {
    await confirmation.getByRole('button', { name: 'Change Token Type' }).click();
    await expect(confirmation).toBeHidden();
  }
  await expect(trigger).toHaveText(type);
}

async function openCharacterRow(window: Page, name: string): Promise<Locator> {
  await openTab(window, 'Journal');
  const group = window.locator('button[aria-expanded]', { hasText: 'Characters' });
  if (await group.getAttribute('aria-expanded') === 'false') await group.click();
  await window.getByRole('button', { exact: true, name: `Open ${name}` }).click();
  const sheet = characterSheet(window, name);
  await expect(sheet).toBeVisible();
  return sheet;
}

async function dropCharacterOnStage(
  window: Page,
  entryId: string,
  target: { x: number; y: number },
): Promise<void> {
  await openTab(window, 'Journal');
  const source = window.locator(`[data-journal-order-id="${entryId}"]`);
  await expect(source).toBeVisible();
  const canvas = stage(window);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('The stage has no layout box.');
  const dataTransfer = await window.evaluateHandle(() => new DataTransfer());
  const event = {
    clientX: box.x + target.x,
    clientY: box.y + target.y,
    dataTransfer,
  };
  try {
    await source.dispatchEvent('dragstart', { dataTransfer });
    await canvas.dispatchEvent('dragenter', event);
    await canvas.dispatchEvent('dragover', event);
    await canvas.dispatchEvent('drop', event);
    await source.dispatchEvent('dragend', { dataTransfer });
  } finally {
    await dataTransfer.dispose();
  }
}

async function findTokenPoint(
  window: Page,
  approximate: { x: number; y: number },
  openLabel: 'Open Character Sheet' | 'Open Source Character',
): Promise<{ x: number; y: number }> {
  const offsets = [0, -10, 10, -20, 20, -30, 30];
  for (const y of offsets) {
    for (const x of offsets) {
      const point = { x: approximate.x + x, y: approximate.y + y };
      await stage(window).click({ button: 'right', position: point });
      const open = window.getByRole('menuitem', { name: openLabel });
      if (await open.isVisible()) {
        await window.keyboard.press('Escape');
        return point;
      }
      await window.keyboard.press('Escape');
    }
  }
  throw new Error(`Could not find the token near ${approximate.x}, ${approximate.y}.`);
}

async function resizeToken(
  window: Page,
  approximate: { x: number; y: number },
  openLabel: 'Open Character Sheet' | 'Open Source Character',
): Promise<{ x: number; y: number }> {
  await window.getByRole('button', { name: 'Select', exact: true }).click();
  const tokenPoint = await findTokenPoint(window, approximate, openLabel);
  const canvas = stage(window);
  await canvas.click({ position: tokenPoint });
  await resizeSelectedToken(window, tokenPoint);
  return tokenPoint;
}

async function resizeSelectedToken(
  window: Page,
  approximate: { x: number; y: number },
  radius = 80,
): Promise<void> {
  const canvas = stage(window);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('The stage has no layout box.');
  const corner = await canvas.evaluate((element, input) => {
    const candidates: Array<{ x: number; y: number }> = [];
    for (let y = -input.radius; y <= input.radius; y += 4) {
      for (let x = -input.radius; x <= input.radius; x += 4) {
        element.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true,
          clientX: input.left + input.point.x + x,
          clientY: input.top + input.point.y + y,
          pointerId: 91,
        }));
        if (
          (element.parentElement as HTMLElement | null)?.style.cursor.endsWith(
            'resize',
          )
        ) {
          candidates.push({ x: input.point.x + x, y: input.point.y + y });
        }
      }
    }
    return candidates.sort((left, right) =>
      right.x + right.y - (left.x + left.y)
    )[0] ?? null;
  }, {
    left: box.x,
    point: approximate,
    radius,
    top: box.y,
  });
  if (!corner) throw new Error('The selected token did not expose a resize handle.');
  await window.keyboard.down('Alt');
  await dragOnStage(window, corner, {
    x: corner.x + 55,
    y: corner.y + 55,
  });
  await window.keyboard.up('Alt');
}

async function openTokenContext(
  window: Page,
  approximate: { x: number; y: number },
  openLabel: 'Open Character Sheet' | 'Open Source Character',
): Promise<void> {
  const point = await findTokenPoint(window, approximate, openLabel);
  await stage(window).click({ button: 'right', position: point });
}

async function grantCharacterEdit(window: Page, username: string): Promise<void> {
  await openTab(window, 'Journal');
  await window
    .getByRole('button', { exact: true, name: 'Open New Character' })
    .click({ button: 'right' });
  await window.getByRole('menuitem', { name: 'Edit Permissions' }).click();
  const permissions = window.getByRole('dialog', { name: 'Edit Permissions' });
  await permissions.getByRole('button', { name: `${username} permission` }).click();
  await permissions
    .getByRole('listbox', { name: `${username} permission options` })
    .getByRole('option', { exact: true, name: 'Edit' })
    .click();
  await permissions.press('Escape');
  await expect(permissions).toBeHidden();
}

test.describe('Character token workflows', () => {
  const apps = new AppFixture();
  let gm: LaunchedApp;

  test.beforeEach(async () => {
    gm = await apps.launch();
    await createAndOpenCampaign(gm.window, CAMPAIGN);
    await importFixture(gm.app, gm.window, ARTWORK);
    await createLargeSceneWithMap(gm.window, CAMPAIGN);
    await gm.window.waitForTimeout(800);
  });

  test.afterEach(() => apps.disposeAll());

  test('keeps the selected Token Inspector interactive and visually compact', async () => {
    const { entryId, sheet } = await createCharacter(gm.window, 'Vela');
    const maximumHitPoints = sheet.getByLabel('Maximum hit points');
    await maximumHitPoints.fill('24');
    await maximumHitPoints.blur();
    const currentHitPoints = sheet.getByLabel('Current hit points');
    await currentHitPoints.fill('24');
    await currentHitPoints.blur();
    await sheet.press('Escape');
    const centre = await stageCentre(gm.window);
    await dropCharacterOnStage(gm.window, entryId, centre);
    await expect.poll(async () => sceneTokens(await readScene(gm.window, CAMPAIGN)).length)
      .toBe(1);
    const tokenPoint = await findTokenPoint(
      gm.window,
      centre,
      'Open Character Sheet',
    );
    await stage(gm.window).click({ position: tokenPoint });

    const inspector = gm.window.getByRole('complementary', {
      name: 'Token Inspector',
    });
    await expect(inspector).toBeVisible();
    const border = await inspector.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.borderTopColor,
        style: style.borderTopStyle,
        width: style.borderTopWidth,
      };
    });
    expect(border.style).toBe('solid');
    expect(border.width).not.toBe('0px');
    expect(border.color).not.toBe('rgba(0, 0, 0, 0)');

    const health = inspector.getByRole('listitem').filter({ hasText: 'Health' });
    const healthCurrent = inspector.getByRole('textbox', {
      name: 'Health current',
    });
    await expect(healthCurrent).toHaveValue('24');
    await healthCurrent.click();
    await healthCurrent.pressSequentially('24-5');
    await healthCurrent.press('Enter');
    await expect(healthCurrent).toHaveValue('19');
    await gm.window.waitForTimeout(500);
    await expect(healthCurrent).toHaveValue('19');
    await expect(inspector.getByRole('textbox', {
      name: 'Health maximum',
    })).toHaveValue('24');

    const labelSize = await health.getByText('Health').evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
    const valueSize = await healthCurrent.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(valueSize).toBeGreaterThanOrEqual(labelSize);

    const search = inspector.getByRole('searchbox', {
      name: 'Search inspector fields',
    });
    await search.click();
    await search.fill('armor');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByText('Armor Class')).toBeVisible();
    await expect(inspector.getByText('Health')).toHaveCount(0);

    await search.fill('');
    await inspector.getByRole('button', { name: 'Add inspector field' }).click();
    await gm.window.getByRole('menuitem', { name: 'Initiative' }).click();
    await inspector.getByRole('button', { name: 'Roll Initiative' }).click();
    await gm.window.getByRole('tab', { name: 'Chat' }).click();
    await expect(gm.window.getByRole('log', { name: 'Campaign chat' })
      .getByText('Initiative', { exact: true }).first()).toBeVisible();
  });

  test('keeps Linked artwork and a saved default size synchronized', async () => {
    const { entryId, sheet } = await createCharacter(gm.window, 'Aster');
    await chooseTokenArtwork(sheet);
    await sheet.press('Escape');

    const centre = await stageCentre(gm.window);
    const firstTarget = {
      x: centre.x - 120,
      y: centre.y,
    };
    await dropCharacterOnStage(gm.window, entryId, firstTarget);
    await dropCharacterOnStage(gm.window, entryId, {
      x: centre.x + 120,
      y: centre.y,
    });
    await expect.poll(async () => sceneTokens(await readScene(gm.window, CAMPAIGN)).length)
      .toBe(2);
    let scene = await readScene(gm.window, CAMPAIGN);
    let tokens = sceneTokens(scene);
    expect(tokens.map(({ source }) => source.kind)).toEqual(['linked', 'linked']);
    expect(new Set(tokens.map(({ assetId }) => assetId)).size).toBe(1);
    expect(tokens[0].assetId).not.toBe(DEFAULT_TOKEN_ASSET_ID);

    const firstCentre = await findTokenPoint(
      gm.window,
      firstTarget,
      'Open Character Sheet',
    );
    await stage(gm.window).dblclick({ position: firstCentre });
    await expect(characterSheet(gm.window, 'Aster')).toBeVisible();
    await characterSheet(gm.window, 'Aster').press('Escape');

    const originalWidth = tokens[0].width;
    await resizeToken(gm.window, firstTarget, 'Open Character Sheet');
    await expect.poll(async () => sceneTokens(await readScene(gm.window, CAMPAIGN))[0].width)
      .toBeGreaterThan(originalWidth);
    scene = await readScene(gm.window, CAMPAIGN);
    tokens = sceneTokens(scene);
    await openTokenContext(gm.window, firstTarget, 'Open Character Sheet');
    await gm.window.getByRole('menuitem', { name: 'Save as Default Size' }).click();
    const saved = gm.window.getByRole('dialog', { name: 'Character Token' });
    await expect(saved).toContainText('Saved the default size');
    await saved.press('Escape');
    await expect.poll(async () => {
      const current = sceneTokens(await readScene(gm.window, CAMPAIGN));
      return current.length === 2 && current[0].width === current[1].width;
    }).toBe(true);

    const withArtwork = await stage(gm.window).screenshot();
    const reopened = await openCharacterRow(gm.window, 'Aster');
    await removeTokenArtwork(reopened);
    await expect.poll(async () =>
      sceneTokens(await readScene(gm.window, CAMPAIGN)).map(({ assetId }) => assetId),
    ).toEqual([DEFAULT_TOKEN_ASSET_ID, DEFAULT_TOKEN_ASSET_ID]);
    await reopened.press('Escape');
    await expect.poll(async () =>
      Buffer.compare(withArtwork, await stage(gm.window).screenshot()),
    ).not.toBe(0);
  });

  test('lets an editing player place and transform a Linked token without scene edit', async () => {
    const port = await availablePort();
    await addPlayer(gm.window, USERNAME, PASSWORD);
    await setHostPort(gm.window, port);
    const { entryId, sheet } = await createCharacter(gm.window);
    const maximumHitPoints = sheet.getByLabel('Maximum hit points');
    await maximumHitPoints.fill('24');
    await maximumHitPoints.blur();
    const currentHitPoints = sheet.getByLabel('Current hit points');
    await currentHitPoints.fill('24');
    await currentHitPoints.blur();
    await sheet.press('Escape');
    await grantCharacterEdit(gm.window, USERNAME);
    await openTab(gm.window, 'Scenes');
    await gm.window.getByRole('button', { name: 'Present New Scene' }).click();

    const player = await apps.launch();
    await joinCampaign(player.window, {
      campaign: CAMPAIGN,
      password: PASSWORD,
      port,
      username: USERNAME,
    });
    await expect(stage(player.window)).toBeVisible();
    await player.window.waitForTimeout(800);

    const playerSheet = await openCharacterRow(player.window, 'New Character');
    await playerSheet.getByRole('tab', { name: 'Settings' }).click();
    await expect(playerSheet.getByRole('button', { name: 'Token Type' })).toBeDisabled();
    await expect(playerSheet.getByLabel('Token Width')).not.toHaveAttribute('readonly');
    await playerSheet.press('Escape');

    const target = await stageCentre(player.window);
    await dropCharacterOnStage(player.window, entryId, target);
    await expect.poll(async () => sceneTokens(await readScene(gm.window, CAMPAIGN)).length)
      .toBe(1);
    let scene = await readScene(gm.window, CAMPAIGN);
    let token = sceneTokens(scene)[0];
    const start = await findTokenPoint(
      player.window,
      target,
      'Open Character Sheet',
    );
    await stage(player.window).click({ position: start });
    const inspector = player.window.getByRole('complementary', {
      name: 'Token Inspector',
    });
    const healthCurrent = inspector.getByRole('textbox', {
      name: 'Health current',
    });
    await expect(healthCurrent).toHaveValue('24');
    await healthCurrent.click();
    await healthCurrent.pressSequentially('-5');
    await healthCurrent.press('Enter');
    await expect(healthCurrent).toHaveValue('19');
    await player.window.waitForTimeout(500);
    await expect(healthCurrent).toHaveValue('19');

    const movedTarget = { x: start.x + 90, y: start.y + 40 };
    await player.window.keyboard.down('Alt');
    await dragOnStage(player.window, start, movedTarget);
    await player.window.keyboard.up('Alt');
    await expect.poll(async () => sceneTokens(await readScene(gm.window, CAMPAIGN))[0].x)
      .not.toBe(token.x);

    scene = await readScene(gm.window, CAMPAIGN);
    token = sceneTokens(scene)[0];
    const originalWidth = token.width;
    await resizeSelectedToken(player.window, movedTarget, 180);
    await expect.poll(async () => sceneTokens(await readScene(gm.window, CAMPAIGN))[0].width)
      .toBeGreaterThan(originalWidth);
    await player.window.keyboard.press('Enter');
    await expect(characterSheet(player.window)).toBeVisible();
  });

  test('keeps Template placements independent and converts every descendant in place', async () => {
    const { entryId, sheet } = await createCharacter(gm.window, 'Morrow');
    await chooseTokenArtwork(sheet);
    await setTokenType(sheet, 'Template');
    await sheet.press('Escape');

    const centre = await stageCentre(gm.window);
    await dropCharacterOnStage(gm.window, entryId, {
      x: centre.x - 120,
      y: centre.y,
    });
    await dropCharacterOnStage(gm.window, entryId, {
      x: centre.x + 120,
      y: centre.y,
    });
    await expect.poll(async () => sceneTokens(await readScene(gm.window, CAMPAIGN)).length)
      .toBe(2);
    let scene = await readScene(gm.window, CAMPAIGN);
    let tokens = sceneTokens(scene);
    expect(tokens.every(({ source }) => source.kind === 'template')).toBe(true);
    const originalArtwork = tokens[0].assetId;
    expect(originalArtwork).not.toBe(DEFAULT_TOKEN_ASSET_ID);
    expect(new Set(tokens.map(({ source }) =>
      source.kind === 'template' ? source.instanceId : null,
    )).size).toBe(2);

    const root = await openCharacterRow(gm.window, 'Morrow');
    await removeTokenArtwork(root);
    await root.press('Escape');
    await expect.poll(async () =>
      sceneTokens(await readScene(gm.window, CAMPAIGN)).map(({ assetId }) => assetId),
    ).toEqual([originalArtwork, originalArtwork]);

    scene = await readScene(gm.window, CAMPAIGN);
    tokens = sceneTokens(scene);
    const secondCentre = await findTokenPoint(gm.window, {
      x: centre.x + 120,
      y: centre.y,
    }, 'Open Source Character');
    await stage(gm.window).click({ position: secondCentre });
    await gm.window.keyboard.press('Control+d');
    await expect.poll(async () => sceneTokens(await readScene(gm.window, CAMPAIGN)).length)
      .toBe(3);
    scene = await readScene(gm.window, CAMPAIGN);
    tokens = sceneTokens(scene);
    const stableIds = tokens.map(({ id }) => id).sort();
    expect(new Set(tokens.map(({ source }) =>
      source.kind === 'template' ? source.instanceId : null,
    )).size).toBe(3);

    const settings = await openCharacterRow(gm.window, 'Morrow');
    await setTokenType(settings, 'Linked');
    await expect.poll(async () => {
      const current = sceneTokens(await readScene(gm.window, CAMPAIGN));
      return current.length === 3 && current.every(({ source }) => source.kind === 'linked');
    }).toBe(true);
    scene = await readScene(gm.window, CAMPAIGN);
    tokens = sceneTokens(scene);
    expect(tokens.map(({ id }) => id).sort()).toEqual(stableIds);
    expect(tokens.every(({ assetId }) => assetId === DEFAULT_TOKEN_ASSET_ID)).toBe(true);

    await setTokenType(settings, 'Template');
    await expect.poll(async () => {
      const current = sceneTokens(await readScene(gm.window, CAMPAIGN));
      return current.length === 3 && current.every(({ source }) => source.kind === 'template');
    }).toBe(true);
    tokens = sceneTokens(await readScene(gm.window, CAMPAIGN));
    expect(tokens.map(({ id }) => id).sort()).toEqual(stableIds);
    expect(new Set(tokens.map(({ source }) =>
      source.kind === 'template' ? source.instanceId : null,
    )).size).toBe(3);
  });

  test('can retain orphaned Templates while disabling source-dependent actions', async () => {
    const { entryId, sheet } = await createCharacter(gm.window, 'Echo');
    await setTokenType(sheet, 'Template');
    await sheet.press('Escape');
    const target = await stageCentre(gm.window);
    await dropCharacterOnStage(gm.window, entryId, target);
    await expect.poll(async () => sceneTokens(await readScene(gm.window, CAMPAIGN)).length)
      .toBe(1);
    const beforeDelete = await readScene(gm.window, CAMPAIGN);
    const token = sceneTokens(beforeDelete)[0];

    await openTab(gm.window, 'Journal');
    const remove = gm.window.getByRole('button', { name: 'Delete Echo' });
    await remove.click();
    await gm.window.getByRole('button', { name: 'Confirm deletion of Echo' }).click();
    const confirmation = gm.window.getByRole('dialog', {
      name: 'Delete entry and dependencies?',
    });
    const deleteTemplates = confirmation.getByRole('checkbox', {
      name: 'Also delete 1 Template token from scenes',
    });
    await expect(deleteTemplates).not.toBeChecked();
    await confirmation.getByRole('button', { exact: true, name: 'Delete' }).click();
    await expect(gm.window.getByRole('button', { name: 'Open Echo' })).toHaveCount(0);
    await expect.poll(async () => sceneTokens(await readScene(gm.window, CAMPAIGN)).length)
      .toBe(1);

    const orphanScene = await readScene(gm.window, CAMPAIGN);
    expect(sceneTokens(orphanScene)[0].id).toBe(token.id);
    await openTokenContext(gm.window, target, 'Open Source Character');
    await expect(gm.window.getByRole('menuitem', { name: 'Apply Default Size' }))
      .toBeDisabled();
    await expect(gm.window.getByRole('menuitem', { name: 'Save as Default Size' }))
      .toBeDisabled();
    await gm.window.getByRole('menuitem', { name: 'Open Source Character' }).click();
    const error = gm.window.getByRole('dialog', { name: 'Character Token' });
    await expect(error).toContainText(
      'The source Character no longer exists or cannot be opened.',
    );
  });
});
