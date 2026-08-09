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

  test('grants one page from a private note and revokes an open editor immediately', async () => {
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
    await gm.window.getByRole('menuitem', { name: 'Note' }).click();
    const gmNote = gm.window.getByRole('dialog').filter({
      has: gm.window.getByRole('textbox', { name: 'Note name' }),
    });
    const gmDraft = gmNote.locator('.ProseMirror');
    await gmDraft.fill('Game Master draft');
    await gmDraft.press('Control+A');
    await gmNote.getByRole('button', { name: 'Font Size: Default' }).click();
    await gmNote.getByRole('button', { name: '24px' }).click();
    const formattedDraft = gmDraft.locator('span');
    await expect(formattedDraft).toHaveCSS('font-size', '24px');
    await gmNote.getByRole('button', { name: 'Line Length: Wide' }).click();
    await gmNote.getByRole('button', { name: 'Full' }).click();
    const fullWidth = await gmDraft.evaluate(
      (element) => element.getBoundingClientRect().width,
    );
    await gmNote.getByRole('button', { name: 'Line Length: Full' }).click();
    await gmNote.getByRole('button', { name: 'Narrow' }).click();
    await expect(gmDraft.locator('..')).toHaveAttribute('data-line-length', 'narrow');
    const narrowWidth = await gmDraft.evaluate(
      (element) => element.getBoundingClientRect().width,
    );
    expect(narrowWidth).toBeLessThan(fullWidth);
    await gmNote.getByLabel('Note name').fill('Party Briefing');
    await gmNote.getByLabel('Note name').blur();
    await expect(gm.window.getByRole('button', {
      exact: true,
      name: 'Open Party Briefing',
    })).toBeVisible();
    await expect(gmNote.getByText('Saved', { exact: true })).toHaveCount(0);
    await expect(
      gmNote.getByRole('toolbar', { name: 'Rich text formatting toolbar' }),
    ).toBeVisible();
    const styleControl = gmNote
      .getByRole('toolbar', { name: 'Rich text formatting toolbar' })
      .locator(':scope > details')
      .first();
    await styleControl.locator('summary').click();
    const stylePanel = styleControl.getByRole('group');
    await expect(stylePanel.getByRole('button')).toHaveCount(12);
    await styleControl.locator('summary').click();
    await gmDraft.focus();
    await gmNote.getByRole('button', { name: 'Insert' }).click();
    const insertPanel = gmNote.getByRole('group', { name: 'Insert options' });
    for (const label of ['Horizontal Rule', 'Table', 'Image']) {
      const insertAction = insertPanel.getByRole('button', { name: label });
      await expect(insertAction).toBeVisible();
    }
    await gmNote.getByRole('button', { name: 'Insert' }).click();
    await gmNote.getByRole('button', { name: 'Text Color: Default', exact: true }).click();
    const colorPanel = gmNote.getByRole('group', {
      name: 'Text Color: Default options',
    });
    await expect(colorPanel.getByRole('button')).toHaveCount(12);
    await expect(colorPanel.getByRole('button', { name: 'Text color: Brown' })).toBeVisible();
    await gmNote.getByRole('button', { name: 'Text Color: Default', exact: true }).click();
    await expect(gmNote.getByRole('textbox', { name: 'Page content' })).toHaveAttribute(
      'contenteditable',
      'true',
    );
    await gm.window.mouse.click(10, 10);
    await expect(gmNote).not.toBeVisible();

    const gmRow = gm.window.getByRole('button', {
      exact: true,
      name: 'Open Party Briefing',
    });
    // A page's access is granted from that page, not from a note-wide editor.
    await gmRow.click();
    await expect(gmNote).toBeVisible();
    await gmNote
      .getByRole('button', { exact: true, name: 'Open New Page' })
      .click({ button: 'right' });
    await gm.window.getByRole('menuitem', { name: 'Edit Page Permissions' }).click();
    const permissions = gm.window.getByRole('dialog', { name: 'Edit Permissions' });
    await expect(permissions).toBeVisible();
    await permissions.getByRole('button', { name: `${USERNAME} permission` }).click();
    await permissions
      .getByRole('group', { name: `${USERNAME} permission options` })
      .getByRole('button', { exact: true, name: 'Edit' })
      .click();
    // Choosing the level is the save; there is nothing to confirm.
    await permissions.press('Escape');
    await expect(permissions).not.toBeVisible();
    await expect(gmNote).toBeVisible();
    await gmNote.press('Escape');
    await expect(gmNote).not.toBeVisible();

    await openTab(player.window, 'Journal');
    await player.window.locator('button[aria-expanded]', { hasText: 'Notes' }).click();
    const playerRow = player.window.getByRole('button', {
      exact: true,
      name: 'Open Party Briefing',
    });
    await expect(playerRow).toBeVisible();
    await playerRow.click();
    const playerNote = player.window.getByRole('dialog').filter({
      has: player.window.getByRole('textbox', { name: 'Note name' }),
    });
    await expect(
      playerNote.getByRole('toolbar', { name: 'Rich text formatting toolbar' }),
    ).toBeVisible();
    const playerDraft = playerNote.locator('.ProseMirror');
    await expect(playerDraft.locator('span')).toHaveCSS('font-size', '24px');
    await expect(playerDraft.locator('..')).toHaveAttribute('data-line-length', 'narrow');
    await playerDraft.fill('Player revision');
    await playerDraft.blur();
    await player.window.mouse.click(10, 10);
    await expect(playerNote).not.toBeVisible();

    await playerRow.click();
    await expect(playerNote).toBeVisible();
    await expect(playerNote.getByText('Player revision')).toBeVisible();
    await expect(playerNote.locator('.ProseMirror').locator('..'))
      .toHaveAttribute('data-line-length', 'narrow');
    await gmRow.click();
    await expect(gmNote).toBeVisible();
    await gmNote
      .getByRole('button', { exact: true, name: 'Open New Page' })
      .click({ button: 'right' });
    await gm.window.getByRole('menuitem', { name: 'Edit Page Permissions' }).click();
    const currentPermissions = gm.window.getByRole('dialog', { name: 'Edit Permissions' });
    await currentPermissions
      .getByRole('button', { name: `${USERNAME} permission` })
      .click();
    await currentPermissions
      .getByRole('group', { name: `${USERNAME} permission options` })
      .getByRole('button', { exact: true, name: 'No access' })
      .click();

    // Revoking lands on its own, and takes the open editor away with it.
    await expect(playerNote).not.toBeVisible();
    await expect(player.window.getByRole('button', {
      exact: true,
      name: 'Open Party Briefing',
    })).toHaveCount(0);
  });
});
