import { app, BrowserWindow } from "electron";
import { join } from "path";

const isDevelopment = process.argv.includes("--dev");

function createWindow(): void {
    const mainWindow = new BrowserWindow({
        fullscreen: true
    })

    mainWindow.setMenuBarVisibility(false);
    mainWindow.setAutoHideMenuBar(false);

    if (isDevelopment) {
        mainWindow.loadURL("http://localhost:5173").then(response => console.log(response));
    } else {
        mainWindow.loadFile(join(import.meta.dirname, "../renderer/index.html")).then(response => console.log(response));
    }
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