import { expect, test } from '@playwright/test';
import { AppFixture, availablePort } from './support/app';
import type { LaunchedApp } from './support/app';
import {
  addPlayer,
  chatLog,
  createAndOpenCampaign,
  joinCampaign,
  openTab,
  reconnectSavedCampaign,
  sendChat,
  setHostPort,
} from './support/flows';

/**
 * The behaviours the packaged chat smoke test used to guard, driven through the
 * UI instead of through the main process. Three real Electron instances talk to
 * each other over TLS on the loopback interface, so delivery, privacy, and
 * durability are observed the way a player would observe them.
 */

const CAMPAIGN = 'Emberfall';
const PASSWORD = 'password';

test.describe('campaign chat', () => {
  const apps = new AppFixture();
  let gm: LaunchedApp;
  let alice: LaunchedApp;
  let bob: LaunchedApp;
  let port: number;

  test.beforeEach(async () => {
    port = await availablePort();

    gm = await apps.launch();
    await createAndOpenCampaign(gm.window, CAMPAIGN);
    await addPlayer(gm.window, 'Alice', PASSWORD);
    await addPlayer(gm.window, 'Bob', PASSWORD);
    // Moving the host onto a free port last means the accounts already exist
    // when the clients arrive.
    await setHostPort(gm.window, port);

    alice = await apps.launch();
    await joinCampaign(alice.window, {
      campaign: CAMPAIGN,
      password: PASSWORD,
      port,
      username: 'Alice',
    });

    bob = await apps.launch();
    await joinCampaign(bob.window, {
      campaign: CAMPAIGN,
      password: PASSWORD,
      port,
      username: 'Bob',
    });
  });

  test.afterEach(() => apps.disposeAll());

  test('delivers a public message to every participant', async () => {
    await sendChat(alice.window, 'Public from Alice');

    await expect(chatLog(alice.window).getByText('Public from Alice')).toBeVisible();
    await openTab(bob.window, 'Chat');
    await expect(chatLog(bob.window).getByText('Public from Alice')).toBeVisible();
    await openTab(gm.window, 'Chat');
    await expect(chatLog(gm.window).getByText('Public from Alice')).toBeVisible();
  });

  test('delivers a whisper to its recipient', async () => {
    await sendChat(alice.window, '/w Bob Whisper for Bob');

    await openTab(bob.window, 'Chat');
    await expect(chatLog(bob.window).getByText('Whisper for Bob')).toBeVisible();
  });

  test('does not leak a player whisper to the Game Master', async () => {
    await sendChat(alice.window, '/w Bob Private route check');
    // Receipt is the synchronization point: only after Bob has the whisper is
    // the Game Master's absence evidence of privacy rather than network delay.
    await openTab(bob.window, 'Chat');
    await expect(chatLog(bob.window).getByText('Private route check')).toBeVisible();
    await openTab(gm.window, 'Chat');
    await expect(chatLog(gm.window).getByText('Private route check')).toHaveCount(0);
  });

  test('queues a whisper for a disconnected player and replays it on reconnect', async () => {
    await bob.window.getByRole('button', { name: 'Logout' }).click();
    await expect(bob.window.getByRole('tab', { name: 'Join Campaign' })).toBeVisible();

    await sendChat(alice.window, '/w Bob Offline whisper');

    // The sender-side echo alone is not proof of durability. Reconnecting the
    // recipient in this same test closes the loop without depending on a
    // previous test's state.
    await expect(chatLog(alice.window).getByText('Offline whisper')).toBeVisible();
    await reconnectSavedCampaign(bob.window, CAMPAIGN);
    await openTab(bob.window, 'Chat');
    await expect(chatLog(bob.window).getByText('Offline whisper')).toBeVisible();
  });

  test('opens an external chat link through the shell', async () => {
    // shell.openExternal would hand the URL to a real browser, so it is
    // replaced in the main process and the calls recorded instead.
    await alice.app.evaluate(({ shell }) => {
      const calls: string[] = [];
      (globalThis as Record<string, unknown>).openExternalCalls = calls;
      shell.openExternal = async (target: string) => {
        calls.push(target);
      };
    });

    await sendChat(alice.window, 'Map is at https://example.com/path');
    const link = chatLog(alice.window).getByRole('button', {
      name: 'https://example.com/path',
    });
    await expect(link).toBeVisible();
    await link.click();

    await expect
      .poll(() =>
        alice.app.evaluate(
          () => (globalThis as Record<string, unknown>).openExternalCalls as string[],
        ),
      )
      .toEqual(['https://example.com/path']);
  });

  test('clears the timeline for every participant', async () => {
    await sendChat(alice.window, 'Line to clear');
    await openTab(gm.window, 'Chat');
    await expect(chatLog(gm.window).getByText('Line to clear')).toBeVisible();
    await openTab(bob.window, 'Chat');
    await expect(chatLog(bob.window).getByText('Line to clear')).toBeVisible();

    await sendChat(gm.window, '/clear');

    await expect(chatLog(gm.window).getByText('Line to clear')).toHaveCount(0);
    await openTab(alice.window, 'Chat');
    await expect(chatLog(alice.window).getByText('Line to clear')).toHaveCount(0);
    await openTab(bob.window, 'Chat');
    await expect(chatLog(bob.window).getByText('Line to clear')).toHaveCount(0);
  });
});

test.describe('chat durability', () => {
  const apps = new AppFixture();
  test.afterEach(() => apps.disposeAll());

  test('keeps Game Master history across a restart', async () => {
    const first = await apps.launch();
    await createAndOpenCampaign(first.window, CAMPAIGN);
    await sendChat(first.window, 'Durable line');
    await expect(chatLog(first.window).getByText('Durable line')).toBeVisible();

    // Reusing the profile is what makes this a durability test rather than a
    // second empty campaign.
    await first.app.close();
    const { window } = await apps.launchInto(first.userDataPath);

    // A fresh launch lands on Join Campaign; the saved campaigns live behind
    // the Create Campaign tab.
    await window.getByRole('tab', { name: 'Create Campaign' }).click();
    await window.getByRole('button', { name: `Open ${CAMPAIGN}` }).click();
    await openTab(window, 'Chat');
    await expect(chatLog(window).getByText('Durable line')).toBeVisible();
  });
});
