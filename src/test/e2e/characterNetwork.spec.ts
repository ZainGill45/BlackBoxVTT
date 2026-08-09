import { expect, test } from '@playwright/test';
import { AppFixture, availablePort } from './support/app';
import {
  addPlayer,
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
    const playerSheet = player.window.getByRole('dialog', {
      name: 'New Character character sheet',
    });
    await expect(playerSheet.getByLabel('Strength score')).toHaveValue('12');
    await expect(playerSheet.getByLabel('Strength score')).toHaveAttribute('readonly', '');
    await expect(playerSheet.getByLabel('Proficiency Bonus')).toHaveValue('+3');
    await expect(playerSheet.getByLabel('Strength modifier')).toHaveValue('+3');
    await expect(playerSheet.getByLabel('Strength saving throw')).toHaveValue('+6');
    await expect(playerSheet.getByLabel('Athletics bonus and passive score'))
      .toHaveText('+3 / 13');
    await expect(playerSheet.getByLabel('Superiority Dice name')).toHaveAttribute('readonly', '');
    await expect(playerSheet.getByLabel('Superiority Dice current')).toHaveValue('-1');
    await expect(playerSheet.getByLabel('Superiority Dice maximum')).toHaveValue('4');
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
    await gmSheet.getByLabel('Strength score').fill('14');
    await gmSheet.getByLabel('Strength score').blur();
    await gmSheet.getByLabel('Superiority Dice current').fill('2');
    await gmSheet.getByLabel('Superiority Dice current').blur();
    await gmSheet.getByLabel('Action Surge description')
      .fill('Take one additional action.\nRecharges after a short rest.');
    await gmSheet.getByLabel('Action Surge description').blur();

    await expect(playerSheet.getByLabel('Strength score')).toHaveValue('14');
    await expect(playerSheet.getByLabel('Strength modifier')).toHaveValue('+4');
    await expect(playerSheet.getByLabel('Strength saving throw')).toHaveValue('+7');
    await expect(playerSheet.getByLabel('Athletics bonus and passive score'))
      .toHaveText('+4 / 14');
    await expect(playerSheet.getByLabel('Superiority Dice current')).toHaveValue('2');
    await expect(playerSheet.getByLabel('Action Surge description'))
      .toHaveValue('Take one additional action.\nRecharges after a short rest.');
  });
});
