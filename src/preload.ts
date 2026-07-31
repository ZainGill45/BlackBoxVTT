import { contextBridge, ipcRenderer } from 'electron';
import { createApplicationApi } from './preload/applicationApi';
import { createAssetApi } from './preload/assetApi';
import { createCampaignApi } from './preload/campaignApi';
import { createNetworkApi } from './preload/networkApi';
import { createSceneApi } from './preload/sceneApi';

contextBridge.exposeInMainWorld('blackBox', {
  application: createApplicationApi(
    (channel) => ipcRenderer.send(channel),
    (channel, input) => ipcRenderer.invoke(channel, input),
  ),
  assets: createAssetApi(ipcRenderer),
  campaigns: createCampaignApi((channel, input) =>
    ipcRenderer.invoke(channel, input),
  ),
  network: createNetworkApi(ipcRenderer),
  scenes: createSceneApi(ipcRenderer),
});
