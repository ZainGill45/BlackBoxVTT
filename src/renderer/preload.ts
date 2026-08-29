import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    exitApplication: () => ipcRenderer.invoke('exitApplication'),
});