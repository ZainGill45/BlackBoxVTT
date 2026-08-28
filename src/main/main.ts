import { app, BrowserWindow } from "electron";
import { join } from "path";

function createWindow(): void {
    const mainWindow = new BrowserWindow({
        fullscreen: true
    })

    mainWindow.setMenuBarVisibility(false);
    mainWindow.setAutoHideMenuBar(false);

    mainWindow.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})