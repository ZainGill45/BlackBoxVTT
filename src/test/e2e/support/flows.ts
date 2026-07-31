import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The user-facing paths into a running session.
 *
 * These drive the same controls a person would, so a change that breaks the
 * connection or hosting flow breaks these helpers rather than being routed
 * around. Nothing here reaches into the main process.
 */

/** Creates a campaign from the connection screen and opens it as Game Master. */
export async function createAndOpenCampaign(
  window: Page,
  name: string,
): Promise<void> {
  await window.getByRole('tab', { name: 'Create Campaign' }).click();
  await window.getByLabel('Campaign name').fill(name);
  await window.getByRole('button', { name: 'Create', exact: true }).click();

  const open = window.getByRole('button', { name: `Open ${name}` });
  await expect(open).toBeVisible();
  await open.click();

  // Opening a campaign starts the host, so the play screen is the signal that
  // both the renderer and the network layer came up.
  await expect(window.getByRole('tab', { name: 'Chat' })).toBeVisible();
}

/** Moves the running host onto a known-free port and waits for it to come back. */
export async function setHostPort(window: Page, port: number): Promise<void> {
  await openTab(window, 'Settings');
  const serverSection = window.getByRole('region', { name: 'Server Management' });
  const portField = window.getByLabel('Server port');
  await portField.fill(String(port));
  await serverSection.getByRole('button', { name: 'Save' }).click();
  // The status is already Online before the switch begins, so it cannot be the
  // sole completion signal. The panel remounts with the persisted port only
  // after switchPort has bound the new listener and settings have refreshed.
  await expect(portField).toHaveValue(String(port));
  await expect(window.getByRole('img', { name: 'Server status: Online' })).toBeVisible();
}

/** Adds a player account through the User Management section. */
export async function addPlayer(
  window: Page,
  username: string,
  password: string,
): Promise<void> {
  await openTab(window, 'Settings');
  const users = window.getByRole('region', { name: 'User Management' });
  await users.getByRole('button', { name: 'Add user' }).click();
  // Every existing row carries its own "New password for <name>" reset field,
  // which a substring label match would also select.
  await users.getByLabel('New username', { exact: true }).fill(username);
  await users.getByLabel('New password', { exact: true }).fill(password);
  await users.getByRole('button', { name: 'Save' }).click();
  // The row only appears once the host has accepted the account.
  await expect(window.getByLabel(`Username for ${username}`)).toBeVisible();
}

/**
 * Joins a hosted campaign as a player: endpoint, certificate trust, then
 * credentials. Trust only appears the first time a client sees a fingerprint,
 * so it is accepted opportunistically.
 */
export async function joinCampaign(
  window: Page,
  options: {
    campaign: string;
    host?: string;
    password: string;
    port: number;
    username: string;
  },
): Promise<void> {
  const { campaign, host = '127.0.0.1', password, port, username } = options;

  await window.getByRole('tab', { name: 'Join Campaign' }).click();
  await window.getByLabel('IP address or host').fill(host);
  await window.getByLabel('Port', { exact: true }).fill(String(port));
  await window
    .getByRole('tabpanel', { name: 'Join Campaign' })
    .getByRole('button', { name: 'Connect', exact: true })
    .first()
    .click();

  const trust = window.getByRole('button', { name: 'Trust', exact: true });
  await trust.or(window.getByLabel('Username')).first().waitFor();
  if (await trust.isVisible()) {
    await trust.click();
  }

  await window.getByLabel('Username').selectOption({ label: username });
  await window.getByLabel('Password', { exact: true }).fill(password);
  await window.getByRole('button', { name: 'Save Credentials' }).click();

  // First use deliberately stops here: the credentials are saved but the client
  // stays on the connection screen. Entering play is a second, explicit step.
  await reconnectSavedCampaign(window, campaign);
}

/**
 * Enters play through a saved campaign entry, which is both the second half of
 * a first-time join and the whole of a reconnect.
 */
export async function reconnectSavedCampaign(
  window: Page,
  campaign: string,
): Promise<void> {
  await window.getByRole('tab', { name: 'Join Campaign' }).click();
  const entry = window
    .getByRole('region', { name: 'Saved campaigns' })
    .getByRole('listitem')
    .filter({ hasText: campaign });
  await entry.getByRole('button', { name: 'Connect', exact: true }).click();

  await expect(window.getByRole('tab', { name: 'Chat' })).toBeVisible();
}

/** Selects a sidebar tab and waits for it to become the active one. */
export async function openTab(window: Page, name: string): Promise<void> {
  const tab = window.getByRole('tab', { name });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** Types a chat message and sends it with Enter, as the composer expects. */
export async function sendChat(window: Page, text: string): Promise<void> {
  await openTab(window, 'Chat');
  const composer = window.getByLabel('Message');
  await composer.fill(text);
  await composer.press('Enter');
}

/** The chat log, scoped so assertions cannot match the composer's own text. */
export function chatLog(window: Page) {
  return window.getByRole('log', { name: 'Campaign chat' });
}
