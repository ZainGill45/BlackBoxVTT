import { contextBridge, ipcRenderer } from 'electron';
import { createDetachedCharacterApi } from './preload/detachedCharacterApi';

contextBridge.exposeInMainWorld(
  'blackBoxDetachedCharacter',
  createDetachedCharacterApi(ipcRenderer),
);
