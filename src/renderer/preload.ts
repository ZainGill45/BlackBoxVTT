import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    requestApplicationExit: () => ipcRenderer.invoke('recieveApplicationExitRequest'),
    requestLogUpdate: (content: string, type: 'info' | 'warning' | 'error' = 'info') => ipcRenderer.invoke('recieveLogUpdateRequest', content, type),
    onLogAdded: (callback: (message: LogEntry) => void) => ipcRenderer.on('new-log-added', (_event: IpcRendererEvent, value: LogEntry) => callback(value)),
});