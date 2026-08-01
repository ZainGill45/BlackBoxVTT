import {
  app,
  BrowserWindow,
  ipcMain,
  powerMonitor,
  protocol,
  safeStorage,
  shell,
} from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerApplicationIpcHandlers } from './main/applicationIpc';
import { registerAssetIpcHandlers } from './main/assetIpc';
import { AssetManager } from './main/assetManager';
import { AssetPreviewRegistry } from './main/assetPreviewRegistry';
import { registerCampaignIpcHandlers } from './main/campaignIpc';
import { CampaignRepository } from './main/campaignRepository';
import { CampaignRuntimeRegistry } from './main/campaignRuntime';
import { CampaignWorkspaceRegistry } from './main/campaignWorkspace';
import { ConnectionHistoryRepository } from './main/network/connectionHistoryRepository';
import { NetworkManager } from './main/network/networkManager';
import { registerNetworkIpcHandlers } from './main/networkIpc';
import { registerSceneIpcHandlers } from './main/sceneIpc';
import { SceneManager } from './main/sceneManager';

if (started) {
  app.quit();
}

/**
 * Whether this process owns the application. Startup is slow enough that the
 * icon can be clicked several times before anything appears on screen, and
 * without this every one of those clicks would boot a whole second copy.
 */
const isPrimaryInstance = app.requestSingleInstanceLock();

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
const assetPreviewRegistry = new AssetPreviewRegistry();
let shutdownComplete = false;
let shutdownPromise: Promise<void> | null = null;

const requestQuit = () => {
  if (shutdownComplete) {
    app.quit();
    return;
  }
  shutdownPromise ??= (networkManager?.shutdown() ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => {
      assetPreviewRegistry.clear();
      shutdownComplete = true;
      app.quit();
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

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    // Only ever seen if the backstop reveals a window that failed to render;
    // matches --color-canvas so even that case is not a white flash.
    backgroundColor: '#0d0d0d',
    fullscreen: true,
    // The window is not shown on creation. It appears once the renderer reports
    // the connection screen has real data, so it is never on screen while blank
    // or half-loaded.
    show: false,
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
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, _description, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        revealMainWindow();
      }
    },
  );

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

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

app.whenReady().then(() => {
  // A losing instance has already called app.quit(); it must not go on to build
  // repositories or open a window before the quit lands.
  if (!isPrimaryInstance) {
    return;
  }
  const campaignRepository = new CampaignRepository({
    rootDirectory: path.join(app.getPath('userData'), 'data', 'campaigns'),
    trashItem: (targetPath) => shell.trashItem(targetPath),
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
  assetManager = new AssetManager({
    getWindow: () => mainWindow,
    previewRegistry: assetPreviewRegistry,
    runtimes,
  });
  sceneManager = new SceneManager({
    runtimes,
  });
  assetManager.on('changed', (event: { campaignId?: string }) => {
    if (event.campaignId) {
      void networkManager?.notifyAssetsChanged(event.campaignId);
    }
  });
  networkManager.on('assets-changed', (event) =>
    assetManager?.emit('changed', event),
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
    ipcMain,
    campaignRepository,
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
      }
    },
  );
  mainWindow = createWindow();
  void protocol.handle('blackbox-asset', (request) =>
    assetPreviewRegistry.handle(request),
  );
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  revealTimer = setTimeout(revealMainWindow, REVEAL_TIMEOUT_MS);
  registerNetworkIpcHandlers(
    ipcMain,
    networkManager,
    () => mainWindow?.webContents ?? null,
  );
  registerAssetIpcHandlers(
    ipcMain,
    assetManager,
    () => mainWindow?.webContents ?? null,
  );
  registerSceneIpcHandlers(
    ipcMain,
    sceneManager,
    () => mainWindow?.webContents ?? null,
  );
  registerApplicationIpcHandlers(
    ipcMain,
    () => {
      requestQuit();
    },
    () => {
      revealMainWindow();
    },
    (url) => shell.openExternal(url),
  );
  powerMonitor.on('resume', () => {
    void networkManager?.retryHostNow();
  });
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
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
    // Reopening has no ready signal to wait for, so it shows itself as soon as
    // it can paint. Without this the new window would stay invisible forever.
    mainWindow.once('ready-to-show', () => revealMainWindow());
  }
});
