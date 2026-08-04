import { expect, test } from '@playwright/test';
import { AppFixture, availablePort } from './support/app';
import {
  addPlayer,
  createAndOpenCampaign,
  joinCampaign,
  openTab,
  setHostPort,
} from './support/flows';

const CAMPAIGN = 'Silver Archive';
const USERNAME = 'Alice';
const PASSWORD = 'journal-password';

test.describe('networked Journal permissions', () => {
  const apps = new AppFixture();

  test.afterEach(() => apps.disposeAll());

  test('grants player editing and revokes an open editor immediately', async () => {
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
    const gmNote = gm.window.getByRole('dialog').filter({
      has: gm.window.getByRole('textbox', { name: 'Note name' }),
    });
    await gmNote.getByLabel('Page title').fill('Shared Briefing');
    await gmNote.locator('.ProseMirror').fill('Game Master draft');
    await gmNote.getByLabel('Note name').fill('Party Briefing');
    await gmNote.getByLabel('Note name').blur();
    await expect(gmNote.getByText('Saved', { exact: true })).toBeVisible();
    await expect(
      gmNote.getByRole('toolbar', { name: 'Rich text formatting toolbar' }),
    ).toBeVisible();
    await expect(gmNote.getByRole('textbox', { name: 'Page content' })).toHaveAttribute(
      'contenteditable',
      'true',
    );
    await gm.window.mouse.click(10, 10);
    await expect(gmNote).not.toBeVisible();

    const gmRow = gm.window.getByRole('button', { name: /Party Briefing/ });
    await gmRow.click({ button: 'right' });
    await gm.window.getByRole('menuitem', { name: 'Edit Permissions' }).click();
    await expect(gmNote).toBeVisible();
    await gmNote
      .getByRole('group', { name: 'Parent note' })
      .getByLabel(USERNAME)
      .selectOption('edit');
    await expect(gmNote.getByText('Saved', { exact: true })).toBeVisible();
    await gm.window.mouse.click(10, 10);
    await expect(gmNote).not.toBeVisible();

    await openTab(player.window, 'Journal');
    const playerRow = player.window.getByRole('button', { name: /Party Briefing/ });
    await expect(playerRow).toBeVisible();
    await playerRow.click();
    const playerNote = player.window.getByRole('dialog').filter({
      has: player.window.getByRole('textbox', { name: 'Note name' }),
    });
    await expect(
      playerNote.getByRole('toolbar', { name: 'Rich text formatting toolbar' }),
    ).toBeVisible();
    await playerNote.locator('.ProseMirror').fill('Player revision');
    await playerNote.locator('.ProseMirror').blur();
    await expect(playerNote.getByText('Saved', { exact: true })).toBeVisible();
    await player.window.mouse.click(10, 10);
    await expect(playerNote).not.toBeVisible();

    await playerRow.click();
    await expect(playerNote).toBeVisible();
    await expect(playerNote.getByText('Player revision')).toBeVisible();
    await gmRow.click({ button: 'right' });
    await gm.window.getByRole('menuitem', { name: 'Edit Permissions' }).click();
    const currentGmNote = gm.window.getByRole('dialog').filter({
      has: gm.window.getByRole('textbox', { name: 'Note name' }),
    });
    await currentGmNote
      .getByRole('group', { name: 'Parent note' })
      .getByLabel(USERNAME)
      .selectOption('none');

    await expect(playerNote).not.toBeVisible();
    await expect(player.window.getByRole('button', { name: /Party Briefing/ })).toHaveCount(0);
  });
});
