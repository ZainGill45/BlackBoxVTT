import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  powerMonitor,
  protocol,
  safeStorage,
  shell,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';
import { rm, writeFile } from 'node:fs/promises';
import { format } from 'node:util';
import { tmpdir } from 'node:os';
import { applicationIpcChannels } from './shared/application';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerApplicationIpcHandlers } from './main/applicationIpc';
import {
  denyInAppNavigation,
  denyInAppWindowOpen,
} from './main/externalNavigation';
import { registerAssetIpcHandlers } from './main/assetIpc';
import { AssetManager } from './main/assetManager';
import { AssetPreviewRegistry } from './main/assetPreviewRegistry';
import { CampaignArchiveService } from './main/campaignArchiveService';
import { registerCampaignIpcHandlers } from './main/campaignIpc';
import { CampaignRepository } from './main/campaignRepository';
import { CampaignRuntimeRegistry } from './main/campaignRuntime';
import { CampaignWorkspaceRegistry } from './main/campaignWorkspace';
import { registerJournalIpcHandlers } from './main/journalIpc';
import { JournalManager } from './main/journalManager';
import { registerJournalWindowIpcHandlers } from './main/journalWindowIpc';
import { JournalWindowManager } from './main/journalWindowManager';
import { ConnectionHistoryRepository } from './main/network/connectionHistoryRepository';
import { NetworkManager } from './main/network/networkManager';
import { registerNetworkIpcHandlers } from './main/networkIpc';
import { registerSceneIpcHandlers } from './main/sceneIpc';
import { SceneManager } from './main/sceneManager';
import { configureInstanceProfile } from './main/instanceProfile';
import { DiagnosticService } from './main/diagnostics/diagnosticService';
import { registerDiagnosticIpcHandlers } from './main/diagnostics/diagnosticIpc';
import { createDiagnosticIpcMain } from './main/diagnostics/diagnosticIpcMain';
import { diagnosticIpcChannels } from './shared/diagnostics';

if (started) {
  app.quit();
}

