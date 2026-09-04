import { LogType } from "../shared/types/LogType";
import { BrowserWindow } from "electron";

export const log = (content: unknown, type: LogType = "info"): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("onMainLogged", { content, type });
  }
};
