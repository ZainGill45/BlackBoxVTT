import {
  BrowserWindow,
  screen,
  type BrowserWindowConstructorOptions,
  type Rectangle,
  type WebContents,
} from 'electron';
import {
  journalWindowIpcChannels,
  type DetachedCharacterContext,
  type JournalWindowEntryInput,
  type JournalWindowGeometry,
  type JournalWindowResult,
  type OpenJournalWindowInput,
} from '../shared/journalWindows';
import type { JournalManager } from './journalManager';
import type { NetworkManager } from './network/networkManager';

const DETACHED_CLOSE_TIMEOUT_MS = 5_000;
const DETACHED_LOAD_TIMEOUT_MS = 10_000;

interface DetachedCharacterWindow {
  allowClose: boolean;
  campaignId: string;
  closeRequested: boolean;
  closeTimer: NodeJS.Timeout | null;
  closed: Promise<void>;
  entryId: string;
  focusWhenReady: boolean;
  geometry: JournalWindowGeometry;
  loadTimer: NodeJS.Timeout | null;
  ready: boolean;
  resolveClosed: () => void;
  webContentsId: number;
  window: BrowserWindow;
}

interface JournalWindowManagerOptions {
  createWindow?: (
    options: BrowserWindowConstructorOptions,
  ) => BrowserWindow;
  getMainWindow: () => BrowserWindow | null;
  getWorkArea?: (mainWindow: BrowserWindow | null) => Rectangle;
  journalManager: JournalManager;
  loadWindow: (window: BrowserWindow) => Promise<void> | void;
  networkManager: NetworkManager;
  preloadPath: string;
}

function failure<T>(
  code: 'not_found' | 'permission_denied' | 'unavailable',
  message: string,
): JournalWindowResult<T> {
  return { error: { code, message }, ok: false };
}

function keyFor(campaignId: string, entryId: string): string {
  return `${campaignId}:${entryId}`;
}

export class JournalWindowManager {
  private readonly createWindow: NonNullable<
    JournalWindowManagerOptions['createWindow']
  >;
  private readonly getMainWindow: () => BrowserWindow | null;
  private readonly getWorkArea: (
    mainWindow: BrowserWindow | null,
  ) => Rectangle;
  private readonly journalManager: JournalManager;
  private readonly loadWindow: JournalWindowManagerOptions['loadWindow'];
  private readonly networkManager: NetworkManager;
  private readonly preloadPath: string;
  private readonly windows = new Map<string, DetachedCharacterWindow>();
  private readonly windowsByContents = new Map<number, DetachedCharacterWindow>();

  constructor({
    createWindow = (options) => new BrowserWindow(options),
    getMainWindow,
    getWorkArea = (mainWindow) => {
      const display = mainWindow && !mainWindow.isDestroyed()
        ? screen.getDisplayMatching(mainWindow.getBounds())
        : screen.getPrimaryDisplay();
      return display.workArea;
    },
    journalManager,
    loadWindow,
    networkManager,
    preloadPath,
  }: JournalWindowManagerOptions) {
    this.createWindow = createWindow;
    this.getMainWindow = getMainWindow;
    this.getWorkArea = getWorkArea;
    this.journalManager = journalManager;
    this.loadWindow = loadWindow;
    this.networkManager = networkManager;
    this.preloadPath = preloadPath;
  }