const instanceProfile = configureInstanceProfile(app, process.argv.slice(1));
const mainArgument = (name: string) => {
  const prefix = `${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length) ?? null;
};
const requestedOwnerPid = Number(mainArgument('--dev-owner-pid'));
const developmentOwnerPid = Number.isSafeInteger(requestedOwnerPid) && requestedOwnerPid > 0
  ? requestedOwnerPid
  : null;
const requestedSessionFile = mainArgument('--dev-session-file');
const developmentSessionFile = requestedSessionFile &&
  path.dirname(path.resolve(requestedSessionFile)) === path.resolve(tmpdir()) &&
  path.basename(requestedSessionFile).startsWith('blackboxvtt-development-')
  ? path.resolve(requestedSessionFile)
  : null;
const diagnostics = new DiagnosticService({
  development: instanceProfile.environment !== 'production',
  instance: {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    environment: instanceProfile.environment,
    label: instanceProfile.label,
    platform: process.platform,
    processId: process.pid,
    profileKind: instanceProfile.profileKind,
  },
  redactRoots: [instanceProfile.userDataPath, app.getPath('home')],
});
const originalWarn = console.warn.bind(console);
const originalError = console.error.bind(console);
console.warn = (...values: unknown[]) => {
  originalWarn(...values);
  diagnostics.record('main', {
    category: 'console',
    level: 'warn',
    message: format(...values),
  });
};
console.error = (...values: unknown[]) => {
  originalError(...values);
  diagnostics.record('main', {
    category: 'console',
    level: 'error',
    message: format(...values),
  });
};
process.on('uncaughtExceptionMonitor', (error) => {
  diagnostics.record('main', {
    category: 'process',
    level: 'error',
    message: error.message,
    stack: error.stack,
  });
});
process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(format(reason));
  diagnostics.record('main', {
    category: 'process',
    level: 'error',
    message: `Unhandled rejection: ${error.message}`,
    stack: error.stack,
  });
});
diagnostics.record('main', {
  category: 'application',
  kind: 'system',
  level: 'info',
  message: `Starting ${instanceProfile.label} instance.`,
});

/**
 * Whether this process owns the application. Startup is slow enough that the
 * icon can be clicked several times before anything appears on screen, and
 * without this every one of those clicks would boot a whole second copy.
 */
const isPrimaryInstance = !instanceProfile.error && app.requestSingleInstanceLock();

if (!isPrimaryInstance) {
  app.quit();
}

protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      bypassCSP: false,
      corsEnabled: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
    scheme: 'blackbox-asset',
  },
]);

/**
 * Backstop for revealing the window when the renderer never reports ready. The
 * window is invisible until then, so a renderer that dies would otherwise leave
 * the app running with nothing on screen and no way to reach it.
 */
const REVEAL_TIMEOUT_MS = 10_000;

let mainWindow: BrowserWindow | null = null;
let revealTimer: NodeJS.Timeout | null = null;
let networkManager: NetworkManager | null = null;
let assetManager: AssetManager | null = null;
let sceneManager: SceneManager | null = null;
let journalManager: JournalManager | null = null;
let journalWindowManager: JournalWindowManager | null = null;
const assetPreviewRegistry = new AssetPreviewRegistry();
let shutdownComplete = false;
let shutdownPromise: Promise<void> | null = null;
let ownerMonitor: ReturnType<typeof setInterval> | null = null;
let rendererHealthyTimer: ReturnType<typeof setTimeout> | null = null;
let rendererReloadAttempted = false;
let recoveryScreenVisible = false;
let openConsoleAfterLoad = false;
let mainNavigationPermitted = false;

const requestQuit = () => {
  if (shutdownComplete) {
    app.quit();
    return;
  }
  if (ownerMonitor) {
    clearInterval(ownerMonitor);
    ownerMonitor = null;
  }
  shutdownPromise ??= (journalWindowManager?.closeAll() ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => networkManager?.shutdown())
    .catch(() => undefined)
    .then(() => {
      assetPreviewRegistry.clear();
      shutdownComplete = true;
      const cleanup = instanceProfile.cleanupPath
        ? rm(instanceProfile.cleanupPath, { force: true, recursive: true })
          .catch(() => undefined)
        : Promise.resolve();
      if (developmentSessionFile) {
        void rm(developmentSessionFile, { force: true }).catch(() => undefined);
      }
      void cleanup.then(() => app.quit());
    });
};

/**
 * Puts the window on screen. Idempotent: the renderer's ready signal, a failed
 * load, and the timeout can all race to call it.
 */
const revealMainWindow = () => {
  if (revealTimer) {
    clearTimeout(revealTimer);
    revealTimer = null;
  }

  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    mainWindow.show();
  }
};

const loadMainRenderer = (window: BrowserWindow) => {
  recoveryScreenVisible = false;
  mainNavigationPermitted = true;
  const load = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    : window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  return load.finally(() => {
    mainNavigationPermitted = false;
  });
};

const showRendererRecovery = (
  window: BrowserWindow,
  summary: string,
) => {
  recoveryScreenVisible = true;
  const safeSummary = summary
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  mainNavigationPermitted = true;
  return window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><title>BlackBox VTT renderer failed</title>
<style>html,body{height:100%;margin:0;background:#0d0d0d;color:#f0f0f0;font:16px system-ui}main{height:100%;display:grid;place-content:center;gap:16px;text-align:center}button{padding:10px 18px}</style></head>
<body><main><h1>The application renderer stopped</h1><p>${safeSummary}</p><div><button id="retry">Retry renderer</button> <button id="quit">Quit application</button></div></main>
<script>document.getElementById('retry').onclick=()=>globalThis['black'+'Box'].application.retryRenderer();document.getElementById('quit').onclick=()=>globalThis['black'+'Box'].application.quit();</script></body></html>`)}`).finally(() => {
    mainNavigationPermitted = false;
  });
};

const retryMainRenderer = () => {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  rendererReloadAttempted = false;
  openConsoleAfterLoad = true;
  void loadMainRenderer(window);
};

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    // Only ever seen if the backstop reveals a window that failed to render;
    // matches --color-canvas so even that case is not a white flash.
    backgroundColor: '#0d0d0d',
    fullscreen: !instanceProfile.windowed,
    // The window is not shown on creation. It appears once the renderer reports
    // the connection screen has real data, so it is never on screen while blank
    // or half-loaded.
    show: false,
    title: instanceProfile.environment === 'development'
      ? `BlackBox VTT [${instanceProfile.label}]`
      : 'BlackBox VTT',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
    },
  });

  // A renderer that cannot load will never report ready, and a permanently
  // invisible window would leave no way to see the failure. Aborted navigations
  // (-3) and subframes are not real failures.
  denyInAppWindowOpen(
    mainWindow.webContents,
    (url) => shell.openExternal(url),
  );
  denyInAppNavigation(
    mainWindow.webContents,
    (url) => shell.openExternal(url),
    (url) => mainNavigationPermitted || url === mainWindow.webContents.getURL(),
  );
  /*
   * Windows spends Alt on the native menu, so Alt+click never arrives as a
   * modified click in the Journal. No menu, and the main process tells the
   * renderer when Alt is held.
   */
  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setIgnoreMenuShortcuts(true);
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (
      input.type === 'keyDown' &&
      (input.key === 'F12' ||
        (input.control && input.shift && input.key.toLowerCase() === 'i'))
    ) {
      _event.preventDefault();
      mainWindow.webContents.toggleDevTools();
      return;
    }
    if (
      input.key !== 'Alt' &&
      input.code !== 'AltLeft' &&
      input.code !== 'AltRight'
    ) {
      return;
    }
    mainWindow.webContents.send(
      applicationIpcChannels.altHeld,
      input.type === 'keyDown' && !input.control,
    );
  });
  // Alt+Tab releases Alt somewhere else, so the key-up never lands here. A
  // blurred window has no held modifiers as far as the Journal is concerned.
  mainWindow.on('blur', () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(applicationIpcChannels.altHeld, false);
  });
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, _description, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        revealMainWindow();
      }
    },
  );
  mainWindow.webContents.on('did-finish-load', () => {
    if (recoveryScreenVisible) return;
    if (rendererHealthyTimer) clearTimeout(rendererHealthyTimer);
    rendererHealthyTimer = setTimeout(() => {
      rendererReloadAttempted = false;
    }, 30_000);
    if (openConsoleAfterLoad) {
      openConsoleAfterLoad = false;
      mainWindow.webContents.send(diagnosticIpcChannels.openRequested);
    }
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (rendererHealthyTimer) {
      clearTimeout(rendererHealthyTimer);
      rendererHealthyTimer = null;
    }
    diagnostics.record('main', {
      category: 'renderer.lifecycle',
      details: { exitCode: details.exitCode, reason: details.reason },
      kind: 'system',
      level: 'error',
      message: `Renderer stopped: ${details.reason}.`,
    });
    if (!rendererReloadAttempted) {
      rendererReloadAttempted = true;
      openConsoleAfterLoad = true;
      void loadMainRenderer(mainWindow);
      return;
    }
    void showRendererRecovery(
      mainWindow,
      `The renderer stopped twice (${details.reason}, exit ${details.exitCode}).`,
    );
  });

  void loadMainRenderer(mainWindow);

  return mainWindow;
};

// Every extra launch attempt is handed straight back to the window already
// running, so a spammed icon surfaces the one instance instead of stacking up.
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  // Only if the first launch has finished — otherwise this would put the
  // half-loaded window on screen, which is what revealWhenReady prevents.
  if (mainWindow.isVisible()) {
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  // A losing instance has already called app.quit(); it must not go on to build
  // repositories or open a window before the quit lands.
  if (!isPrimaryInstance) {
    return;
  }
  const campaignRootDirectory = path.join(
    app.getPath('userData'),
    'data',
    'campaigns',
  );
  const campaignRepository = new CampaignRepository({
    rootDirectory: campaignRootDirectory,
    trashItem: (targetPath) => shell.trashItem(targetPath),
  });
  const campaignArchives = new CampaignArchiveService({
    campaigns: campaignRepository,
    dialogs: {
      chooseExportPath: async (defaultFileName) => {
        const options: SaveDialogOptions = {
          buttonLabel: 'Export',
          defaultPath: defaultFileName,
          filters: [
            {
              extensions: ['blackbox-campaign'],
              name: 'BlackBox Campaign',
            },
          ],
          title: 'Export Campaign',
        };
        const result = mainWindow
          ? await dialog.showSaveDialog(mainWindow, options)
          : await dialog.showSaveDialog(options);
        return result.canceled ? null : result.filePath ?? null;
      },
      chooseImportPath: async () => {
        const options: OpenDialogOptions = {
          buttonLabel: 'Import',
          filters: [
            {
              extensions: ['blackbox-campaign'],
              name: 'BlackBox Campaign',
            },
          ],
          properties: ['openFile'],
          title: 'Import Campaign',
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        return result.canceled ? null : result.filePaths[0] ?? null;
      },
    },
    rootDirectory: campaignRootDirectory,
    sourceRelease: app.getVersion(),
  });

  const historyRepository = new ConnectionHistoryRepository(
    path.join(app.getPath('userData'), 'data', 'application.sqlite'),
    {
      decryptStringAsync: (encrypted) =>
        safeStorage.decryptStringAsync(encrypted),
      encryptStringAsync: (value) => safeStorage.encryptStringAsync(value),
    },
  );
  const workspaces = new CampaignWorkspaceRegistry({
    campaignRepository,
    trashItem: (targetPath) => shell.trashItem(targetPath),
  });
  const runtimes = new CampaignRuntimeRegistry(workspaces);
  const manager = new NetworkManager({
    assetCacheRoot: path.join(app.getPath('userData'), 'data', 'asset-cache'),
    historyRepository,
    runtimes,
  });
  networkManager = manager;
  const applicationIpc = createDiagnosticIpcMain(ipcMain, diagnostics);
  assetManager = new AssetManager({
    getWindow: () => mainWindow,
    previewRegistry: assetPreviewRegistry,
    runtimes,
  });
  sceneManager = new SceneManager({
    runtimes,
  });
  journalManager = new JournalManager(runtimes);
  diagnostics.registerProvider('network', async () => {
    const context = diagnostics.snapshot().context;
    const status = networkManager?.getHostStatus();
    const settings = context.campaignId && networkManager
      ? await networkManager.getServerSettings(context.campaignId)
      : null;
    const users = settings?.ok ? settings.value.users : [];
    return {
      clientState: context.clientState ?? null,
      connectedParticipants: instanceProfile.environment === 'development'
        ? users
          .filter((user) => user.connected)
          .map(({ id, username }) => ({ id, username }))
        : users.filter((user) => user.connected).length,
      host: status
        ? {
          boundFamilies: status.boundFamilies,
          connectedPlayerCount: status.connectedPlayerCount,
          effectivePort: status.effectivePort,
          state: status.state,
          ...(instanceProfile.environment === 'development'
            ? {
              localAddresses: status.localAddresses,
              publicAddresses: status.publicAddresses,
            }
            : {}),
        }
        : null,
      transportRecovery: {
        ownerProcessMonitored: Boolean(developmentOwnerPid),
        powerResumeRetryEnabled: true,
      },
      updateRates: settings?.ok
        ? { transformPreviewPerSecond: settings.value.transformPreviewRate ?? null }
        : null,
    };
  });
  diagnostics.registerProvider('campaign', async () => {
    const context = diagnostics.snapshot().context;
    if (!context.campaignId) return { state: 'not_open' };
    const runtime = await runtimes.resolve(context.campaignId);
    return runtime
      ? {
        campaignId: runtime.campaignId,
        kind: runtime.kind,
        system: runtime.system,
      }
      : { campaignId: context.campaignId, state: 'unavailable' };
  });
  diagnostics.registerProvider('persistence', async (input) => {
    const context = diagnostics.snapshot().context;
    if (!context.campaignId) return { state: 'not_open' };
    const runtime = await runtimes.resolve(context.campaignId);
    if (!runtime) return { state: 'unavailable' };
    if (runtime.kind === 'joined') {
      return { kind: 'remote_cache', state: 'available' };
    }
    return {
      campaignId: runtime.campaignId,
      check: input.check
        ? runtime.workspace.database.checkIntegrity()
          ? 'ok'
          : 'failed'
        : 'validated_on_open',
      directory: runtime.workspace.directory,
      kind: 'campaign_sqlite',
    };
  });
  diagnostics.registerProvider('assets', async () => {
    const campaignId = diagnostics.snapshot().context.campaignId;
    if (!campaignId || !assetManager) return { state: 'not_open' };
    const result = await assetManager.list(campaignId);
    if (!result.ok) return { error: result.error.code, state: 'unavailable' };
    return {
      available: result.value.filter((asset) => asset.available).length,
      byKind: Object.fromEntries(
        ['audio', 'document', 'image'].map((kind) => [
          kind,
          result.value.filter((asset) => asset.kind === kind).length,
        ]),
      ),
      highestRevision: Math.max(0, ...result.value.map((asset) => asset.revision)),
      total: result.value.length,
      unavailable: result.value.filter((asset) => !asset.available).length,
    };
  });
  diagnostics.registerProvider('scenes', async (input) => {
    const campaignId = diagnostics.snapshot().context.campaignId;
    if (!campaignId || !sceneManager) return { state: 'not_open' };
    const result = await sceneManager.list(campaignId);
    if (!result.ok) return { error: result.error.code, state: 'unavailable' };
    return input.content
      ? result.value
      : {
        activeSceneId: result.value.activeSceneId,
        revision: result.value.revision,
        scenes: result.value.scenes.map((scene) => ({
          id: scene.id,
          name: scene.name,
          revision: scene.revision,
        })),
      };
  });
  diagnostics.registerProvider('journal', async (input) => {
    const campaignId = diagnostics.snapshot().context.campaignId;
    if (!campaignId || !journalManager) return { state: 'not_open' };
    const result = await journalManager.list(campaignId);
    if (!result.ok) return { error: result.error.code, state: 'unavailable' };
    return input.content
      ? result.value
      : {
        entries: result.value.entries.map((entry) => ({
          capabilities: entry.capabilities,
          id: entry.id,
          kind: entry.kind,
          name: entry.name,
          revision: entry.revision,
        })),
        revision: result.value.revision,
      };
  });
  journalWindowManager = new JournalWindowManager({
    getMainWindow: () => mainWindow,
    journalManager,
    loadWindow: (window) => {
      if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        return window.loadURL(
          new URL(
            'detached-character.html',
            MAIN_WINDOW_VITE_DEV_SERVER_URL,
          ).toString(),
        );
      }
      return window.loadFile(
        path.join(
          __dirname,
          `../renderer/${MAIN_WINDOW_VITE_NAME}/detached-character.html`,
        ),
      );
    },
    networkManager,
    preloadPath: path.join(__dirname, 'detachedCharacterPreload.js'),
  });
  journalManager.on('local-changed', (event: {
    campaignId: string;
    entryId?: string;
    pageId?: string;
    type: 'content' | 'deleted' | 'permissions' | 'structure';
  }) => {
    void networkManager?.notifyJournalChanged(event);
    if (event.type === 'content' || event.type === 'deleted') {
      void sceneManager?.notifyChanged(event.campaignId);
    }
  });
  networkManager.on('journal-changed', (event) =>
    journalManager?.notifyRemoteChanged(event),
  );
  networkManager.on('client-state-changed', (event: { state: string }) => {
    diagnostics.updateContext({ clientState: event.state });
    diagnostics.record('main', {
      category: 'network.client',
      details: { state: event.state },
      kind: 'system',
      level: 'info',
      message: `Client state changed to ${event.state}.`,
    });
  });
  networkManager.on('host-status-changed', (status) => {
    diagnostics.updateContext({ hostState: status.state });
    diagnostics.record('main', {
      category: 'network.host',
      details: {
        connectedPlayerCount: status.connectedPlayerCount,
        effectivePort: status.effectivePort,
        state: status.state,
      },
      kind: 'system',
      level: 'info',
      message: `Host state changed to ${status.state}.`,
    });
  });
  networkManager.on('campaign-closed', (event: { campaignId: string }) => {
    void journalWindowManager?.closeCampaign(event.campaignId);
    assetManager?.releaseCampaign(event.campaignId);
    journalManager?.releaseCampaign(event.campaignId);
  });
  assetManager.on('changed', (event: { campaignId?: string }) => {
    if (event.campaignId) {
      void networkManager?.notifyAssetsChanged(event.campaignId);
    }
  });
  networkManager.on('assets-changed', (event) =>
    assetManager?.notifyChanged(event),
  );
  networkManager.on('asset-progress', (event) =>
    assetManager?.emit('progress', event),
  );
  networkManager.on('asset-error', (event) =>
    assetManager?.emit('error', event),
  );
  sceneManager.on('changed', (event: { campaignId?: string }) => {
    if (event.campaignId) {
      void networkManager?.notifyScenePresented(event.campaignId);
    }
  });
  sceneManager.on('preview-start', (event) => {
    void networkManager?.notifyTransformStarted(event);
  });
  sceneManager.on('preview-update', (event) => {
    void networkManager?.notifyTransformPreview(event);
  });
  sceneManager.on('preview-cancel', (event) => {
    void networkManager?.notifyTransformCancelled(event);
  });
  networkManager.on('scene-presented', (event: { campaignId?: string }) => {
    if (event.campaignId) {
      void sceneManager?.notifyChanged(event.campaignId);
    }
  });
  registerCampaignIpcHandlers(
    applicationIpc,
    campaignRepository,
    campaignArchives,
    async (input) => {
      const campaignId =
        input &&
          typeof input === 'object' &&
          'id' in input &&
          typeof input.id === 'string'
          ? input.id
          : null;
      if (campaignId) {
        await networkManager?.stopHostForCampaign(campaignId);
        await workspaces.close(campaignId);
      }
    },
    async (input) => {
      const campaignId =
        input &&
          typeof input === 'object' &&
          'id' in input &&
          typeof input.id === 'string'
          ? input.id
          : null;
      if (campaignId) {
        await networkManager?.stopHostForCampaign(campaignId);
        await workspaces.close(campaignId);
      }
    },
  );
  mainWindow = createWindow();
  registerDiagnosticIpcHandlers(
    applicationIpc,
    diagnostics,
    () => mainWindow?.webContents ?? null,
  );
  void protocol.handle('blackbox-asset', (request) =>
    assetPreviewRegistry.handle(request),
  );
  mainWindow.on('closed', () => {
    mainWindow = null;
    void journalWindowManager?.closeAll();
  });
  sceneManager.on('health-changed', (event) => {
    journalManager?.notifyAuthoredDataChanged(event);
  });
  revealTimer = setTimeout(revealMainWindow, REVEAL_TIMEOUT_MS);
  registerNetworkIpcHandlers(
    applicationIpc,
    networkManager,
    () => [
      ...(mainWindow?.webContents ? [mainWindow.webContents] : []),
      ...(journalWindowManager?.getWebContents() ?? []),
    ],
  );
  registerAssetIpcHandlers(
    applicationIpc,
    assetManager,
    (sender) =>
      sender === mainWindow?.webContents ||
      Boolean(journalWindowManager?.isAllowedSender(sender)),
    () => [
      ...(mainWindow?.webContents ? [mainWindow.webContents] : []),
      ...(journalWindowManager?.getWebContents() ?? []),
    ],
  );
  registerSceneIpcHandlers(
    applicationIpc,
    sceneManager,
    () => mainWindow?.webContents ?? null,
  );
  registerJournalIpcHandlers(
    applicationIpc,
    journalManager,
    (sender) =>
      sender === mainWindow?.webContents ||
      Boolean(journalWindowManager?.isAllowedSender(sender)),
    () => [
      ...(mainWindow?.webContents ? [mainWindow.webContents] : []),
      ...(journalWindowManager?.getWebContents() ?? []),
    ],
  );
  registerJournalWindowIpcHandlers(
    applicationIpc,
    journalWindowManager,
    (sender) => sender === mainWindow?.webContents,
  );
  registerApplicationIpcHandlers(
    applicationIpc,
    () => {
      requestQuit();
    },
    () => {
      revealMainWindow();
    },
    (url) => shell.openExternal(url),
    retryMainRenderer,
  );
  powerMonitor.on('resume', () => {
    void networkManager?.retryHostNow();
  });
  if (developmentOwnerPid) {
    ownerMonitor = setInterval(() => {
      try {
        process.kill(developmentOwnerPid, 0);
      } catch {
        requestQuit();
      }
    }, 1_000);
  }
  if (developmentSessionFile && developmentOwnerPid) {
    await writeFile(
      developmentSessionFile,
      JSON.stringify({
        ownerPid: developmentOwnerPid,
        ready: true,
        root: process.cwd(),
        startedAt: new Date().toISOString(),
      }),
      { encoding: 'utf8', flag: 'w' },
    );
  }
});

app.on('before-quit', (event) => {
  if (!shutdownComplete) {
    event.preventDefault();
    requestQuit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    requestQuit();
  }
});

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
      void journalWindowManager?.closeAll();
    });
    // Reopening has no ready signal to wait for, so it shows itself as soon as
    // it can paint. Without this the new window would stay invisible forever.
    mainWindow.once('ready-to-show', () => revealMainWindow());
  }
});
