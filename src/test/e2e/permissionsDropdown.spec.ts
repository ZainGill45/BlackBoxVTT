import { expect, test } from '@playwright/test';
import { AppFixture } from './support/app';
import { addPlayer, createAndOpenCampaign, openTab } from './support/flows';

const CAMPAIGN = 'Silver Archive';
const PLAYERS = ['Chris', 'Devon', 'Zack', 'Zain'];

/**
 * Layout constraints the permissions editor has to keep, which only a real
 * browser can answer: jsdom has no layout, so neither the overflow nor the
 * measured width of an open panel means anything there.
 */
test.describe('permissions dropdown', () => {
  const apps = new AppFixture();

  test.afterEach(() => apps.disposeAll());

  test('opens over the editor at full width without growing it', async () => {
    const gm = await apps.launch();
    await createAndOpenCampaign(gm.window, CAMPAIGN);
    for (const name of PLAYERS) {
      await addPlayer(gm.window, name, `${name}-password`);
    }

    await openTab(gm.window, 'Journal');
    await gm.window.getByRole('button', { name: 'Add journal entry' }).click();
    await gm.window.getByRole('menuitem', { name: 'Character' }).click();
    await gm.window.keyboard.press('Escape');
    await gm.window
      .getByRole('button', { exact: true, name: 'Open New Character' })
      .click({ button: 'right' });
    await gm.window.getByRole('menuitem', { name: 'Edit Permissions' }).click();

    const permissions = gm.window.getByRole('dialog', { name: 'Edit Permissions' });
    await expect(permissions).toBeVisible();
    const scrollHeight = () =>
      permissions.evaluate((node) => node.scrollHeight);
    const before = await scrollHeight();

    /* The last row is the one with no space beneath it inside the editor, so
       it is where a panel that joined the scrollable content would show. */
    const last = PLAYERS[PLAYERS.length - 1];
    const trigger = permissions.getByRole('button', { name: `${last} permission` });
    await trigger.click();
    const panel = permissions.getByRole('group', { name: `${last} permission options` });
    await expect(panel).toBeVisible();

    // Floating over the editor rather than inside it leaves its height alone.
    expect(await scrollHeight()).toBe(before);

    const triggerBox = await trigger.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    // A panel narrower than the control it belongs to reads as a mistake.
    expect(panelBox!.width).toBeGreaterThanOrEqual(triggerBox!.width);
  });
});
