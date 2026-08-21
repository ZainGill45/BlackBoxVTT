import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CAMPAIGN_PRELOAD_INACTIVITY_MS,
  campaignScenePreparationProgress,
  preloadCampaign,
  releaseCampaignPreload,
} from '../../../../features/play/campaignPreload';
import type { JournalApi, JournalManifest } from '../../../../shared/journal';
import { createMockNetworkApi } from '../../../support/networkApi';
import {
  createFakeAssetApi,
  createFakeSceneApi,
  makeScene,
} from '../../../support/scenes';

const campaignId = '8ef0e899-f66d-4a0b-9bd6-03c0f90c3325';

const manifest: JournalManifest = { entries: [], revision: 0 };

function createFakeJournalApi(): JournalApi {
  return {
    list: vi.fn(async () => ({ ok: true as const, value: manifest })),
    listUsers: vi.fn(async () => ({ ok: true as const, value: [] })),
    onPreparationProgress: () => () => undefined,
    prepareContent: vi.fn(async () => ({
      ok: true as const,
      value: { entries: [], pages: [] },
    })),
  } as unknown as JournalApi;
}

function apis() {
  return {
    assetApi: createFakeAssetApi(),
    journalApi: createFakeJournalApi(),
    networkApi: createMockNetworkApi(),
    sceneApi: createFakeSceneApi([makeScene({ name: 'Iron Keep' })]),
  };
}

