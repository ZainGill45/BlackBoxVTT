import type { AssetApi } from '../../shared/assets';
import type { ChatBootstrap } from '../../shared/chat';
import type { JournalApi } from '../../shared/journal';
import type { NetworkApi } from '../../shared/network';
import type { SceneApi, SceneManifest } from '../../shared/scenes';
import type { JournalSnapshot } from './journal/useJournal';
import {
  buildAssetThumbnail,
  releaseAssetThumbnail,
  type AssetThumbnailEntry,
} from './scenes/useAssetThumbnails';
import type { AssetSnapshot } from './useAssets';

/**
 * Everything the play screen's tabs need, read before the screen is built.
 *
 * The play screen's stores used to arrive empty and fill themselves in after
 * mount. Reading them up front means the screen is only shown once it can be
 * shown complete.
 */
export interface CampaignPreload {
  assets: AssetSnapshot | null;
  chat: ChatBootstrap | null;
  journal: JournalSnapshot | null;
  scenes: SceneManifest | null;
  /**
   * Renderer resources owned by whoever receives this preload. They are
   * handed to `useAssetThumbnails`, which releases them; nothing else may.
   */
  thumbnails: ReadonlyMap<string, AssetThumbnailEntry>;
}

export interface CampaignPreloadApis {
  assetApi: AssetApi;
  journalApi?: JournalApi;
  networkApi: NetworkApi;
  sceneApi: SceneApi;
}

export interface CampaignPreloadInput extends CampaignPreloadApis {
  campaignId: string;
  /** Named so the loader can say what it is waiting on. */
  onStep?: (label: string) => void;
  role: 'gm' | 'player';
}

/**
 * Reads a campaign's tabs ahead of the play screen.
 *
 * Deliberately best effort: a slice that cannot be read is simply left out, and
 * the store that owns it falls back to reading it itself and reporting its own
 * failure the way it always has. Warming the tabs is an improvement on how the
 * screen opens, not a new way for opening it to fail.
 */
export async function preloadCampaign(
  input: CampaignPreloadInput,
): Promise<CampaignPreload> {
  const { assetApi, campaignId, journalApi, networkApi, role, sceneApi } = input;

  input.onStep?.('Reading the campaign library…');
  const [scenes, assets, journal, chat] = await Promise.all([
    attempt(() => readScenes(sceneApi, campaignId)),
    attempt(() => readAssets(assetApi, campaignId)),
    attempt(() => readJournal(journalApi, campaignId, role)),
    attempt(() => readChat(networkApi, campaignId)),
  ]);

  input.onStep?.('Preparing scene thumbnails…');
  const thumbnails =
    (await attempt(() => buildThumbnails(assetApi, campaignId, scenes))) ??
    new Map();

  return { assets, chat, journal, scenes, thumbnails };
}

/** Releases a preload that never reached the play screen which would own it. */
export function releaseCampaignPreload(
  assetApi: AssetApi,
  preload: CampaignPreload,
): void {
  for (const entry of preload.thumbnails.values()) {
    releaseAssetThumbnail(assetApi, entry);
  }
}

/**
 * Runs one read, and treats a broken one as a read that found nothing.
 *
 * Warming a campaign must not be able to stop it from opening: whatever cannot
 * be read here is left to the store that owns it, which reads it again and
 * reports its own failure the way it always has.
 */
async function attempt<T>(read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

async function readScenes(
  sceneApi: SceneApi,
  campaignId: string,
): Promise<SceneManifest | null> {
  const result = await sceneApi.list({ campaignId });
  return result.ok ? result.value : null;
}

async function readAssets(
  assetApi: AssetApi,
  campaignId: string,
): Promise<AssetSnapshot | null> {
  const [assets, users] = await Promise.all([
    assetApi.list({ campaignId }),
    /* Only the Game Master is allowed the roster, so a player's denial leaves
       an empty one rather than losing the whole library. */
    assetApi.listUsers({ campaignId }),
  ]);
  return assets.ok
    ? { assets: assets.value, users: users.ok ? users.value : [] }
    : null;
}

async function readJournal(
  journalApi: JournalApi | undefined,
  campaignId: string,
  role: 'gm' | 'player',
): Promise<JournalSnapshot | null> {
  if (!journalApi) {
    return null;
  }
  const [manifest, users] = await Promise.all([
    journalApi.list({ campaignId }),
    role === 'gm'
      ? journalApi.listUsers({ campaignId })
      : Promise.resolve(null),
  ]);
  return manifest.ok
    ? {
      manifest: manifest.value,
      users: users?.ok ? users.value : [],
    }
    : null;
}

async function readChat(
  networkApi: NetworkApi,
  campaignId: string,
): Promise<ChatBootstrap | null> {
  const result = await networkApi.getChatBootstrap({ campaignId });
  return result.ok ? result.value : null;
}

/**
 * Warms the thumbnails the scene list paints with.
 *
 * Only scene maps are worth warming: every other tab draws its rows with icons
 * rather than the asset itself.
 */
async function buildThumbnails(
  assetApi: AssetApi,
  campaignId: string,
  scenes: SceneManifest | null,
): Promise<ReadonlyMap<string, AssetThumbnailEntry>> {
  const assetIds = [
    ...new Set(
      (scenes?.scenes ?? [])
        .map((scene) => scene.mapImage?.assetId)
        .filter((assetId): assetId is string => assetId !== undefined),
    ),
  ];
  const thumbnails = new Map<string, AssetThumbnailEntry>();
  // Decoded a couple at a time, exactly as the hook does, so a large campaign
  // never spikes while it is opening.
  const queue = [...assetIds];
  const worker = async () => {
    for (let assetId = queue.shift(); assetId; assetId = queue.shift()) {
      try {
        const entry = await buildAssetThumbnail(assetApi, campaignId, assetId);
        if (entry) {
          thumbnails.set(assetId, entry);
        }
      } catch {
        // One broken preview must not discard thumbnails already prepared.
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return thumbnails;
}
