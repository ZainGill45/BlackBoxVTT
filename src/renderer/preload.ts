import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('preload', {
    exitApplication: () => ipcRenderer.invoke('exitApplication'),
});