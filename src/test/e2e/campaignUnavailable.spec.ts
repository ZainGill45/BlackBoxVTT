import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { AppFixture } from './support/app';

const unavailableCampaignId = '77777777-7777-4777-8777-777777777777';
const unavailableCampaignName = 'Unavailable campaign (77777777)';

test.describe('unavailable campaign cleanup', () => {
  const apps = new AppFixture();

  test.afterEach(() => apps.disposeAll());

  test('lists noncanonical campaign data with deletion as its only action', async () => {
    const userDataPath = await mkdtemp(
      path.join(tmpdir(), 'blackbox-e2e-unavailable-'),
    );
    const campaignDirectory = path.join(
      userDataPath,
      'data',
      'campaigns',
      unavailableCampaignId,
    );
    await mkdir(campaignDirectory, { recursive: true });
    await writeFile(
      path.join(campaignDirectory, 'campaign.sqlite'),
      'not a canonical campaign database',
    );

    const { window } = await apps.launchInto(userDataPath);
    await window.getByRole('tab', { name: 'Create Campaign' }).click();

    await expect(window.getByText(unavailableCampaignName)).toBeVisible();
    await expect(
      window.getByRole('button', {
        name: `Export ${unavailableCampaignName}`,
      }),
    ).toBeDisabled();
    await expect(
      window.getByRole('button', { name: `Open ${unavailableCampaignName}` }),
    ).toBeDisabled();

    await window
      .getByRole('button', { name: `Delete ${unavailableCampaignName}` })
      .click();
    await window
      .getByRole('button', {
        name: `Confirm deletion of ${unavailableCampaignName}`,
      })
      .click();

    await expect(window.getByText(unavailableCampaignName)).toBeHidden();
  });
});
