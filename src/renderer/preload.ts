import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { Game } from '../shared/schemas/game';
import { Log } from '../shared/types/Log'

contextBridge.exposeInMainWorld('electronAPI', {
  requestEnsureFileSystemStructure: () => ipcRenderer.invoke('receiveEnsureFileSystemStructureRequest'),
  requestApplicationExit: () => ipcRenderer.invoke('receiveApplicationExitRequest'),
  requestGameEntryData: () => ipcRenderer.invoke('receiveGameReadRequest'),
  requestCreateGame: (game: Game) => ipcRenderer.invoke('receiveGameCreateRequest', game),
  requestDeleteGame: (game: Game) => ipcRenderer.invoke('receiveGameDeleteRequest', game),
  requestLogUpdate: (content: string, type: 'info' | 'warning' | 'error' = 'info') => ipcRenderer.invoke('receiveLogUpdateRequest', content, type),
  onLogAdded: (callback: (message: Log) => void) => ipcRenderer.on('new-log-added', (_event: IpcRendererEvent, value: Log) => callback(value)),
});