describe('campaign preload', () => {
  afterEach(() => vi.useRealTimers());

  it('reads every tab a play screen opens with', async () => {
    const preload = await preloadCampaign({
      ...apis(),
      campaignId,
      role: 'gm',
    });

    expect(preload.assets).not.toBeNull();
    expect(preload.chat).not.toBeNull();
    expect(preload.journal?.manifest).toEqual(manifest);
    expect(preload.scenes?.scenes.map(({ name }) => name)).toEqual([
      'Iron Keep',
    ]);
  });

  it('reports the steps it is working through', async () => {
    const onProgress = vi.fn();
    await preloadCampaign({ ...apis(), campaignId, onProgress, role: 'gm' });

    expect(onProgress.mock.calls.length).toBeGreaterThan(0);
    for (const [progress] of onProgress.mock.calls) {
      expect(typeof progress.label).toBe('string');
      expect(progress.label).not.toHaveLength(0);
      expect(progress.completedItems).toBeGreaterThanOrEqual(0);
    }
    expect(
      new Set(onProgress.mock.calls.map(([progress]) => progress.phase)),
    ).toEqual(
      new Set([
        'asset-payloads',
        'campaign-data',
        'journal-content',
        'scene-thumbnails',
        'viewer-engines',
      ]),
    );
    const determinate = onProgress.mock.calls
      .map(([progress]) => progress)
      .filter((progress) => progress.totalItems > 0);
    expect(new Set(determinate.map(({ totalItems }) => totalItems)).size).toBe(1);
    expect(determinate.map(({ completedItems }) => completedItems)).toEqual(
      [...determinate.map(({ completedItems }) => completedItems)]
        .sort((left, right) => left - right),
    );
  });

  it('continues scene preparation on the same campaign-wide scale', async () => {
    const preload = await preloadCampaign({ ...apis(), campaignId, role: 'gm' });
    const graphProgress = campaignScenePreparationProgress(
      preload.preparation,
      {
        completedItems: 1,
        currentName: 'Iron Keep',
        phase: 'scene-graphs',
        totalItems: 1,
      },
    );
    const finalProgress = campaignScenePreparationProgress(
      preload.preparation,
      { completedItems: 1, phase: 'final-frame', totalItems: 1 },
    );

    expect(graphProgress.completedItems).toBeLessThan(graphProgress.totalItems);
    expect(finalProgress.completedItems).toBe(finalProgress.totalItems);
    expect(finalProgress.totalItems).toBe(graphProgress.totalItems);
  });

  it('retains prepared grants and releases them when an entry attempt is abandoned', async () => {
    const parts = apis();
    const assetId = '22222222-2222-4222-8222-222222222222';
    const preview = {
      assetId,
      displayName: 'World Map',
      format: 'png' as const,
      kind: 'image' as const,
      mimeType: 'image/png',
      token: '33333333-3333-4333-8333-333333333333',
      url: `blackbox-asset://token/${assetId}`,
    };
    vi.mocked(parts.assetApi.preparePreviews).mockResolvedValue({
      ok: true,
      value: { failedAssetIds: [], previews: [preview] },
    });

    const preload = await preloadCampaign({ ...parts, campaignId, role: 'gm' });
    expect(preload.previews.get(assetId)).toEqual(preview);

    releaseCampaignPreload(parts.assetApi, preload);
    expect(parts.assetApi.releasePreview).toHaveBeenCalledWith({
      token: preview.token,
    });
  });

  it('abandons a campaign-data item after 30 seconds without progress', async () => {
    vi.useFakeTimers();
    const parts = apis();
    vi.mocked(parts.sceneApi.list).mockReturnValue(new Promise(() => undefined));

    const loading = preloadCampaign({ ...parts, campaignId, role: 'gm' });
    await vi.advanceTimersByTimeAsync(CAMPAIGN_PRELOAD_INACTIVITY_MS);
    const preload = await loading;

    expect(preload.scenes).toBeNull();
    expect(preload.assets).not.toBeNull();
  });

  it('leaves out what it could not read rather than failing the campaign', async () => {
    const parts = apis();
    vi.mocked(parts.assetApi.list).mockResolvedValue({
      error: { code: 'unavailable', message: 'No library here.' },
      ok: false,
    });
    vi.mocked(parts.networkApi.getChatBootstrap).mockResolvedValue({
      error: { code: 'unavailable', message: 'No chat here.' },
      ok: false,
    });

    const preload = await preloadCampaign({ ...parts, campaignId, role: 'gm' });

    /* The tabs that could be read still open warm; the ones that could not are
       left to the stores that own them, which read and report them exactly as
       they did before anything was warmed. */
    expect(preload.assets).toBeNull();
    expect(preload.chat).toBeNull();
    expect(preload.journal?.manifest).toEqual(manifest);
    expect(preload.scenes).not.toBeNull();
  });

  it('opens the campaign even when a read throws outright', async () => {
    const parts = apis();
    vi.mocked(parts.assetApi.list).mockRejectedValue(new Error('bridge gone'));
    vi.mocked(parts.sceneApi.list).mockRejectedValue(new Error('bridge gone'));

    /* Warming a campaign must never be the reason it cannot be opened, so a
       read that fails outright is worth exactly as much as one that came back
       empty-handed: nothing warmed, and the campaign still opens. */
    const preload = await preloadCampaign({ ...parts, campaignId, role: 'gm' });

    expect(preload.assets).toBeNull();
    expect(preload.scenes).toBeNull();
    expect(preload.thumbnails.size).toBe(0);
    expect(preload.journal?.manifest).toEqual(manifest);
  });

  it('reads a journal without a roster for a player', async () => {
    const parts = apis();
    const preload = await preloadCampaign({
      ...parts,
      campaignId,
      role: 'player',
    });

    expect(preload.journal?.users).toEqual([]);
    expect(parts.journalApi.listUsers).not.toHaveBeenCalled();
  });

  it('keeps successful thumbnails when another preview throws', async () => {
    const goodAssetId = '22222222-2222-4222-8222-222222222222';
    const badAssetId = '33333333-3333-4333-8333-333333333333';
    const parts = apis();
    parts.sceneApi = createFakeSceneApi([
      makeScene({
        mapImage: {
          assetId: goodAssetId,
          height: 600,
          rotation: 0,
          width: 800,
          x: 0,
          y: 0,
        },
      }),
      makeScene({
        id: '44444444-4444-4444-8444-444444444444',
        mapImage: {
          assetId: badAssetId,
          height: 600,
          rotation: 0,
          width: 800,
          x: 0,
          y: 0,
        },
      }),
    ]);
    vi.mocked(parts.assetApi.getPreview).mockImplementation(
      async ({ assetId }) => {
        if (assetId === badAssetId) {
          throw new Error('preview bridge gone');
        }
        return {
          ok: true,
          value: {
            assetId,
            displayName: 'Map',
            format: 'png',
            kind: 'image',
            mimeType: 'image/png',
            token: '55555555-5555-4555-8555-555555555555',
            url: `blackbox-asset://token/${assetId}`,
          },
        };
      },
    );

    const preload = await preloadCampaign({
      ...parts,
      campaignId,
      role: 'gm',
    });

    expect([...preload.thumbnails.keys()]).toEqual([goodAssetId]);
  });
});
