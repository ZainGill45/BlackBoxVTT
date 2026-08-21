import { expect, test } from '@playwright/test';
import { AppFixture } from './support/app';
import type { LaunchedApp } from './support/app';
import { createAndOpenCampaign, openTab } from './support/flows';
import { createSceneWithMap, importFixture } from './support/stage';

/**
 * The sidebar's tabs, against a campaign with something in every one of them.
 *
 * Each panel is torn down whenever the sidebar switches away from it. Nothing
 * in vitest can show the old visible cost: panels rendered their "nothing here"
 * state first and filled it in a frame later, so every visit to every tab
 * flashed an empty campaign that was not empty.
 */

const CAMPAIGN = 'Lantern Ward';

/** The tabs that draw a collection, and so have an empty state to flash. */
const COLLECTION_TABS = ['Scenes', 'Journal', 'Storage'] as const;

/** Where the watcher below records what it saw, inside the page. */
type EmptyTabWatcher = { __emptyTabs: string[] };

test.describe('campaign sidebar', () => {
  const apps = new AppFixture();
  let gm: LaunchedApp;

  test.beforeEach(async () => {
    gm = await apps.launch();
    await createAndOpenCampaign(gm.window, CAMPAIGN);
  });

  test.afterEach(() => apps.disposeAll());

  test('never shows an empty tab in a campaign that has content', async () => {
    // A map, a scene built on it, and a note: one for each collection tab.
    await importFixture(gm.app, gm.window);
    await createSceneWithMap(gm.window, CAMPAIGN);
    await openTab(gm.window, 'Journal');
    await gm.window.getByRole('button', { name: 'Add journal entry' }).click();
    await gm.window.getByRole('menuitem', { name: 'Note' }).click();
    const note = gm.window.getByRole('dialog').filter({
      has: gm.window.getByRole('textbox', { name: 'Note name' }),
    });
    await note.press('Escape');
    await expect(note).toHaveCount(0);

    /* Watched rather than asserted, because a flash is precisely what a
       settling assertion cannot see: by the time it looks, the tab it was
       going to catch has already filled itself in. */
    await gm.window.evaluate(() => {
      const watcher = window as unknown as EmptyTabWatcher;
      watcher.__emptyTabs = [];
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            const empty = node.matches('[data-sidebar-icon]')
              ? node
              : node.querySelector('[data-sidebar-icon]');
            if (empty) {
              watcher.__emptyTabs.push(
                empty.getAttribute('data-sidebar-icon') ?? 'unknown',
              );
            }
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    });

    // Twice around, so a first visit and a return are both covered.
    for (const name of [...COLLECTION_TABS, ...COLLECTION_TABS]) {
      await openTab(gm.window, name);
      await expect(
        gm.window.getByRole('tab', { name }),
      ).toHaveAttribute('aria-selected', 'true');
    }

    const seen = await gm.window.evaluate(
      () => (window as unknown as EmptyTabWatcher).__emptyTabs,
    );
    expect(seen).toEqual([]);
  });
});
