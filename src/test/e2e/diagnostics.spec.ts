import { expect, test } from '@playwright/test';
import { AppFixture } from './support/app';

test.describe('diagnostic console', () => {
  const apps = new AppFixture();
  test.afterEach(() => apps.disposeAll());

  test('opens over the live application and executes typed commands', async () => {
    const { window } = await apps.launch();

    await window.keyboard.press('Backquote');
    await expect(
      window.getByRole('dialog', { name: 'Developer console' }),
    ).toBeVisible();

    const command = window.getByRole('textbox', { name: 'Console command' });
    await command.fill('status');
    await command.press('Enter');

    await expect(window.getByRole('log')).toContainText('environment: test');
    await window.keyboard.press('Escape');
    await expect(
      window.getByRole('tab', { name: 'Create Campaign' }),
    ).toBeVisible();
  });

  test('handles renderer crash lifecycle events and presents stable controls after a repeat', async () => {
    const { app, window } = await apps.launch();
    const reportCrash = () => app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.emit(
        'render-process-gone',
        {} as never,
        { exitCode: 1, reason: 'crashed' } as never,
      );
    });

    await reportCrash();
    await expect(
      window.getByRole('dialog', { name: 'Developer console' }),
    ).toBeVisible();

    await reportCrash();
    await expect(
      window.getByRole('heading', { name: 'The application renderer stopped' }),
    ).toBeVisible();
    await window.getByRole('button', { name: 'Retry renderer' }).click();
    await expect(
      window.getByRole('dialog', { name: 'Developer console' }),
    ).toBeVisible();
  });
});
