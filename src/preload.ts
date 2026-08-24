import { contextBridge, ipcRenderer } from 'electron';
import { applicationIpcChannels } from './shared/application';
import { createApplicationApi } from './preload/applicationApi';
import { createAssetApi } from './preload/assetApi';
import { createCampaignApi } from './preload/campaignApi';
import { createNetworkApi } from './preload/networkApi';
import { createJournalApi } from './preload/journalApi';
import { createJournalWindowApi } from './preload/journalWindowApi';
import { createSceneApi } from './preload/sceneApi';

let altHeld = false;
ipcRenderer.on(applicationIpcChannels.altHeld, (_event, down) => {
  altHeld = Boolean(down);
});

contextBridge.exposeInMainWorld('blackBox', {
  application: {
    ...createApplicationApi(
      (channel) => ipcRenderer.send(channel),
      (channel, input) => ipcRenderer.invoke(channel, input),
      () => altHeld,
    ),
  },
  assets: createAssetApi(ipcRenderer),
  campaigns: createCampaignApi((channel, input) =>
    ipcRenderer.invoke(channel, input),
  ),
  journal: createJournalApi(ipcRenderer),
  journalWindows: createJournalWindowApi((channel, input) =>
    ipcRenderer.invoke(channel, input),
  ),
  network: createNetworkApi(ipcRenderer),
  scenes: createSceneApi(ipcRenderer),
});
