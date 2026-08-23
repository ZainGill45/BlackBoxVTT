import { expect, test, type Locator } from '@playwright/test';
import { AppFixture } from '../e2e/support/app';
import { createAndOpenCampaign, openTab } from '../e2e/support/flows';

async function controlGeometry(control: Locator) {
  return control.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      bottom: bounds.bottom,
      height: bounds.height,
      top: bounds.top,
    };
  });
}

/**
 * Durable design requirement: Inventory row editors share the inset underline
 * of container weight totals, while paired Feature fields share one control
 * height. Relative geometry protects alignment without freezing pixel values.
 */
test.describe('character control alignment', () => {
  const apps = new AppFixture();

  test.afterEach(() => apps.disposeAll());

  test('aligns inventory underlines and feature field geometry', async () => {
    const { window } = await apps.launch();
    await createAndOpenCampaign(window, 'Inventory and feature alignment');
    await openTab(window, 'Journal');
    await window.getByRole('button', { name: 'Add journal entry' }).click();
    await window.getByRole('menuitem', { name: 'Character' }).click();

    const sheet = window.getByRole('dialog', {
      name: 'New Character character sheet',
    });
    await sheet.getByRole('button', { name: 'Add Item' }).click();
    await sheet.getByRole('button', { name: 'Add Container' }).click();
    await sheet.getByRole('button', { name: 'Add Feature' }).click();

    const itemGeometry = await Promise.all([
      controlGeometry(sheet.getByLabel('New Item name')),
      controlGeometry(sheet.getByLabel('New Item quantity')),
      controlGeometry(sheet.getByLabel('New Item weight')),
    ]);
    const itemBottoms = itemGeometry.map(({ bottom }) => bottom);
    expect.soft(Math.max(...itemBottoms) - Math.min(...itemBottoms))
      .toBeLessThanOrEqual(0.5);

    const containerGeometry = await Promise.all([
      controlGeometry(sheet.getByLabel('New Container name')),
      controlGeometry(sheet.getByLabel('New Container weight in pounds')),
      controlGeometry(sheet.getByLabel('New Container capacity usage')),
    ]);
    const containerBottoms = containerGeometry.map(({ bottom }) => bottom);
    expect.soft(Math.max(...containerBottoms) - Math.min(...containerBottoms))
      .toBeLessThanOrEqual(0.5);
    const referenceHeight = containerGeometry.at(-1)!.height;
    for (const { height } of itemGeometry) {
      expect.soft(Math.abs(height - referenceHeight)).toBeLessThanOrEqual(0.5);
    }

    const featureName = await controlGeometry(sheet.getByLabel('New Feature name'));
    const featureType = await controlGeometry(
      sheet.getByRole('button', { name: 'New Feature type' }),
    );
    expect.soft(Math.abs(featureName.top - featureType.top)).toBeLessThanOrEqual(0.5);
    expect.soft(Math.abs(featureName.bottom - featureType.bottom)).toBeLessThanOrEqual(0.5);
    expect.soft(Math.abs(featureName.height - featureType.height)).toBeLessThanOrEqual(0.5);
  });
});
