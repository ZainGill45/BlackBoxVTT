import { expect, test } from '@playwright/test';
import { AppFixture } from '../e2e/support/app';
import { createAndOpenCampaign } from '../e2e/support/flows';
import { createEmptyScene, hoverStage, stage, stageCentre } from '../e2e/support/stage';

/**
 * The scene text editor must follow camera zoom instead of retaining a form
 * control's minimum size, and must not cover the live canvas text on hover.
 * Relative geometry checks this requirement without fixing a pixel size.
 */
test.describe('scene text editor zoom', () => {
  const apps = new AppFixture();
  test.afterEach(() => apps.disposeAll());

  test('shrinks the editor with the scene while preserving the draft', async () => {
    const { window } = await apps.launch();
    await createAndOpenCampaign(window, 'Text editor zoom');
    await createEmptyScene(window);
    const canvas = stage(window);
    const centre = await stageCentre(window);
    await window.getByRole('button', { name: 'Text', exact: true }).click();
    await canvas.click({ position: centre });
    const editor = window.getByLabel('New map text');
    await expect(editor).toBeVisible();
    const initialEmpty = (await editor.boundingBox())!;
    await editor.fill('Map');
    await window.evaluate(() => document.fonts.ready.then(() => undefined));
    const initial = (await editor.boundingBox())!;

    // Wheel over the scene without blurring or committing the current draft.
    await hoverStage(window, { x: centre.x + 100, y: centre.y + 100 });
    await window.mouse.wheel(0, 600);
    await expect.poll(async () => (await editor.boundingBox())!.height)
      .toBeLessThan(initial.height * 0.8);
    await expect.poll(async () => (await editor.boundingBox())!.width)
      .toBeLessThan(initial.width * 0.8);
    await expect(editor).toHaveValue('Map');

    await editor.hover();
    await expect.poll(() => editor.evaluate((element) =>
      getComputedStyle(element).backgroundColor,
    )).toBe('rgba(0, 0, 0, 0)');

    await editor.fill('');
    const zoomedEmpty = (await editor.boundingBox())!;
    expect(zoomedEmpty.height).toBeLessThan(initialEmpty.height * 0.8);
    expect(zoomedEmpty.width).toBeLessThan(initialEmpty.width * 0.8);

    await editor.fill('Map\nSecond line');
    const multiline = (await editor.boundingBox())!;
    await editor.fill('Map');
    await expect.poll(async () => (await editor.boundingBox())!.height)
      .toBeLessThan(multiline.height);
    await editor.press('Control+Enter');
    await expect(editor).toBeHidden();
  });
});
