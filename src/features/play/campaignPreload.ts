import type { AssetApi, AssetPreview } from '../../shared/assets';
import type { ChatBootstrap } from '../../shared/chat';
import type {
  JournalApi,
  JournalContentSnapshot,
} from '../../shared/journal';
import type { NetworkApi } from '../../shared/network';
import type { SceneApi, SceneManifest } from '../../shared/scenes';
import type { SceneRendererHandle } from './canvas/SceneRenderer';
import type { JournalSnapshot } from './journal/useJournal';
import {
  buildAssetThumbnail,
  releaseAssetThumbnail,
  type AssetThumbnailEntry,
} from './scenes/useAssetThumbnails';
import type { AssetSnapshot } from './useAssets';

export const CAMPAIGN_PRELOAD_INACTIVITY_MS = 30_000;

export type CampaignPreparationPhase =
  | 'asset-payloads'
  | 'campaign-data'
  | 'final-frame'
  | 'image-decoding'
  | 'journal-content'
  | 'remote-synchronization'
  | 'scene-graphs'
  | 'viewer-engines';

export interface CampaignPreparationProgress {
  completedBytes?: number;
  completedItems: number;
  currentName?: string;
  label: string;
  phase: CampaignPreparationPhase;
  totalBytes?: number | null;
  totalItems: number;
}

/** Everything prepared before the campaign becomes interactive. */
export interface CampaignPreload {
  assets: AssetSnapshot | null;
  chat: ChatBootstrap | null;
  createRenderer: (() => SceneRendererHandle) | null;
  journal: JournalSnapshot | null;
  journalContent: JournalContentSnapshot | null;
  previews: ReadonlyMap<string, AssetPreview>;
  scenes: SceneManifest | null;
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
  onProgress?: (progress: CampaignPreparationProgress) => void;
  role: 'gm' | 'player';
}

/** Reads and warms all non-DOM campaign resources before PlayScreen mounts. */
export async function preloadCampaign(
  input: CampaignPreloadInput,
): Promise<CampaignPreload> {
  const { assetApi, campaignId, journalApi, networkApi, role, sceneApi } = input;
  const dataTasks = [
    attempt(() => readScenes(sceneApi, campaignId)),
    attempt(() => readAssets(assetApi, campaignId)),
    attempt(() => readJournal(journalApi, campaignId, role)),
    attempt(() => readChat(networkApi, campaignId)),
  ] as const;
  let dataCompleted = 0;
  input.onProgress?.({
    completedItems: 0,
    label: 'Reading campaign data…',
    phase: 'campaign-data',
    totalItems: dataTasks.length,
  });
  const trackedDataTasks = dataTasks.map(async (task) => {
    const value = await task;
    dataCompleted += 1;
    input.onProgress?.({
      completedItems: dataCompleted,
      label: 'Reading campaign data…',
      phase: 'campaign-data',
      totalItems: dataTasks.length,
    });
    return value;
  });
  const [scenes, assets, journal, chat] = await Promise.all(trackedDataTasks) as [
    SceneManifest | null,
    AssetSnapshot | null,
    JournalSnapshot | null,
    ChatBootstrap | null,
  ];

  const [prepared, journalContent, createRenderer] = await Promise.all([
    prepareAssetPayloads(input, assets),
    prepareJournalContent(input, journal),
    prepareViewerEngines(input, scenes),
  ]);
  const previews = new Map(
    prepared?.previews.map((preview) => [preview.assetId, preview]) ?? [],
  );

  input.onProgress?.({
    completedItems: 0,
    label: 'Preparing scene thumbnails…',
    phase: 'image-decoding',
    totalItems: uniqueSceneMapIds(scenes).length,
  });
  const thumbnails =
    (await attempt(() => buildThumbnails(input, scenes))) ?? new Map();

  return {
    assets,
    chat,
    createRenderer,
    journal,
    journalContent,
    previews,
    scenes,
    thumbnails,
  };
}

/** Releases a preload that was abandoned or the session that adopted it. */
export function releaseCampaignPreload(
  assetApi: AssetApi,
  preload: CampaignPreload,
): void {
  for (const entry of preload.thumbnails.values()) {
    releaseAssetThumbnail(assetApi, entry);
  }
  for (const preview of preload.previews.values()) {
    try {
      void Promise.resolve(
        assetApi.releasePreview({ token: preview.token }),
      ).catch(() => undefined);
    } catch {
      // The bridge can already be gone during application shutdown.
    }
  }
}

async function prepareAssetPayloads(
  input: CampaignPreloadInput,
  assets: AssetSnapshot | null,
) {
  const previewableAssets =
    assets?.assets.filter((asset) => asset.capabilities.preview) ?? [];
  const totalBytes =
    previewableAssets.reduce((total, asset) => total + asset.sizeBytes, 0);
  input.onProgress?.({
    completedBytes: 0,
    completedItems: 0,
    label: 'Caching campaign assets…',
    phase: 'asset-payloads',
    totalBytes,
    totalItems: previewableAssets.length,
  });
  const removeProgress = input.assetApi.onProgress((event) => {
    if (
      event.scope !== 'preload' ||
      (event.campaignId && event.campaignId !== input.campaignId)
    ) {
      return;
    }
    input.onProgress?.({
      completedBytes: event.completedBytes,
      completedItems: event.completedItems ?? 0,
      currentName: event.currentName,
      label: 'Caching campaign assets…',
      phase: 'asset-payloads',
      totalBytes: event.totalBytes,
      totalItems: event.totalItems ?? previewableAssets.length,
    });
  });
  try {
    const result = await input.assetApi
      .preparePreviews({ campaignId: input.campaignId })
      .catch(() => null);
    input.onProgress?.({
      completedBytes: totalBytes,
      completedItems: previewableAssets.length,
      label: 'Caching campaign assets…',
      phase: 'asset-payloads',
      totalBytes,
      totalItems: previewableAssets.length,
    });
    return result?.ok ? result.value : null;
  } finally {
    removeProgress();
  }
}

