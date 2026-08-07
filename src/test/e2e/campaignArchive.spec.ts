import path from 'node:path';
import { expect, test } from '@playwright/test';
import { AppFixture } from './support/app';

test.describe('campaign archive conversion', () => {
  const apps = new AppFixture();

  test.afterEach(() => apps.disposeAll());

  test('exports and reconstructs a campaign from the connection screen', async () => {
    const { app, userDataPath, window } = await apps.launch();
    const archivePath = path.join(
      userDataPath,
      'Iron Meridian.blackbox-campaign',
    );

    await window.getByRole('tab', { name: 'Create Campaign' }).click();
    await window.getByLabel('Campaign name').fill('Iron Meridian');
    await window.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(
      window.getByRole('button', { name: 'Export Iron Meridian' }),
    ).toBeVisible();

    await app.evaluate(async ({ dialog }, destinationPath) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: destinationPath,
      });
    }, archivePath);
    await window
      .getByRole('button', { name: 'Export Iron Meridian' })
      .click();
    await expect(window.getByRole('status')).toHaveText(
      'Exported Iron Meridian.blackbox-campaign.',
    );

    await app.evaluate(async ({ dialog }, sourcePath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [sourcePath],
      });
    }, archivePath);
    await window.getByRole('button', { name: 'Import', exact: true }).click();

    await expect(
      window.getByRole('button', { name: 'Open Iron Meridian (Imported)' }),
    ).toBeVisible();
    await expect(window.getByRole('status')).toContainText(
      'Server identity was not imported',
    );
  });
});
