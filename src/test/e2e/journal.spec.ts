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
    const fullGeometry = await gmDraft.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        textAlign: getComputedStyle(element).textAlign,
        width: bounds.width,
      };
    });
    await gmNote.getByRole('button', { name: 'Line Length: Full' }).click();
    await gmNote.getByRole('button', { name: 'Narrow' }).click();
    await expect(gmDraft.locator('..')).toHaveAttribute('data-line-length', 'narrow');
    const narrowGeometry = await gmDraft.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const containerBounds = element.parentElement?.getBoundingClientRect();
      return {
        containerLeft: containerBounds?.left ?? 0,
        containerRight: containerBounds?.right ?? 0,
        left: bounds.left,
        right: bounds.right,
        textAlign: getComputedStyle(element).textAlign,
        width: bounds.width,
        container: containerBounds?.width ?? 0,
      };
    });
    expect(narrowGeometry.width).toBeLessThan(narrowGeometry.container);
    expect(narrowGeometry.width).toBeLessThan(fullGeometry.width);
    expect(narrowGeometry.left).toBeGreaterThan(fullGeometry.left);
    expect(
      Math.abs(
        (narrowGeometry.left - narrowGeometry.containerLeft) -
        (narrowGeometry.containerRight - narrowGeometry.right),
      ),
    ).toBeLessThanOrEqual(1);
    expect(narrowGeometry.textAlign).toBe(fullGeometry.textAlign);
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
    const toolbarLayout = await gmNote
      .getByRole('toolbar', { name: 'Rich text formatting toolbar' })
      .evaluate((toolbar) => {
        const childTops = Array.from(toolbar.children, (child) =>
          child.getBoundingClientRect().top);
        const clippedLabels = Array.from(
          toolbar.querySelectorAll(':scope > details > summary > span'),
          (label) => label.scrollWidth > label.clientWidth,
        ).filter(Boolean).length;
        const labels = Array.from(
          toolbar.querySelectorAll<HTMLElement>(':scope > details > summary > span'),
        );
        const originalLabels = labels.map((label) => label.textContent ?? '');
        const widestLabels = [
          'Style: Unordered List',
          'Alignment: Center',
          'Font Family: Roboto Mono',
          'Font Size: Default',
          'Line Length: Comfortable',
          'Insert',
          'Text Color: Default',
        ];
        labels.forEach((label, index) => {
          label.textContent = widestLabels[index] ?? label.textContent;
        });
        const widestLabelOverflow = toolbar.scrollWidth - toolbar.clientWidth;
        labels.forEach((label, index) => {
          label.textContent = originalLabels[index] ?? label.textContent;
        });
        const toolbarBounds = toolbar.getBoundingClientRect();
        const firstControlBounds = toolbar.firstElementChild?.getBoundingClientRect();
        const lastControlBounds = toolbar.lastElementChild?.getBoundingClientRect();
        return {
          centerOffset: firstControlBounds && lastControlBounds
            ? Math.abs(
              (firstControlBounds.left - toolbarBounds.left) -
              (toolbarBounds.right - lastControlBounds.right),
            )
            : Number.POSITIVE_INFINITY,
          clippedLabels,
          overflow: toolbar.scrollWidth - toolbar.clientWidth,
          rowSpread: Math.max(...childTops) - Math.min(...childTops),
          widestLabelOverflow,
        };
      });
    expect(toolbarLayout.clippedLabels).toBe(0);
    expect(toolbarLayout.centerOffset).toBeLessThanOrEqual(1);
    expect(toolbarLayout.rowSpread).toBeLessThan(2);
    expect(toolbarLayout.overflow).toBeLessThanOrEqual(1);
    expect(toolbarLayout.widestLabelOverflow).toBeLessThanOrEqual(1);
    const sidebarActionLayout = await Promise.all([
      gmNote.getByRole('button', { name: 'Edit permissions' }).evaluate((button) => {
        const icon = button.querySelector('svg');
        return {
          iconFlexShrink: icon ? getComputedStyle(icon).flexShrink : null,
          iconWidth: icon?.getBoundingClientRect().width ?? 0,
          overflow: button.scrollWidth - button.clientWidth,
          whiteSpace: getComputedStyle(button).whiteSpace,
        };
      }),
      gmNote.getByRole('button', { name: 'Delete note' }).evaluate((button) => {
        const icon = button.querySelector('svg');
        return {
          iconFlexShrink: icon ? getComputedStyle(icon).flexShrink : null,
          iconWidth: icon?.getBoundingClientRect().width ?? 0,
          overflow: button.scrollWidth - button.clientWidth,
          whiteSpace: getComputedStyle(button).whiteSpace,
        };
      }),
    ]);
    for (const action of sidebarActionLayout) {
      expect(action.overflow).toBeLessThanOrEqual(1);
      expect(action.iconFlexShrink).toBe('0');
      expect(action.iconWidth).toBeGreaterThanOrEqual(15.5);
      expect(action.whiteSpace).toBe('nowrap');
    }
    const styleControl = gmNote
      .getByRole('toolbar', { name: 'Rich text formatting toolbar' })
      .locator(':scope > details')
      .first();
    await styleControl.locator('summary').click();
    const stylePanel = styleControl.getByRole('group');
    await expect(stylePanel.getByRole('button')).toHaveCount(12);
    const stylePanelLayout = await stylePanel.evaluate((panel) => {
      const dialog = panel.closest('[role="dialog"]');
      const panelBounds = panel.getBoundingClientRect();
      const dialogBounds = dialog?.getBoundingClientRect();
      return {
        bottomOverflow: dialogBounds ? panelBounds.bottom - dialogBounds.bottom : 0,
        contentOverflow: panel.scrollHeight - panel.clientHeight,
        overflowY: getComputedStyle(panel).overflowY,
      };
    });
    expect(stylePanelLayout.bottomOverflow).toBeLessThanOrEqual(0);
    expect(stylePanelLayout.contentOverflow).toBeLessThanOrEqual(1);
    expect(stylePanelLayout.overflowY).toBe('visible');
    await styleControl.locator('summary').click();
    await gmDraft.focus();
    await gmNote.getByRole('button', { name: 'Insert' }).click();
    const insertPanel = gmNote.getByRole('group', { name: 'Insert options' });
    for (const label of ['Horizontal Rule', 'Table', 'Image']) {
      const insertAction = insertPanel.getByRole('button', { name: label });
      await expect(insertAction.locator('svg')).toBeVisible();
      const iconGap = await insertAction.evaluate((button) => {
        const icon = button.querySelector('svg');
        const text = button.querySelector('span');
        if (!icon || !text) throw new Error('The Insert action layout is incomplete.');
        return text.getBoundingClientRect().left - icon.getBoundingClientRect().right;
      });
      expect(iconGap).toBeGreaterThanOrEqual(3.5);
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
    await gmRow.click({ button: 'right' });
    await gm.window.getByRole('menuitem', { name: 'Edit Permissions' }).click();
    const permissions = gm.window.getByRole('dialog', {
      name: 'Edit Journal permissions',
    });
    await expect(permissions).toBeVisible();
    await permissions.getByRole('button', { name: /New Page/ }).click();
    await permissions.getByLabel(`${USERNAME} permission`).selectOption('edit');
    await permissions.getByRole('button', { name: 'Save changes' }).click();
    await expect(permissions).not.toBeVisible();
    await gm.window.mouse.click(10, 10);
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
    await gmRow.click({ button: 'right' });
    await gm.window.getByRole('menuitem', { name: 'Edit Permissions' }).click();
    const currentPermissions = gm.window.getByRole('dialog', {
      name: 'Edit Journal permissions',
    });
    await currentPermissions.getByRole('button', { name: /New Page/ }).click();
    await currentPermissions.getByLabel(`${USERNAME} permission`).selectOption('none');
    await currentPermissions.getByRole('button', { name: 'Save changes' }).click();

    await expect(playerNote).not.toBeVisible();
    await expect(player.window.getByRole('button', {
      exact: true,
      name: 'Open Party Briefing',
    })).toHaveCount(0);
  });
});