  async openCharacter(
    input: OpenJournalWindowInput,
  ): Promise<JournalWindowResult<'focused' | 'opened'>> {
    const key = keyFor(input.campaignId, input.entryId);
    const existing = this.windows.get(key);
    if (existing && !existing.window.isDestroyed()) {
      this.focusRecord(existing);
      return { ok: true, value: 'focused' };
    }

    const system = this.networkManager.getActiveCampaignSystem(
      input.campaignId,
    );
    if (!system) {
      return failure(
        'unavailable',
        'The campaign is no longer active.',
      );
    }
    const result = await this.journalManager.getEntry(input);
    if (!result.ok) {
      return failure(
        result.error.code === 'not_found'
          ? 'not_found'
          : result.error.code === 'permission_denied'
            ? 'permission_denied'
            : 'unavailable',
        result.error.message,
      );
    }
    if (result.value.kind !== 'system' || !result.value.capabilities.view) {
      return failure(
        'permission_denied',
        'This Journal entry cannot be opened in a detached window.',
      );
    }

    const workArea = this.getWorkArea(this.getMainWindow());
    const contentWidth = Math.round(input.geometry.contentWidth);
    const contentHeight = Math.round(input.geometry.contentHeight);
    const x = Math.round(
      workArea.x + (workArea.width - contentWidth) / 2,
    );
    const y = Math.round(
      workArea.y + (workArea.height - contentHeight) / 2,
    );
    const window = this.createWindow({
      alwaysOnTop: true,
      autoHideMenuBar: true,
      backgroundColor: '#0d0d0d',
      fullscreenable: false,
      height: contentHeight,
      maximizable: false,
      minimizable: true,
      resizable: false,
      show: false,
      title: result.value.name,
      useContentSize: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: this.preloadPath,
        sandbox: true,
      },
      width: contentWidth,
      x,
      y,
    });
    // Windows can clamp the constructor dimensions. Reapply the measured modal
    // width, but cap the content height when the complete native frame would
    // reach into the taskbar's reserved work-area space.
    window.setContentSize(contentWidth, contentHeight, false);
    const requestedBounds = window.getBounds();
    const [, requestedContentHeight] = window.getContentSize();
    const frameHeight = Math.max(
      0,
      requestedBounds.height - requestedContentHeight,
    );
    const fittedContentHeight = Math.min(
      contentHeight,
      Math.max(1, workArea.height - frameHeight),
    );
    if (fittedContentHeight !== requestedContentHeight) {
      window.setContentSize(contentWidth, fittedContentHeight, false);
    }
    const [actualContentWidth, actualContentHeight] = window.getContentSize();
    const actualBounds = window.getBounds();
    window.setPosition(
      Math.round(workArea.x + (workArea.width - actualBounds.width) / 2),
      Math.round(workArea.y + (workArea.height - actualBounds.height) / 2),
      false,
    );
    window.setAlwaysOnTop(true, 'screen-saver');
    let resolveClosed: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const record: DetachedCharacterWindow = {
      allowClose: false,
      campaignId: input.campaignId,
      closeRequested: false,
      closeTimer: null,
      closed,
      entryId: input.entryId,
      focusWhenReady: false,
      geometry: {
        contentHeight: actualContentHeight,
        contentWidth: actualContentWidth,
        rootFontSize: input.geometry.rootFontSize,
      },
      loadTimer: null,
      ready: false,
      resolveClosed,
      webContentsId: window.webContents.id,
      window,
    };
    this.windows.set(key, record);
    this.windowsByContents.set(record.webContentsId, record);

    window.on('close', (event) => {
      if (record.allowClose) return;
      event.preventDefault();
      void this.requestClose(record);
    });
    window.on('closed', () => this.release(record));
    window.webContents.on('did-fail-load', (_event, code, _message, _url, mainFrame) => {
      if (mainFrame && code !== -3) this.forceClose(record);
    });
    window.webContents.on('page-title-updated', (event) => {
      event.preventDefault();
    });
    record.loadTimer = setTimeout(
      () => this.forceClose(record),
      DETACHED_LOAD_TIMEOUT_MS,
    );

