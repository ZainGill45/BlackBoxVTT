import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { Game } from '../shared/schemas/game';
import { Log } from '../shared/types/Log'

contextBridge.exposeInMainWorld('electronAPI', {
  requestApplicationExit: () => ipcRenderer.invoke('receiveApplicationExitRequest'),
  requestGameEntryData: () => ipcRenderer.invoke('game:read'),
  requestCreateGame: (game: Game) => ipcRenderer.invoke('game:create', game),
  requestDeleteGame: (game: Game) => ipcRenderer.invoke('game:delete', game),
  requestLogPlayByPlay: () => ipcRenderer.invoke('log:read'),
  requestLogUpdate: (content: string, type: 'info' | 'warning' | 'error' = 'info') => ipcRenderer.invoke('receiveLogUpdateRequest', content, type),
  onLogAdded: (callback: (message: Log) => void) => ipcRenderer.on('new-log-added', (_event: IpcRendererEvent, value: Log) => callback(value)),
});
