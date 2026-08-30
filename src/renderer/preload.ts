import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { Log } from '../shared/types/log'

contextBridge.exposeInMainWorld('electronAPI', {
    requestApplicationExit: () => ipcRenderer.invoke('recieveApplicationExitRequest'),
    requestLogUpdate: (content: string, type: 'info' | 'warning' | 'error' = 'info') => ipcRenderer.invoke('recieveLogUpdateRequest', content, type),
    onLogAdded: (callback: (message: Log) => void) => ipcRenderer.on('new-log-added', (_event: IpcRendererEvent, value: Log) => callback(value)),
});
