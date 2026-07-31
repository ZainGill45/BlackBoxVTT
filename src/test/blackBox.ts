import { OFFLINE_SERVER_STATUS } from '../features/play/serverSettings';
import type { ApplicationApi } from '../shared/application';
import type { AssetApi, AssetResult } from '../shared/assets';
import type { CampaignApi, CampaignResult } from '../shared/campaigns';
import type { NetworkApi, NetworkResult } from '../shared/network';
import {
  createEmptySceneManifest,
  type SceneApi,
  type SceneResult,
} from '../shared/scenes';

/**
 * The preload bridge, stubbed for jsdom. Electron installs `window.blackBox`
 * before the renderer runs, so the real app can read it unconditionally; tests
 * have no preload and would otherwise render against an undefined bridge.
 *
 * Every operation is inert. A test that cares about a call passes its own
 * double through App's props instead of reaching for these.
 */

function assetUnavailable<T>(): AssetResult<T> {
  return {
    error: {
      code: 'storage_error',
      message: 'Campaign asset storage is unavailable.',
    },
    ok: false,
  };
}

function campaignUnavailable<T>(): CampaignResult<T> {
  return {
    error: {
      code: 'storage_error',
      message: 'Campaign storage is unavailable.',
    },
    ok: false,
  };
}

function networkUnavailable<T>(): NetworkResult<T> {
  return {
    error: {
      code: 'server_unavailable',
      message: 'Networking is unavailable outside the Electron application.',
    },
    ok: false,
  };
}

function sceneUnavailable<T>(): SceneResult<T> {
  return {
    error: {
      code: 'storage_error',
      message: 'Campaign scene storage is unavailable.',
    },
    ok: false,
  };
}

const applicationApi: ApplicationApi = {
  quit() {},
  ready() {},
};

const assetApi: AssetApi = {
  async getPreview() {
    return assetUnavailable();
  },
  async list() {
    return assetUnavailable();
  },
  onChanged() {
    return () => undefined;
  },
  onError() {
    return () => undefined;
  },
  onProgress() {
    return () => undefined;
  },
  async pickAndImport() {
    return assetUnavailable();
  },
  async prepareRemote() {
    return { ok: true, value: [] };
  },
  async releasePreview() {},
  async rename() {
    return assetUnavailable();
  },
  async trash() {
    return assetUnavailable();
  },
};

const campaignApi: CampaignApi = {
  async create() {
    return campaignUnavailable();
  },
  async list() {
    return campaignUnavailable();
  },
  async trash() {
    return campaignUnavailable();
  },
};

const networkApi: NetworkApi = {
  async acceptTrust() {
    return networkUnavailable();
  },
  async authenticate() {
    return networkUnavailable();
  },
  async cancelConnection() {},
  async connect() {
    return networkUnavailable();
  },
  async createUser() {
    return networkUnavailable();
  },
  async deleteHistory() {
    return networkUnavailable();
  },
  async deleteUser() {
    return networkUnavailable();
  },
  async disconnect() {},
  async getHostStatus() {
    return OFFLINE_SERVER_STATUS;
  },
  async getServerSettings() {
    return networkUnavailable();
  },
  async listHistory() {
    return { ok: true, value: [] };
  },
  onClientStateChanged() {
    return () => undefined;
  },
  onHostStatusChanged() {
    return () => undefined;
  },
  onMapPing() {
    return () => undefined;
  },
  onMeasurementUpdate() {
    return () => undefined;
  },
  onSessionClosed() {
    return () => undefined;
  },
  async openHost() {
    return networkUnavailable();
  },
  async resetPassword() {
    return networkUnavailable();
  },
  async setPort() {
    return networkUnavailable();
  },
  async sendMapPing() {},
  async sendMeasurementUpdate() {},
  async stopHost() {},
  async updateUsername() {
    return networkUnavailable();
  },
};

const sceneApi: SceneApi = {
  async create() {
    return sceneUnavailable();
  },
  async detachAsset() {
    return sceneUnavailable();
  },
  async findDependents() {
    return { ok: true, value: [] };
  },
  async list() {
    return { ok: true, value: createEmptySceneManifest() };
  },
  onChanged() {
    return () => undefined;
  },
  async present() {
    return sceneUnavailable();
  },
  async trash() {
    return sceneUnavailable();
  },
  async update() {
    return sceneUnavailable();
  },
};

export function installBlackBoxStub(): void {
  window.blackBox = {
    application: applicationApi,
    assets: assetApi,
    campaigns: campaignApi,
    network: networkApi,
    scenes: sceneApi,
  };
}
