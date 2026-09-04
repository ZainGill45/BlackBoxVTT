import { contextBridge, ipcRenderer } from "electron";
import { LogType } from "../shared/types/LogType";
import { Game } from "../shared/schemas/game";
import { log } from "./logger";

contextBridge.exposeInMainWorld("electronAPI", {
  requestEnsureFileSystemStructure: () => ipcRenderer.invoke("receiveEnsureFileSystemStructureRequest"),
  requestApplicationExit: () => ipcRenderer.invoke("receiveApplicationExitRequest"),
  requestGameEntryData: () => ipcRenderer.invoke("receiveGameReadRequest"),
  requestCreateGame: (game: Game) => ipcRenderer.invoke("receiveGameCreateRequest", game),
  requestDeleteGame: (game: Game) => ipcRenderer.invoke("receiveGameDeleteRequest", game),
  onMainLogged: () => ipcRenderer.on("onMainLogged", (content: unknown, type: LogType = "info") => log(content, type)),
});
