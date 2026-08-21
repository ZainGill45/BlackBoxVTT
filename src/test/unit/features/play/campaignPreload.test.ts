import { describe, expect, it, vi } from 'vitest';
import { preloadCampaign } from '../../../../features/play/campaignPreload';
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
    const onStep = vi.fn();
    await preloadCampaign({ ...apis(), campaignId, onStep, role: 'gm' });

    expect(onStep.mock.calls.length).toBeGreaterThan(0);
    for (const [label] of onStep.mock.calls) {
      expect(typeof label).toBe('string');
      expect(label).not.toHaveLength(0);
    }
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
