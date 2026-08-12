import { expect, test } from '@playwright/test';
import { AppFixture, availablePort } from './support/app';
import {
  addPlayer,
  chatLog,
  createAndOpenCampaign,
  joinCampaign,
  openTab,
  setHostPort,
} from './support/flows';

const CAMPAIGN = 'Calculated Company';
const USERNAME = 'Alice';
const PASSWORD = 'character-password';

test.describe('networked D&D character sheets', () => {
  const apps = new AppFixture();

  test.afterEach(() => apps.disposeAll());

  test('synchronizes derived values and preserved offsets to a remote viewer', async () => {
    const gm = await apps.launch();
    const player = await apps.launch();
    const port = await availablePort();
    await createAndOpenCampaign(gm.window, CAMPAIGN);
    await addPlayer(gm.window, USERNAME, PASSWORD);
    await setHostPort(gm.window, port);
    await joinCampaign(player.window, {
      campaign: CAMPAIGN,
      password: PASSWORD,
      port,
      username: USERNAME,
    });

    await openTab(gm.window, 'Journal');
    await gm.window.getByRole('button', { name: 'Add journal entry' }).click();
    await gm.window.getByRole('menuitem', { name: 'Character' }).click();
    let gmSheet = gm.window.getByRole('dialog', {
      name: 'New Character character sheet',
    });
    await gmSheet.getByRole('button', { exact: true, name: 'Class' }).click();
    await gmSheet.getByRole('group', { name: 'Class options' })
      .getByRole('button', { name: 'Fighter' })
      .click();
    await gmSheet.getByRole('button', { exact: true, name: 'Level' }).click();
    await gmSheet.getByRole('group', { name: 'Level options' })
      .getByRole('button', { exact: true, name: '5' })
      .click();
    await gmSheet.getByLabel('Strength score').fill('12');
    await gmSheet.getByLabel('Strength score').blur();
    await gmSheet.getByLabel('Strength modifier').fill('+3');
    await gmSheet.getByLabel('Strength modifier').blur();
    await gmSheet.getByRole('button', { name: 'Add Custom Skill' }).click();
    await gmSheet.getByLabel('New Skill name').fill('Tactics');
    await gmSheet.getByLabel('Tactics name').blur();
    await gmSheet.getByRole('button', { name: 'Tactics ability' }).click();
    await gmSheet.getByRole('button', { name: 'STR — Strength' }).click();
    await gmSheet.getByRole('button', { name: 'Tactics training: Untrained' }).click();
    await gmSheet.getByLabel('Tactics bonus').fill('+7');
    await gmSheet.getByLabel('Tactics bonus').blur();
    await gmSheet.getByLabel('Tactics passive score').fill('19');
    await gmSheet.getByLabel('Tactics passive score').blur();
    await gmSheet.getByRole('button', { name: 'Add Resource' }).click();
    const resourceName = gmSheet.getByRole('list', { name: 'Character resources' })
      .locator('[data-resource-name]');
    await resourceName.fill('Superiority Dice');
    await resourceName.blur();
    await gmSheet.getByLabel('Superiority Dice current').fill('-1');
    await gmSheet.getByLabel('Superiority Dice current').blur();
    await gmSheet.getByLabel('Superiority Dice maximum').fill('4');
    await gmSheet.getByLabel('Superiority Dice maximum').blur();
    await gmSheet.getByRole('button', { name: 'Add Feature' }).click();
    await gmSheet.getByLabel('New Feature name').fill('Action Surge');
    await gmSheet.getByLabel('Action Surge name').blur();
    await gmSheet.getByRole('button', { name: 'Action Surge type' }).click();
    await gmSheet.getByRole('group', { name: 'Action Surge type options' })
      .getByRole('button', { name: 'Feature' })
      .click();
    const actionSurgeSource = gmSheet.getByLabel('Action Surge source', {
      exact: true,
    });
    await actionSurgeSource.fill('Class');
    await actionSurgeSource.blur();
    await gmSheet.getByLabel('Action Surge source type').fill('Fighter');
    await gmSheet.getByLabel('Action Surge source type').blur();
    const actionSurgeDescription = gmSheet.getByLabel('Action Surge description');
    await actionSurgeDescription.fill('Take one additional action.\nOnce per rest.');
    await actionSurgeDescription.blur();

    await gmSheet.getByRole('button', { name: 'Add Item' }).click();
    await expect(gmSheet.getByLabel('New Item name')).toBeVisible();
    await expect(gmSheet.getByLabel('New Item quantity')).toHaveValue('1');
    await gmSheet.getByRole('button', { name: 'Add Container' }).click();
    await gmSheet.getByLabel('New Container name').fill('Backpack');
    await gmSheet.getByLabel('Backpack name').blur();
    await expect(gmSheet.getByLabel('Backpack capacity usage')).toHaveText('0');
    await gmSheet.getByLabel('Backpack weight in pounds').fill('3');
    await gmSheet.getByLabel('Backpack weight in pounds').blur();
    await gmSheet.getByLabel('Backpack capacity in pounds').fill('30');
    await gmSheet.getByLabel('Backpack capacity in pounds').blur();
    const gmBackpack = gmSheet.getByRole('group', { name: 'Backpack contents' });
    await gmBackpack.getByRole('button', { name: 'Add Item' }).click();
    await gmBackpack.getByLabel('New Item name').fill('Rations');
    await gmBackpack.getByLabel('Rations name').blur();
    await gmBackpack.getByLabel('Rations quantity').fill('2');
    await gmBackpack.getByLabel('Rations quantity').blur();
    await gmBackpack.getByLabel('Rations weight in pounds').fill('2.25');
    await gmBackpack.getByLabel('Rations weight in pounds').blur();
    await gmBackpack.getByRole('button', { name: 'Add Item' }).click();
    await gmBackpack.getByLabel('New Item name').fill('Torch');
    await gmBackpack.getByLabel('Torch name').blur();
    await gmBackpack.getByLabel('Torch name').click({ button: 'right' });
    await expect(gm.window.getByRole('menu', { name: 'Torch actions' })).toBeVisible();
    await gm.window.getByRole('menuitem', { name: 'Delete Item' }).click();
    await gm.window.getByRole('menuitem', { name: 'Confirm deletion of Torch' }).click();
    await expect(gmBackpack.getByLabel('Torch name')).toHaveCount(0);
    await expect(gmSheet.getByLabel('Backpack name')).toBeVisible();
    await gmSheet.getByLabel('Copper').fill('50');
    await gmSheet.getByLabel('Copper').blur();
    await gmSheet.getByRole('tab', { name: 'Settings' }).click();
    await gmSheet.getByText('Use Variant Encumbrance', { exact: true }).click();
    await gmSheet.getByRole('tab', { name: 'Home' }).click();
    await expect(gmSheet.getByLabel('L Encumbered weight', { exact: true })).toHaveText('60');
    await expect(gmSheet.getByLabel('H Encumbered weight', { exact: true }))
      .toHaveText('120');
    await expect(gmSheet.getByLabel('Capacity weight', { exact: true })).toHaveCount(0);
    await expect(gmSheet.getByLabel('Carrying Capacity weight', { exact: true }))
      .toHaveCount(0);
    const gmInventoryPanel = gmSheet.getByRole('heading', { name: 'Inventory' }).locator('..');
    expect(await gmInventoryPanel.evaluate((panel) => panel.scrollWidth <= panel.clientWidth))
      .toBe(true);
    await gmSheet.getByRole('button', { name: 'Collapse Backpack' }).click();
    await expect(gmSheet.getByRole('button', { name: 'Expand Backpack' }))
      .toHaveAttribute('aria-expanded', 'false');

    await gmSheet.getByRole('button', { name: 'Add Feature' }).click();
    await gmSheet.getByLabel('New Feature name').fill('Darkvision');
    await gmSheet.getByLabel('Darkvision name').blur();
    await gmSheet.getByRole('button', { name: 'Darkvision type' }).click();
    await gmSheet.getByRole('group', { name: 'Darkvision type options' })
      .getByRole('button', { name: 'Trait' })
      .click();
    await gmSheet.getByRole('button', { exact: true, name: 'Darkvision' })
      .click({ button: 'right' });
    await gm.window.getByRole('menuitem', { name: 'Move Feature Up' }).click();

    await gmSheet.getByRole('button', { name: 'Add Feature' }).click();
    await gmSheet.getByLabel('New Feature name').fill('Delete Me');
    await gmSheet.getByLabel('Delete Me name').blur();
    await gmSheet.getByRole('button', { exact: true, name: 'Delete Me' })
      .click({ button: 'right' });
    await gm.window.getByRole('menuitem', { name: 'Delete Feature' }).click();
    await gm.window.getByRole('menuitem', { name: 'Confirm deletion of Delete Me' }).click();
    await expect(gmSheet.getByRole('button', { exact: true, name: 'Delete Me' }))
      .toHaveCount(0);
    await gmSheet.getByRole('button', { name: 'Add Action' }).click();
    let actionEditor = gm.window.getByRole('dialog', { name: 'New Action action editor' });
    await actionEditor.getByRole('textbox', { name: 'Action Name' }).fill('Network Strike');
    actionEditor = gm.window.getByRole('dialog', { name: 'Network Strike action editor' });
    await actionEditor.getByRole('textbox', { name: 'Action Name' }).blur();
    await actionEditor.getByRole('button', { name: 'Add Step' }).click();
    await gm.window.mouse.click(2, 2);
    await expect(actionEditor).not.toBeVisible();
    const useNetworkStrike = gmSheet.getByRole('button', { name: 'Use Network Strike' });
    await expect(useNetworkStrike).toBeEnabled();
    const editNetworkStrike = gmSheet.getByRole('button', { name: 'Edit Network Strike' });
    await expect(editNetworkStrike).toBeVisible();
    await useNetworkStrike.click({ button: 'right' });
    const actionMenu = gm.window.getByRole('menu', { name: 'Network Strike actions' });
    await expect(actionMenu.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0);
    await actionMenu.press('Escape');
    await editNetworkStrike.click();
    actionEditor = gm.window.getByRole('dialog', { name: 'Network Strike action editor' });
    await expect(actionEditor).toBeVisible();
    await gm.window.mouse.click(2, 2);
    await expect(actionEditor).not.toBeVisible();
    await gmSheet.press('Escape');
    await expect(gmSheet).not.toBeVisible();

    const gmRow = gm.window.getByRole('button', {
      exact: true,
      name: 'Open New Character',
    });
    await gmRow.click({ button: 'right' });
    await gm.window.getByRole('menuitem', { name: 'Edit Permissions' }).click();
    const permissions = gm.window.getByRole('dialog', { name: 'Edit Permissions' });
    await permissions.getByRole('button', { name: `${USERNAME} permission` }).click();
    await permissions
      .getByRole('group', { name: `${USERNAME} permission options` })
      .getByRole('button', { exact: true, name: 'View' })
      .click();
    // The choice is the save, so closing is all that is left to do.
    await permissions.press('Escape');
    await expect(permissions).not.toBeVisible();

    await openTab(player.window, 'Journal');
    await player.window.locator('button[aria-expanded]', { hasText: 'Characters' }).click();
    await player.window.getByRole('button', {
      exact: true,
      name: 'Open New Character',
    }).click();
    let playerSheet = player.window.getByRole('dialog', {
      name: 'New Character character sheet',
    });
    await expect(playerSheet.getByLabel('Strength score')).toHaveValue('12');
    await expect(playerSheet.getByLabel('Strength score')).toHaveAttribute('readonly', '');
    await expect(playerSheet.getByLabel('Proficiency Bonus')).toHaveValue('+3');
    await expect(playerSheet.getByLabel('Strength modifier')).toHaveValue('+3');
    await expect(playerSheet.getByLabel('Strength saving throw')).toHaveValue('+6');
    await expect(playerSheet.getByLabel('Athletics bonus')).toHaveValue('+3');
    await expect(playerSheet.getByLabel('Athletics bonus')).toHaveAttribute('readonly', '');
    await expect(playerSheet.getByLabel('Athletics passive score')).toHaveValue('13');
    await expect(playerSheet.getByLabel('Athletics passive score')).toHaveAttribute('readonly', '');
    await expect(playerSheet.getByLabel('Tactics name')).toHaveAttribute('readonly', '');
    await expect(playerSheet.getByRole('button', { name: 'Tactics ability' }))
      .toHaveAttribute('aria-disabled', 'true');
    await expect(playerSheet.getByRole('button', { name: 'Tactics training: Proficient' }))
      .toBeDisabled();
    await expect(playerSheet.getByLabel('Tactics bonus')).toHaveValue('+7');
    await expect(playerSheet.getByLabel('Tactics bonus')).toHaveAttribute('readonly', '');
    await expect(playerSheet.getByLabel('Tactics passive score')).toHaveValue('19');
    await expect(playerSheet.getByLabel('Tactics passive score')).toHaveAttribute('readonly', '');
    await expect(playerSheet.getByLabel('Superiority Dice name')).toHaveAttribute('readonly', '');
    await expect(playerSheet.getByLabel('Superiority Dice current')).toHaveValue('-1');
    await expect(playerSheet.getByLabel('Superiority Dice maximum')).toHaveValue('4');
    await expect(playerSheet.getByLabel('Copper')).toHaveValue('50');
    await expect(playerSheet.getByLabel('Current weight')).toHaveText('8.5');
    await expect(playerSheet.getByLabel('New Item name')).toHaveAttribute('readonly', '');
    await expect(playerSheet.getByLabel('New Item quantity')).toHaveAttribute('readonly', '');
    await expect(playerSheet.getByLabel('Backpack name')).toHaveAttribute('readonly', '');
    await expect(playerSheet.getByLabel('Backpack capacity usage')).toHaveText('4.5/30');
    await expect(playerSheet.getByLabel('L Encumbered weight', { exact: true })).toHaveText('60');
    await expect(playerSheet.getByLabel('H Encumbered weight', { exact: true }))
      .toHaveText('120');
    await expect(playerSheet.getByLabel('Capacity weight', { exact: true })).toHaveCount(0);
    await expect(playerSheet.getByLabel('Carrying Capacity weight', { exact: true }))
      .toHaveCount(0);
    await expect(playerSheet.getByRole('button', { name: 'Expand Backpack' })).toBeDisabled();
    await expect(playerSheet.getByLabel('Rations name')).toHaveCount(0);
    const playerFeatures = playerSheet.getByRole('list', { name: 'Character features' })
      .locator('button[aria-expanded]');
    await expect(playerFeatures).toHaveText(['Darkvision', 'Action Surge']);
    await expect(playerSheet.getByRole('button', { exact: true, name: 'Action Surge' }))
      .toHaveAttribute('aria-expanded', 'false');
    await playerSheet.getByRole('button', { exact: true, name: 'Action Surge' }).click();
    await expect(playerSheet.getByLabel('Action Surge name')).toHaveAttribute('readonly', '');
    await expect(playerSheet.getByRole('button', { name: 'Action Surge type' }))
      .toHaveText('Feature');
    await expect(playerSheet.getByLabel('Action Surge source', { exact: true }))
      .toHaveValue('Class');
    await expect(playerSheet.getByLabel('Action Surge source type')).toHaveValue('Fighter');
    await expect(playerSheet.getByLabel('Action Surge description'))
      .toHaveValue('Take one additional action.\nOnce per rest.');
    await expect(playerSheet.getByRole('button', { name: 'Use Network Strike' })).toBeEnabled();
    await expect(playerSheet.getByRole('button', { name: 'Edit Network Strike' })).toHaveCount(0);
    await playerSheet.getByRole('button', { name: 'Use Network Strike' }).click();
    await expect(playerSheet).toBeVisible();
    await playerSheet.press('Escape');
    await openTab(player.window, 'Chat');
    await openTab(gm.window, 'Chat');
    await expect(chatLog(player.window).getByRole('heading', { name: 'Network Strike' }))
      .toHaveCount(1);
    await expect(chatLog(gm.window).getByRole('heading', { name: 'Network Strike' }))
      .toHaveCount(1);
    await openTab(player.window, 'Journal');
    await openTab(gm.window, 'Journal');
    await player.window.locator('button[aria-expanded]', { hasText: 'Characters' }).click();
    await gm.window.locator('button[aria-expanded]', { hasText: 'Characters' }).click();
    await player.window.getByRole('button', {
      exact: true,
      name: 'Open New Character',
    }).click();
    playerSheet = player.window.getByRole('dialog', {
      name: 'New Character character sheet',
    });

    await gmRow.click();
    gmSheet = gm.window.getByRole('dialog', {
      name: 'New Character character sheet',
    });
    const gmFeatures = gmSheet.getByRole('list', { name: 'Character features' })
      .locator('button[aria-expanded]');
    await expect(gmFeatures).toHaveText(['Darkvision', 'Action Surge']);
    await expect(gmSheet.getByRole('button', { exact: true, name: 'Action Surge' }))
      .toHaveAttribute('aria-expanded', 'false');
    await gmSheet.getByRole('button', { exact: true, name: 'Action Surge' }).click();
    await gmSheet.getByRole('button', { name: 'Expand Backpack' }).click();
    await gmSheet.getByLabel('Rations weight in pounds').fill('5.55');
    await gmSheet.getByLabel('Rations weight in pounds').blur();
    await gmSheet.getByLabel('Strength score').fill('14');
    await gmSheet.getByLabel('Strength score').blur();
    await gmSheet.getByLabel('Athletics bonus').fill('+6');
    await gmSheet.getByLabel('Athletics bonus').blur();
    await gmSheet.getByLabel('Athletics passive score').fill('18');
    await gmSheet.getByLabel('Athletics passive score').blur();
    await gmSheet.getByLabel('Superiority Dice current').fill('2');
    await gmSheet.getByLabel('Superiority Dice current').blur();
    await gmSheet.getByLabel('Action Surge description')
      .fill('Take one additional action.\nRecharges after a short rest.');
    await gmSheet.getByLabel('Action Surge description').blur();

    await expect(playerSheet.getByLabel('Strength score')).toHaveValue('14');
    await expect(playerSheet.getByLabel('Strength modifier')).toHaveValue('+4');
    await expect(playerSheet.getByLabel('Strength saving throw')).toHaveValue('+7');
    await expect(playerSheet.getByLabel('Athletics bonus')).toHaveValue('+6');
    await expect(playerSheet.getByLabel('Athletics passive score')).toHaveValue('18');
    await expect(playerSheet.getByLabel('Tactics bonus')).toHaveValue('+8');
    await expect(playerSheet.getByLabel('Tactics passive score')).toHaveValue('20');
    await expect(playerSheet.getByLabel('Superiority Dice current')).toHaveValue('2');
    await expect(playerSheet.getByLabel('Backpack capacity usage')).toHaveText('11.1/30');
    await expect(playerSheet.getByLabel('Action Surge description'))
      .toHaveValue('Take one additional action.\nRecharges after a short rest.');
    await expect(playerSheet.getByRole('button', { name: 'Collapse Backpack' })).toBeDisabled();
    await expect(playerSheet.getByLabel('Rations name')).toHaveAttribute('readonly', '');
    await expect(playerSheet.getByLabel('Current weight')).toHaveText('15.1');

    await gmSheet.getByRole('button', { name: 'Collapse Backpack' }).click();
    await expect(playerSheet.getByRole('button', { name: 'Expand Backpack' })).toBeDisabled();
    await expect(playerSheet.getByLabel('Rations name')).toHaveCount(0);
  });

  test('closes a detached player sheet when view permission is revoked', async () => {
    const gm = await apps.launch();
    const player = await apps.launch();
    const port = await availablePort();
    await createAndOpenCampaign(gm.window, CAMPAIGN);
    await addPlayer(gm.window, USERNAME, PASSWORD);
    await setHostPort(gm.window, port);
    await joinCampaign(player.window, {
      campaign: CAMPAIGN,
      password: PASSWORD,
      port,
      username: USERNAME,
    });

    await openTab(gm.window, 'Journal');
    await gm.window.getByRole('button', { name: 'Add journal entry' }).click();
    await gm.window.getByRole('menuitem', { name: 'Character' }).click();
    await gm.window.getByRole('dialog', {
      name: 'New Character character sheet',
    }).press('Escape');
    const gmRow = gm.window.getByRole('button', {
      exact: true,
      name: 'Open New Character',
    });
    await gmRow.click({ button: 'right' });
    await gm.window.getByRole('menuitem', { name: 'Edit Permissions' }).click();
    let permissions = gm.window.getByRole('dialog', { name: 'Edit Permissions' });
    await permissions.getByRole('button', { name: `${USERNAME} permission` }).click();
    await permissions
      .getByRole('group', { name: `${USERNAME} permission options` })
      .getByRole('button', { exact: true, name: 'View' })
      .click();
    await permissions.press('Escape');

    await openTab(player.window, 'Journal');
    await player.window.locator('button[aria-expanded]', {
      hasText: 'Characters',
    }).click();
    const playerRow = player.window.getByRole('button', {
      exact: true,
      name: 'Open New Character',
    });
    await playerRow.click({ button: 'right' });
    const detachedPromise = player.app.waitForEvent('window');
    await player.window.getByRole('menuitem', { name: 'Open Detached' }).click();
    const detached = await detachedPromise;
    const playerSheet = detached.getByRole('document', {
      name: 'New Character character sheet',
    });
    await expect(playerSheet.getByLabel('Strength score')).toHaveAttribute(
      'readonly',
      '',
    );

    await gmRow.click({ button: 'right' });
    await gm.window.getByRole('menuitem', { name: 'Edit Permissions' }).click();
    permissions = gm.window.getByRole('dialog', { name: 'Edit Permissions' });
    await permissions.getByRole('button', { name: `${USERNAME} permission` }).click();
    await permissions
      .getByRole('group', { name: `${USERNAME} permission options` })
      .getByRole('button', { exact: true, name: 'No access' })
      .click();

    await expect.poll(() => detached.isClosed()).toBe(true);
    await expect.poll(() => player.app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    )).toBe(1);
  });
});
