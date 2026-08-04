import { contextBridge, ipcRenderer } from 'electron';
import { createApplicationApi } from './preload/applicationApi';
import { createAssetApi } from './preload/assetApi';
import { createCampaignApi } from './preload/campaignApi';
import { createNetworkApi } from './preload/networkApi';
import { createJournalApi } from './preload/journalApi';
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
  journal: createJournalApi(ipcRenderer),
  network: createNetworkApi(ipcRenderer),
  scenes: createSceneApi(ipcRenderer),
});
