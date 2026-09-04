import { initializeNewGame, getAllGameEntryData, deleteGameData, ensureFileStructure } from "./files";
import { Game, GameSchema } from "../shared/schemas/game";
import { app, ipcMain, BrowserWindow } from "electron";
import { verifyIPCSender } from "./ipcVerifier";
import { log } from "./logger";
import { join } from "path";

let mainWindow: BrowserWindow;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(false);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL).then(() => log(`Loading dev server at ${MAIN_WINDOW_VITE_DEV_SERVER_URL}`));
  } else {
    mainWindow.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)).then(() => log(`Loading index.html from ${MAIN_WINDOW_VITE_NAME}`));
  }
};

app.whenReady().then(() => {
  ipcMain.handle("receiveEnsureFileSystemStructureRequest", async (event) => {
    verifyIPCSender(mainWindow, event);

    try {
      await ensureFileStructure();
    } catch (error) {
      throw error;
    }
  });

  ipcMain.handle("receiveApplicationExitRequest", (event) => {
    verifyIPCSender(mainWindow, event);

    BrowserWindow.getAllWindows().forEach((openWindow) => {
      if (!openWindow.isDestroyed()) {
        openWindow.hide();
      }
    });

    app.quit();
  });

  ipcMain.handle("receiveGameReadRequest", async (event): Promise<Game[]> => {
    verifyIPCSender(mainWindow, event);

    try {
      return await getAllGameEntryData();
    } catch (error) {
      throw error;
    }
  });

  ipcMain.handle("receiveGameCreateRequest", async (event, game: Game): Promise<void> => {
    verifyIPCSender(mainWindow, event);

    const parsedGame = GameSchema.safeParse(game);
    if (!parsedGame.success) {
      const rejectMessage = parsedGame.error.issues[0]?.message ?? "Invalid game schema detected";
      log(rejectMessage, "error");
      throw new Error(rejectMessage);
    }

    try {
      await initializeNewGame(parsedGame.data);
      log(`Successfully create directories for ${parsedGame.data.name}`);
    } catch (error) {
      throw error;
    }
  });

  ipcMain.handle("receiveGameDeleteRequest", (event, game: Game): Promise<void> => {
    verifyIPCSender(mainWindow, event);

    return deleteGameData(game);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
