import type { ApplicationApi } from './shared/application';
import type { AssetApi } from './shared/assets';
import type { CampaignApi } from './shared/campaigns';
import type { NetworkApi } from './shared/network';
import type { SceneApi } from './shared/scenes';

declare global {
  interface Window {
    // Installed by the preload script before any renderer code runs, so the
    // renderer can rely on it being present.
    blackBox: {
      application: ApplicationApi;
      assets: AssetApi;
      campaigns: CampaignApi;
      network: NetworkApi;
      scenes: SceneApi;
    };
  }
}

export {};
