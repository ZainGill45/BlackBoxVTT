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

async function trackChatMessageSounds(app: LaunchedApp) {
  await app.window.evaluate(() => {
    const soundWindow = window as typeof window & {
      __chatMessageSoundCount?: number;
    };
    soundWindow.__chatMessageSoundCount = 0;
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.src.includes('ChatMessageSound')) {
        soundWindow.__chatMessageSoundCount =
          (soundWindow.__chatMessageSoundCount ?? 0) + 1;
      }
      return originalPlay.call(this);
    };
  });
}

async function chatMessageSoundCount(app: LaunchedApp) {
  return app.window.evaluate(
    () =>
      (window as typeof window & { __chatMessageSoundCount?: number })
        .__chatMessageSoundCount ?? 0,
  );
}

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
    await Promise.all(
      [alice, bob, gm].map((app) => trackChatMessageSounds(app)),
    );
    await sendChat(alice.window, 'Public from Alice');

    await expect(chatLog(alice.window).getByText('Public from Alice')).toBeVisible();
    await openTab(bob.window, 'Chat');
    await expect(chatLog(bob.window).getByText('Public from Alice')).toBeVisible();
    await openTab(gm.window, 'Chat');
    await expect(chatLog(gm.window).getByText('Public from Alice')).toBeVisible();
    for (const app of [alice, bob, gm]) {
      await expect.poll(() => chatMessageSoundCount(app)).toBe(1);
    }
  });

  test('recalls session submissions with Up and Down in the composer', async () => {
    await sendChat(gm.window, 'History first');
    await expect(chatLog(gm.window).getByText('History first')).toBeVisible();
    await sendChat(gm.window, 'History second');
    await expect(chatLog(gm.window).getByText('History second')).toBeVisible();

    const composer = gm.window.getByLabel('Message');
    await composer.press('ArrowUp');
    await expect(composer).toHaveValue('History second');
    await composer.press('ArrowUp');
    await expect(composer).toHaveValue('History first');
    await composer.press('ArrowDown');
    await expect(composer).toHaveValue('History second');
    await composer.press('ArrowDown');
    await expect(composer).toHaveValue('');
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

  test('renders reference-scale d20, d6, and d4 roll-card geometry', async () => {
    await sendChat(
      gm.window,
      '/roll Fixture: Reference Dice\nD20: 1d20*0+20\nD6: 1d6*0+7\nD4: 1d4*0+15',
    );
    const log = chatLog(gm.window);
    const icons = [
      ['d20', 'Total 20'],
      ['d6', 'Total 7'],
      ['d4', 'Total 15'],
    ] as const;
    for (const [shape, name] of icons) {
      const icon = log.getByRole('img', { name });
      await expect(icon).toBeVisible();
      await expect(icon).toHaveAttribute('data-shape', shape);
      await expect(icon).toHaveAttribute('viewBox', '0 0 64 64');
      const box = await icon.boundingBox();
      expect(box?.width).toBeGreaterThan(40);
      expect(box?.width).toBeLessThan(72);
      expect(Math.abs((box?.width ?? 0) - (box?.height ?? 0))).toBeLessThan(2);
    }
    const crop = await log.screenshot();
    expect(crop.byteLength).toBeGreaterThan(1_000);

    await sendChat(gm.window, '/r 4d4 + 4 + 2d8 + 10');
    const heading = log.getByText('4D4 + 4 + 2D8 + 10', { exact: true });
    const revealAudit = log.getByRole('button', {
      name: 'Show rolls for 4d4 + 4 + 2d8 + 10',
    });
    await expect(revealAudit).toHaveText('Show Rolls');
    expect(
      await revealAudit.evaluate((element) => {
        const style = getComputedStyle(element);
        return [
          style.alignItems,
          style.alignSelf,
          style.paddingTop,
          style.paddingBottom,
        ];
      }),
    ).toEqual(['center', 'flex-start', '0px', '0px']);
    const sectionBody = heading.locator('xpath=../..');
    const collapsedBodyBox = await sectionBody.boundingBox();
    const collapsedHeadingBox = await heading.boundingBox();
    const revealBox = await revealAudit.boundingBox();
    expect(revealBox!.width).toBeLessThan(collapsedBodyBox!.width / 2);
    expect(
      Math.abs(
        (collapsedHeadingBox!.y - collapsedBodyBox!.y) -
          (collapsedBodyBox!.y + collapsedBodyBox!.height - revealBox!.y - revealBox!.height),
      ),
    ).toBeLessThan(1);
    await revealAudit.click();
    const detailBadge = log.getByText('4d4', { exact: true }).locator('..');
    await expect(heading).toBeVisible();
    await expect(detailBadge).toBeVisible();
    expect(await heading.evaluate((element) => getComputedStyle(element).border)).toBe(
      await detailBadge.evaluate((element) => getComputedStyle(element).border),
    );
    expect((await detailBadge.boundingBox())!.height).toBe(revealBox!.height);
    const expandedBodyBox = await sectionBody.boundingBox();
    const expandedHeadingBox = await heading.boundingBox();
    const auditBox = await heading
      .locator('xpath=../following-sibling::div[1]')
      .boundingBox();
    expect(
      Math.abs(
        (expandedHeadingBox!.y - expandedBodyBox!.y) -
          (expandedBodyBox!.y + expandedBodyBox!.height - auditBox!.y - auditBox!.height),
      ),
    ).toBeLessThan(1);
    const auditTerms = heading.locator('xpath=../following-sibling::div[1]').locator(
      ':scope > span',
    );
    await expect(auditTerms).toHaveCount(7);
    expect(
      await auditTerms.evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).borderStyle),
      ),
    ).toEqual(Array.from({ length: 7 }, () => 'solid'));
  });

  test('keeps critical success and failure rails neutral', async () => {
    await sendChat(
      gm.window,
      '/roll Critical Rails\nSuccess: 1d6cs>=1\nFailure: 1d6cf<=6',
    );
    const log = chatLog(gm.window);
    for (const [label, flag, outcome] of [
      ['SUCCESS', 'crit', /^(?:mixed|success)$/],
      ['FAILURE', 'crit-fail', /^(?:failure|mixed)$/],
    ] as const) {
      const section = log.getByText(label, { exact: true }).locator('xpath=../../..');
      await expect(section).toHaveAttribute('data-outcome', outcome);
      await section.getByRole('button', { name: /Show rolls/i }).click();
      await expect(section.getByText(flag, { exact: true })).toBeVisible();
      const [railColor, neutralColor] = await section.evaluate((element) => [
        getComputedStyle(element).borderLeftColor,
        getComputedStyle(document.body).color,
      ]);
      expect(railColor).toBe(neutralColor);
    }
  });

  test('routes a roll whisper only to its sender and recipient', async () => {
    await sendChat(alice.window, '/w Bob /r 1d20*0+20');
    await expect(
      chatLog(alice.window).getByRole('img', { name: 'Total 20' }),
    ).toBeVisible();
    await openTab(bob.window, 'Chat');
    await expect(
      chatLog(bob.window).getByRole('img', { name: 'Total 20' }),
    ).toBeVisible();
    await openTab(gm.window, 'Chat');
    await expect(
      chatLog(gm.window).getByRole('img', { name: 'Total 20' }),
    ).toHaveCount(0);
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

  test('replays an immutable roll result without rolling again after restart', async () => {
    const first = await apps.launch();
    await createAndOpenCampaign(first.window, CAMPAIGN);
    await sendChat(first.window, '/r 1d20*0+20');
    await expect(
      chatLog(first.window).getByRole('img', { name: 'Total 20' }),
    ).toBeVisible();
    await first.app.close();

    const { window } = await apps.launchInto(first.userDataPath);
    await window.getByRole('tab', { name: 'Create Campaign' }).click();
    await window.getByRole('button', { name: `Open ${CAMPAIGN}` }).click();
    await openTab(window, 'Chat');
    await expect(
      chatLog(window).getByRole('img', { name: 'Total 20' }),
    ).toBeVisible();
  });
});
