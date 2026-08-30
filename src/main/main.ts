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
  ipcMain.handle('recieveApplicationExitRequest', () => {
    log("Attemping to close application");

    BrowserWindow.getAllWindows().forEach((openWindow) => {
      if (!openWindow.isDestroyed()) {
        openWindow.hide();
      }
    });

    app.quit();
  });

  ipcMain.handle('recieveLogUpdateRequest', (_event, content: string, type: 'info' | 'warning' | 'error' = 'info') => {
    log(content, type);
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