async function prepareJournalContent(
  input: CampaignPreloadInput,
  journal: JournalSnapshot | null,
): Promise<JournalContentSnapshot | null> {
  if (!input.journalApi || !journal) return null;
  const totalItems = journal.manifest.entries.reduce(
    (total, entry) => total + (entry.kind === 'note' ? entry.pages.length : 1),
    0,
  );
  input.onProgress?.({
    completedItems: 0,
    label: 'Reading Journal content…',
    phase: 'journal-content',
    totalItems,
  });
  const removeProgress = input.journalApi.onPreparationProgress((event) => {
    if (event.campaignId !== input.campaignId) return;
    input.onProgress?.({
      completedItems: event.completedItems,
      currentName: event.currentName,
      label: 'Reading Journal content…',
      phase: 'journal-content',
      totalItems: event.totalItems,
    });
  });
  const result = await input.journalApi
    .prepareContent({ campaignId: input.campaignId })
    .catch(() => null)
    .finally(removeProgress);
  const value = result?.ok ? result.value : null;
  input.onProgress?.({
    completedItems: value ? value.entries.length + value.pages.length : totalItems,
    label: 'Reading Journal content…',
    phase: 'journal-content',
    totalItems,
  });
  return value;
}

async function prepareViewerEngines(
  input: CampaignPreloadInput,
  scenes: SceneManifest | null,
): Promise<(() => SceneRendererHandle) | null> {
  input.onProgress?.({
    completedItems: 0,
    label: 'Loading viewers and scene fonts…',
    phase: 'viewer-engines',
    totalItems: 3,
  });
  const result = await settleWithin(
    Promise.all([
      import('./canvas/SceneRenderer'),
      import('./canvas/sceneTextRenderer'),
      import('pdfjs-dist'),
    ]),
  );
  if (!result) return null;
  input.onProgress?.({
    completedItems: 2,
    label: 'Loading viewers and scene fonts…',
    phase: 'viewer-engines',
    totalItems: 3,
  });
  const sceneText = (scenes?.scenes ?? [])
    .flatMap((scene) => [
      ...Object.values(scene.texts).flat().map((text) => text.content),
      ...(Object.values(scene.shapes).some((layer) => layer.length > 0)
        ? ['Shape']
        : []),
    ])
    .join('\n');
  await settleWithin(result[1].ensureSceneTextFontsLoaded(sceneText || undefined));
  input.onProgress?.({
    completedItems: 3,
    label: 'Loading viewers and scene fonts…',
    phase: 'viewer-engines',
    totalItems: 3,
  });
  return result[0].createSceneRenderer;
}

async function attempt<T>(read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await settleWithin(read());
  } catch {
    return null;
  }
}

function settleWithin<T>(
  operation: Promise<T>,
  onLate?: (value: T) => void,
): Promise<T | null> {
  return new Promise((resolve) => {
    let active = true;
    const timer = window.setTimeout(
      () => {
        active = false;
        resolve(null);
      },
      CAMPAIGN_PRELOAD_INACTIVITY_MS,
    );
    void operation.then(
      (value) => {
        if (!active) {
          onLate?.(value);
          return;
        }
        active = false;
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (!active) return;
        active = false;
        window.clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

async function readScenes(sceneApi: SceneApi, campaignId: string) {
  const result = await sceneApi.list({ campaignId });
  return result.ok ? result.value : null;
}

async function readAssets(assetApi: AssetApi, campaignId: string) {
  const [assets, users] = await Promise.all([
    assetApi.list({ campaignId }),
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
) {
  if (!journalApi) return null;
  const [manifest, users] = await Promise.all([
    journalApi.list({ campaignId }),
    role === 'gm' ? journalApi.listUsers({ campaignId }) : Promise.resolve(null),
  ]);
  return manifest.ok
    ? { manifest: manifest.value, users: users?.ok ? users.value : [] }
    : null;
}

async function readChat(networkApi: NetworkApi, campaignId: string) {
  const result = await networkApi.getChatBootstrap({ campaignId });
  return result.ok ? result.value : null;
}

function uniqueSceneMapIds(scenes: SceneManifest | null): string[] {
  return [
    ...new Set(
      (scenes?.scenes ?? [])
        .map((scene) => scene.mapImage?.assetId)
        .filter((assetId): assetId is string => assetId !== undefined),
    ),
  ];
}

async function buildThumbnails(
  input: CampaignPreloadInput,
  scenes: SceneManifest | null,
): Promise<ReadonlyMap<string, AssetThumbnailEntry>> {
  const assetIds = uniqueSceneMapIds(scenes);
  const thumbnails = new Map<string, AssetThumbnailEntry>();
  const queue = [...assetIds];
  let completed = 0;
  const worker = async () => {
    for (let assetId = queue.shift(); assetId; assetId = queue.shift()) {
      try {
        const entry = await settleWithin(
          buildAssetThumbnail(input.assetApi, input.campaignId, assetId),
          (lateEntry) => {
            if (lateEntry) releaseAssetThumbnail(input.assetApi, lateEntry);
          },
        );
        if (entry) thumbnails.set(assetId, entry);
      } catch {
        // One broken image does not discard successful thumbnails.
      } finally {
        completed += 1;
        input.onProgress?.({
          completedItems: completed,
          label: 'Preparing scene thumbnails…',
          phase: 'image-decoding',
          totalItems: assetIds.length,
        });
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return thumbnails;
}
