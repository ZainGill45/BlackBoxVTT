import { Game, GameNameSchema, GameSchema } from "../shared/schemas/game";
import { initializeNewGame, getAllGameEntryData, deleteGameData } from "./files";
import { app, ipcMain, BrowserWindow } from "electron";
import { log, onLogCreated } from "./logger";
import { join } from "path";

export let mainWindow: BrowserWindow;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js')
    }
  });

  onLogCreated((log) => { mainWindow.webContents.send('new-log-added', log) });

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

  ipcMain.handle('game:read', (_event): Promise<Game[]> => {
    return getAllGameEntryData();
  });

  ipcMain.handle('game:create', (_event, input: string): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      const parsedInput = GameNameSchema.safeParse(input);
      if (!parsedInput.success) {
        const rejectMessage = parsedInput.error.issues[0]?.message ?? 'Invalid campaign name';
        log(rejectMessage, 'warning');
        reject(rejectMessage);
      };

      const newGame: Game = {
        schemaVersion: 1,
        uuid: crypto.randomUUID(),
        name: parsedInput.data ?? 'You Should Never See This',
        gameSizeBytes: 0,
      }

      const parsedGame = GameSchema.safeParse(newGame);
      if (!parsedGame.success) {
        const rejectMessage = parsedGame.error.issues[0]?.message ?? 'Invalid template schema';
        log(rejectMessage, 'error');
        reject(rejectMessage);
      };

      if (parsedGame.data !== undefined) {
        await initializeNewGame(parsedGame.data).then(() => {
          resolve()
        }).catch((error) => {
          log(error);
          reject(error);
        });
      }
    });
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
