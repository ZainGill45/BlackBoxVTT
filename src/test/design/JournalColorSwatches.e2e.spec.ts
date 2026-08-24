import { expect, test } from '@playwright/test';
import { AppFixture } from '../e2e/support/app';
import { createAndOpenCampaign, openTab } from '../e2e/support/flows';

/**
 * Durable usability requirement: Text Color options must paint a visible
 * square. Collapsing to a 1px hairline makes the palette unreadable even when
 * the click handler still applies the colour.
 */
test.describe('journal text-color swatches', () => {
  const apps = new AppFixture();

  test.afterEach(() => apps.disposeAll());

  test('paints a visible square for each text color', async () => {
    const { window } = await apps.launch();
    await createAndOpenCampaign(window, 'Color swatch visibility');
    await openTab(window, 'Journal');
    await window.getByRole('button', { name: 'Add journal entry' }).click();
    await window.getByRole('menuitem', { name: 'Note' }).click();

    const note = window.getByRole('dialog').filter({
      has: window.getByRole('textbox', { name: 'Note name' }),
    });
    await note.getByRole('button', { name: 'Text Color: Default', exact: true }).click();
    const colorPanel = note.getByRole('listbox', {
      name: 'Text Color: Default options',
    });
    const paint = await colorPanel
      .getByRole('option', { name: 'Text color: Red' })
      .locator('[data-color-swatch]')
      .boundingBox();

    expect(paint, 'Text color swatches paint a visible square').not.toBeNull();
    expect(paint!.width).toBeGreaterThan(8);
    expect(paint!.height).toBeGreaterThan(8);
    expect(Math.abs(paint!.width - paint!.height)).toBeLessThanOrEqual(2);
  });

  test('spreads the palette across the whole panel', async () => {
    const { window } = await apps.launch();
    await createAndOpenCampaign(window, 'Color swatch layout');
    await openTab(window, 'Journal');
    await window.getByRole('button', { name: 'Add journal entry' }).click();
    await window.getByRole('menuitem', { name: 'Note' }).click();

    const note = window.getByRole('dialog').filter({
      has: window.getByRole('textbox', { name: 'Note name' }),
    });
    await note.getByRole('button', { name: 'Text Color: Default', exact: true }).click();
    const colorPanel = note.getByRole('listbox', {
      name: 'Text Color: Default options',
    });

    const panel = await colorPanel.boundingBox();
    const first = await colorPanel
      .getByRole('option', { name: 'Text color: Default' })
      .boundingBox();
    const last = await colorPanel
      .getByRole('option', { name: 'Text color: Pink' })
      .boundingBox();
    expect(panel).not.toBeNull();
    expect(first).not.toBeNull();
    expect(last).not.toBeNull();

    // Leftover width belongs between the swatches, not stranded as an empty
    // column past the last one.
    const leading = first!.x - panel!.x;
    const trailing = panel!.x + panel!.width - (last!.x + last!.width);
    expect(
      trailing,
      'the palette leaves no dead column on the right',
    ).toBeLessThanOrEqual(leading + 2);
  });
});
