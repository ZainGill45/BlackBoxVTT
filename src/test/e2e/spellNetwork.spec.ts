import { expect, test } from '@playwright/test';
import { AppFixture, availablePort } from './support/app';
import {
  addPlayer,
  createAndOpenCampaign,
  joinCampaign,
  openTab,
  setHostPort,
} from './support/flows';

const CAMPAIGN = 'Spellbound Archive';
const USERNAME = 'Alice';
const PASSWORD = 'spell-password';

test.describe('networked D&D Spell Journal entries', () => {
  const apps = new AppFixture();

  test.afterEach(() => apps.disposeAll());

  test('shares a new Spell read-only, synchronizes edits, and revokes View immediately', async () => {
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
    await gm.window.getByRole('menuitem', { name: 'Spell' }).click();
    const gmSheet = gm.window.getByRole('dialog', { name: /spell sheet$/ });
    await expect(gmSheet).toBeVisible();
    const primaryDropdownHeights = await Promise.all([
      gmSheet.getByRole('button', { exact: true, name: 'Level' }),
      gmSheet.getByRole('button', { exact: true, name: 'School' }),
      gmSheet.getByRole('button', { exact: true, name: 'Spell classes' }),
    ].map(async (control) => Math.round((await control.boundingBox())?.height ?? 0)));
    expect(primaryDropdownHeights[0]).toBeGreaterThan(0);
    expect(new Set(primaryDropdownHeights).size).toBe(1);
    await gmSheet.getByLabel('Spell Name').fill('Fire Bloom');
    await gmSheet.getByLabel('Spell Name').blur();
    await gmSheet.getByRole('button', { name: 'Spell classes' }).click();
    const wizardClass = gmSheet.getByRole('button', { name: 'Wizard' });
    await wizardClass.click();
    await expect(wizardClass).toHaveAttribute('aria-pressed', 'true');
    await expect(gmSheet).toBeVisible();
    await expect(gm.window.getByRole('dialog')).toHaveCount(1);
    await wizardClass.press('Escape');
    await gmSheet.getByRole('button', { exact: true, name: 'Level' }).click();
    await gmSheet.getByRole('group', { name: 'Level options' })
      .getByRole('button', { name: '3rd Level' })
      .click();
    await gmSheet.getByRole('button', { exact: true, name: 'School' }).click();
    await gmSheet.getByRole('group', { name: 'School options' })
      .getByRole('button', { name: 'Evocation' })
      .click();
    await gmSheet.getByLabel('Spell Description').fill('A bloom of authored flame.');
    await gmSheet.getByLabel('Spell Description').blur();

    // Default View makes the row available while the Game Master is still authoring.
    await openTab(player.window, 'Journal');
    const playerGroup = player.window.locator('button[aria-expanded]', {
      hasText: 'Spells',
    });
    await expect(playerGroup).toBeVisible();
    await playerGroup.click();
    const playerRow = player.window.getByRole('button', {
      exact: true,
      name: 'Open Fire Bloom',
    });
    await expect(playerRow).toBeVisible();
    await expect(player.window.getByText('3rd Level Evocation')).toBeVisible();
    await playerRow.click();
    const playerSheet = player.window.getByRole('dialog', {
      name: 'Fire Bloom spell sheet',
    });
    await expect(playerSheet.getByLabel('Spell Description'))
      .toHaveAttribute('readonly', '');
    await expect(playerSheet.getByRole('button', { exact: true, name: 'Level' }))
      .toHaveAttribute('aria-disabled', 'true');
    await expect(playerSheet.getByRole('button', { name: 'Add Roll Action' }))
      .toHaveCount(0);

    await gmSheet.getByLabel('Duration').fill('Up to 1 minute');
    await gmSheet.getByLabel('Duration').blur();
    await expect(playerSheet.getByLabel('Duration')).toHaveValue('Up to 1 minute');

    await gmSheet.press('Escape');
    await expect(gmSheet).not.toBeVisible();
    const gmRow = gm.window.getByRole('button', {
      exact: true,
      name: 'Open Fire Bloom',
    });
    await gmRow.click({ button: 'right' });
    await gm.window.getByRole('menuitem', { name: 'Edit Permissions' }).click();
    const permissions = gm.window.getByRole('dialog', { name: 'Edit Permissions' });
    await permissions.getByRole('button', { name: `${USERNAME} permission` }).click();
    await permissions
      .getByRole('group', { name: `${USERNAME} permission options` })
      .getByRole('button', { exact: true, name: 'No access' })
      .click();

    await expect(playerSheet).not.toBeVisible();
    await expect(playerRow).toHaveCount(0);
  });
});