    void Promise.resolve(this.loadWindow(window)).catch(() => {
      this.forceClose(record);
    });
    return { ok: true, value: 'opened' };
  }

  focusCharacter(input: JournalWindowEntryInput): JournalWindowResult<boolean> {
    if (!this.networkManager.getActiveCampaignSystem(input.campaignId)) {
      return failure('unavailable', 'The campaign is no longer active.');
    }
    const record = this.windows.get(keyFor(input.campaignId, input.entryId));
    if (!record || record.window.isDestroyed()) {
      return { ok: true, value: false };
    }
    this.focusRecord(record);
    return { ok: true, value: true };
  }

  async bootstrap(
    sender: WebContents,
  ): Promise<JournalWindowResult<DetachedCharacterContext>> {
    const record = this.windowsByContents.get(sender.id);
    if (!record || sender !== record.window.webContents) {
      return failure('permission_denied', 'This detached window is not authorized.');
    }
    const system = this.networkManager.getActiveCampaignSystem(
      record.campaignId,
    );
    if (!system) {
      return failure('unavailable', 'The campaign is no longer active.');
    }
    const result = await this.journalManager.getEntry({
      campaignId: record.campaignId,
      entryId: record.entryId,
    });
    if (!result.ok) {
      return failure(
        result.error.code === 'not_found'
          ? 'not_found'
          : result.error.code === 'permission_denied'
            ? 'permission_denied'
            : 'unavailable',
        result.error.message,
      );
    }
    if (result.value.kind !== 'system' || !result.value.capabilities.view) {
      return failure('permission_denied', 'This Character is not available.');
    }
    return {
      ok: true,
      value: {
        campaignId: record.campaignId,
        entry: result.value,
        geometry: { ...record.geometry },
        system,
      },
    };
  }

  markReady(sender: WebContents): void {
    const record = this.windowsByContents.get(sender.id);
    if (!record || sender !== record.window.webContents) return;
    record.ready = true;
    if (record.loadTimer) {
      clearTimeout(record.loadTimer);
      record.loadTimer = null;
    }
    if (!record.window.isDestroyed()) {
      record.window.show();
      if (record.focusWhenReady) record.window.focus();
    }
  }

  setTitle(sender: WebContents, title: string): void {
    const record = this.windowsByContents.get(sender.id);
    if (!record || sender !== record.window.webContents) return;
    if (!record.window.isDestroyed()) record.window.setTitle(title);
  }

  confirmClose(sender: WebContents): void {
    const record = this.windowsByContents.get(sender.id);
    if (!record || sender !== record.window.webContents) return;
    this.finishClose(record);
  }

  isAllowedSender(sender: WebContents): boolean {
    const record = this.windowsByContents.get(sender.id);
    return Boolean(record && sender === record.window.webContents);
  }

  getWebContents(): WebContents[] {
    return [...this.windows.values()].flatMap((record) =>
      record.window.isDestroyed() ? [] : [record.window.webContents],
    );
  }

  async closeCampaign(campaignId: string): Promise<void> {
    await Promise.all(
      [...this.windows.values()]
        .filter((record) => record.campaignId === campaignId)
        .map((record) => this.requestClose(record)),
    );
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.windows.values()].map((record) => this.requestClose(record)),
    );
  }

  private focusRecord(record: DetachedCharacterWindow): void {
    if (record.window.isDestroyed()) return;
    if (!record.ready) {
      record.focusWhenReady = true;
      return;
    }
    if (record.window.isMinimized()) record.window.restore();
    if (!record.window.isVisible()) record.window.show();
    record.window.focus();
  }

  private requestClose(record: DetachedCharacterWindow): Promise<void> {
    if (record.window.isDestroyed()) return record.closed;
    if (!record.closeRequested) {
      record.closeRequested = true;
      record.window.webContents.send(
        journalWindowIpcChannels.closeRequested,
      );
      record.closeTimer = setTimeout(
        () => this.forceClose(record),
        DETACHED_CLOSE_TIMEOUT_MS,
      );
    }
    return record.closed;
  }

  private finishClose(record: DetachedCharacterWindow): void {
    record.allowClose = true;
    if (record.closeTimer) {
      clearTimeout(record.closeTimer);
      record.closeTimer = null;
    }
    if (!record.window.isDestroyed()) record.window.close();
  }

  private forceClose(record: DetachedCharacterWindow): void {
    record.allowClose = true;
    if (!record.window.isDestroyed()) record.window.destroy();
    else this.release(record);
  }

  private release(record: DetachedCharacterWindow): void {
    if (record.closeTimer) clearTimeout(record.closeTimer);
    if (record.loadTimer) clearTimeout(record.loadTimer);
    this.windows.delete(keyFor(record.campaignId, record.entryId));
    this.windowsByContents.delete(record.webContentsId);
    record.resolveClosed();
  }
}
