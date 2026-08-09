import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';
import { extract as extractTar } from 'tar';
import { addIntermediatePermissionSchema } from '../support/campaignArchive';
import { AppFixture } from './support/app';

const unavailableCampaignId = '77777777-7777-4777-8777-777777777777';
const unavailableCampaignName = 'Unavailable campaign (77777777)';
const supersededCampaignId = '88888888-8888-4888-8888-888888888888';
const supersededCampaignName = 'Unavailable campaign (88888888)';
const intermediateCampaignId = '99999999-9999-4999-8999-999999999999';
const intermediateCampaignName = 'Unavailable campaign (99999999)';

async function campaignsDirectory(prefix: string, id: string) {
  const userDataPath = await mkdtemp(path.join(tmpdir(), prefix));
  const campaignDirectory = path.join(
    userDataPath,
    'data',
    'campaigns',
    id,
  );
  await mkdir(campaignDirectory, { recursive: true });
  return { campaignDirectory, userDataPath };
}

test.describe('unavailable campaign recovery', () => {
  const apps = new AppFixture();

  test.afterEach(() => apps.disposeAll());

  test('offers deletion and salvage, and says why salvage cannot help', async () => {
    const { campaignDirectory, userDataPath } = await campaignsDirectory(
      'blackbox-e2e-unavailable-',
      unavailableCampaignId,
    );
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
    ).toHaveCount(0);
    await expect(
      window.getByRole('button', { name: `Open ${unavailableCampaignName}` }),
    ).toHaveCount(0);

    await window
      .getByRole('button', { name: `Salvage ${unavailableCampaignName}` })
      .click();
    await expect(window.getByRole('alert')).toContainText(
      'database is damaged and cannot be salvaged',
    );

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

  test('rebuilds a campaign an earlier release wrote', async () => {
    const { campaignDirectory, userDataPath } = await campaignsDirectory(
      'blackbox-e2e-salvage-',
      supersededCampaignId,
    );
    await extractTar({
      cwd: campaignDirectory,
      file: path.resolve(
        'src/test/fixtures/archives/dnd5e-character-format-3.blackbox-campaign',
      ),
      gzip: true,
      strict: true,
    });
    /* A campaign on disk carries no export manifest, so the release that
       wrote it has to be recognized from the data itself. */
    await rm(path.join(campaignDirectory, 'export.json'), { force: true });

    const { window } = await apps.launchInto(userDataPath);
    await window.getByRole('tab', { name: 'Create Campaign' }).click();
    await expect(window.getByText(supersededCampaignName)).toBeVisible();

    await window
      .getByRole('button', { name: `Salvage ${supersededCampaignName}` })
      .click();

    await expect(window.getByRole('status')).toContainText(
      'Salvaged Format Three Character from campaign format 3.',
    );
    await expect(
      window.getByRole('button', { name: 'Open Format Three Character' }),
    ).toBeVisible();
    await expect(window.getByText(supersededCampaignName)).toBeHidden();
  });

  test('rebuilds the exact intermediate permission schema', async () => {
    const { campaignDirectory, userDataPath } = await campaignsDirectory(
      'blackbox-e2e-intermediate-salvage-',
      intermediateCampaignId,
    );
    await extractTar({
      cwd: campaignDirectory,
      file: path.resolve(
        'src/test/fixtures/archives/dnd5e-character-format-3.blackbox-campaign',
      ),
      gzip: true,
      strict: true,
    });
    await rm(path.join(campaignDirectory, 'export.json'), { force: true });
    const database = new DatabaseSync(
      path.join(campaignDirectory, 'campaign.sqlite'),
    );
    addIntermediatePermissionSchema(database);
    database.close();

    const { window } = await apps.launchInto(userDataPath);
    await window.getByRole('tab', { name: 'Create Campaign' }).click();
    await expect(window.getByText(intermediateCampaignName)).toBeVisible();

    await window
      .getByRole('button', { name: `Salvage ${intermediateCampaignName}` })
      .click();

    await expect(window.getByRole('status')).toContainText(
      'Salvaged Format Three Character from campaign format 4.',
    );
    await expect(
      window.getByRole('button', { name: 'Open Format Three Character' }),
    ).toBeVisible();
    await expect(window.getByText(intermediateCampaignName)).toBeHidden();
  });
});
