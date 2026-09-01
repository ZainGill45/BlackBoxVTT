import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { pathToFileURL } from "node:url";
import { join } from "path";

const isTrustedRendererURL = (rawURL: string): boolean => {
  const actualURL = new URL(rawURL);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return actualURL.origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
  }

  actualURL.hash = "";
  actualURL.search = "";

  return actualURL.href === pathToFileURL(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)).href;
};

export const verifyIPCSender = (mainWindow: BrowserWindow, event: IpcMainInvokeEvent): void => {
  const isMainWindow = !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
  const isMainFrame = event.senderFrame !== null && event.senderFrame === mainWindow.webContents.mainFrame;

  if (!isMainWindow || !isMainFrame || !isTrustedRendererURL(event.senderFrame.url)) {
    throw new Error("Unauthorized IPC sender");
  }
};
