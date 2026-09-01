import { initializeNewGame, getAllGameEntryData, deleteGameData, ensureFileStructure } from "./files";
import { Game, GameSchema } from "../shared/schemas/game";
import { app, ipcMain, BrowserWindow } from "electron";
import { log, onLogCreated, relogLogHistory } from "./logger";
import { join } from "path";

export let mainWindow: BrowserWindow;

const createWindow = async () => {

  mainWindow = new BrowserWindow({
    fullscreen: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js')
    }
  });

  onLogCreated((log) => { mainWindow.webContents.send('new-log-added', log) });
  await ensureFileStructure();

  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(false);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL).then(() => log(`Loading dev server at ${MAIN_WINDOW_VITE_DEV_SERVER_URL}`));
  } else {
    mainWindow.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)).then(() => log(`Loading index.html from ${MAIN_WINDOW_VITE_NAME}`));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('receiveApplicationExitRequest', () => {
    log("Attemping to close application");

    BrowserWindow.getAllWindows().forEach((openWindow) => {
      if (!openWindow.isDestroyed()) {
        openWindow.hide();
      }
    });

    app.quit();
  });

  ipcMain.handle('receiveLogUpdateRequest', (_event, content: string, type: 'info' | 'warning' | 'error' = 'info') => {
    log(content, type);
  });

  ipcMain.handle('log:read', (_event) => {
    relogLogHistory();
  });

  ipcMain.handle('game:read', async (_event): Promise<Game[]> => {
    try {
      return await getAllGameEntryData();
    } catch (error) {
      throw error;
    }
  });

  ipcMain.handle('game:create', async (_event, game: Game): Promise<void> => {
    const parsedGame = GameSchema.safeParse(game);

    if (!parsedGame.success) {
      const rejectMessage = parsedGame.error.issues[0]?.message ?? 'Invalid game schema detected';
      log(rejectMessage, 'error');
      throw new Error(rejectMessage);
    };

    try {
      await initializeNewGame(parsedGame.data);
      log(`Successfully create directories for ${parsedGame.data.name}`);
    } catch (error) {
      throw error;
    }
  });

  ipcMain.handle('game:delete', (_event, game: Game): Promise<void> => {
    return deleteGameData(game);
  });

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
