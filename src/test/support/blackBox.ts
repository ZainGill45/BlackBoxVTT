import { OFFLINE_SERVER_STATUS } from '../../features/play/serverSettings';
import type { ApplicationApi } from '../../shared/application';
import type { AssetApi, AssetResult } from '../../shared/assets';
import type { CampaignApi, CampaignResult } from '../../shared/campaigns';
import type { ChatResult } from '../../shared/chat';
import type { NetworkApi, NetworkResult } from '../../shared/network';
import type { JournalApi, JournalResult } from '../../shared/journal';
import {
  createEmptySceneManifest,
  type SceneApi,
  type SceneResult,
} from '../../shared/scenes';

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

function chatUnavailable<T>(): ChatResult<T> {
  return {
    error: {
      code: 'unavailable',
      message: 'Chat is unavailable outside the Electron application.',
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

async function journalUnavailable<T>(): Promise<JournalResult<T>> {
  return {
    error: { code: 'unavailable', message: 'The Journal is unavailable outside Electron.' },
    ok: false,
  };
}

const applicationApi: ApplicationApi = {
  async openExternal() {
    return false;
  },
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
  async importImageBytes() {
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
  async pickImages() {
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
  async export() {
    return campaignUnavailable();
  },
  async import() {
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
  async clearChatHistory() {
    return chatUnavailable();
  },
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
  async getChatBootstrap() {
    return {
      ok: true,
      value: {
        directory: [{ displayName: 'Game Master', kind: 'gm' }],
        generation: '11111111-1111-4111-8111-111111111111',
        hasNewer: false,
        hasOlder: false,
        maxMessageCharacters: 10_000,
        messages: [],
        newestSequence: null,
        oldestSequence: null,
        systemEvents: [],
      },
    };
  },
  async getChatHistory() {
    return {
      ok: true,
      value: {
        generation: '11111111-1111-4111-8111-111111111111',
        hasNewer: false,
        hasOlder: false,
        messages: [],
        newestSequence: null,
        oldestSequence: null,
      },
    };
  },
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
  onDrawingPreview() {
    return () => undefined;
  },
  onChatEvent() {
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
  onShapePreview() {
    return () => undefined;
  },
  onSessionClosed() {
    return () => undefined;
  },
  onTransformCancelled() {
    return () => undefined;
  },
  onTransformPreview() {
    return () => undefined;
  },
  onTransformStarted() {
    return () => undefined;
  },
  async openHost() {
    return networkUnavailable();
  },
  async resetPassword() {
    return networkUnavailable();
  },
  async sendChatMessage() {
    return chatUnavailable();
  },
  async sendChatRoll() {
    return chatUnavailable();
  },
  async setMaxChatMessageCharacters() {
    return networkUnavailable();
  },
  async setPort() {
    return networkUnavailable();
  },
  async setTransformPreviewRate() {
    return networkUnavailable();
  },
  async sendDrawingPreview() {},
  async sendMapPing() {},
  async sendMeasurementUpdate() {},
  async sendShapePreview() {},
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
  async previewCancel() {},
  async previewStart() {},
  async previewUpdate() {},
  async redo() {
    return sceneUnavailable();
  },
  async setImages() {
    return sceneUnavailable();
  },
  async setFog() {
    return sceneUnavailable();
  },
  async setObjects() {
    return sceneUnavailable();
  },
  async trash() {
    return sceneUnavailable();
  },
  async update() {
    return sceneUnavailable();
  },
  async undo() {
    return sceneUnavailable();
  },
};

const journalApi: JournalApi = {
  acquireLease: journalUnavailable,
  createEntry: journalUnavailable,
  createNote: journalUnavailable,
  createPage: journalUnavailable,
  deleteTarget: journalUnavailable,
  detachAsset: journalUnavailable,
  findAssetDependents: journalUnavailable,
  getNote: journalUnavailable,
  getEntry: journalUnavailable,
  getPage: journalUnavailable,
  list: journalUnavailable,
  listUsers: journalUnavailable,
  moveNote: journalUnavailable,
  moveEntry: journalUnavailable,
  movePage: journalUnavailable,
  onChanged: () => () => undefined,
  prepareDelete: journalUnavailable,
  releaseLease: journalUnavailable,
  reorderNotes: journalUnavailable,
  reorderEntries: journalUnavailable,
  reorderPages: journalUnavailable,
  renewLease: journalUnavailable,
  updateNote: journalUnavailable,
  renameEntry: journalUnavailable,
  updateEntryData: journalUnavailable,
  updateEntryPermissions: journalUnavailable,
  updateNotePermissions: journalUnavailable,
  updatePage: journalUnavailable,
  updatePagePermissions: journalUnavailable,
};

export function installBlackBoxStub(): void {
  window.blackBox = {
    application: applicationApi,
    assets: assetApi,
    campaigns: campaignApi,
    journal: journalApi,
    network: networkApi,
    scenes: sceneApi,
  };
}
