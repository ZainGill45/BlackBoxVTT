import type { WebContents } from 'electron';
import { parseExternalUrl } from '../shared/application';

/**
 * Journal and chat links must open in the user's real browser. Electron's
 * default is a second BrowserWindow with no chrome, so every window denies
 * window.open and hands allowed URLs to the shell instead.
 */
export function denyInAppWindowOpen(
  contents: Pick<WebContents, 'setWindowOpenHandler'>,
  openExternal: (url: string) => Promise<void>,
): void {
  contents.setWindowOpenHandler(({ url }) => {
    const parsed = parseExternalUrl(url);
    if (parsed) {
      void openExternal(parsed);
    }
    return { action: 'deny' };
  });
}

/**
 * The same rule for links that would replace the app's own page: a Journal
 * link must never navigate the window off the renderer it is hosted in.
 */
export function denyInAppNavigation(
  contents: Pick<WebContents, 'on'>,
  openExternal: (url: string) => Promise<void>,
  isAppUrl: (url: string) => boolean,
): void {
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    const parsed = parseExternalUrl(url);
    if (parsed) {
      void openExternal(parsed);
    }
  });
}
