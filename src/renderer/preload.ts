import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { Log } from '../shared/types/Log'

contextBridge.exposeInMainWorld('electronAPI', {
  requestApplicationExit: () => ipcRenderer.invoke('receiveApplicationExitRequest'),
  requestCreateGame: (input: string) => ipcRenderer.invoke('game:create', input),
  requestGameEntryData: () => ipcRenderer.invoke('game:read'),
  requestLogUpdate: (content: string, type: 'info' | 'warning' | 'error' = 'info') => ipcRenderer.invoke('receiveLogUpdateRequest', content, type),
  onLogAdded: (callback: (message: Log) => void) => ipcRenderer.on('new-log-added', (_event: IpcRendererEvent, value: Log) => callback(value)),
});
