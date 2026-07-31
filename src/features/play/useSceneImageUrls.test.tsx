import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeAssetApi, makeScene, testCampaignId } from '../../test/scenes';
import type { SceneImage } from '../../shared/scenes';
import { useSceneImageUrls } from './useSceneImageUrls';

const MAP_ASSET_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN_ASSET_ID = '33333333-3333-4333-8333-333333333333';

function image(id: string, assetId: string): SceneImage {
  return {
    assetId,
    height: 100,
    id,
    rotation: 0,
    width: 100,
    x: 100,
    y: 100,
  };
}

describe('useSceneImageUrls', () => {
  it('retains existing preview URLs while incrementally adding and removing assets', async () => {
    const assetApi = createFakeAssetApi();
    const initial = makeScene({
      mapImage: image('map', MAP_ASSET_ID),
    });
    const { result, rerender, unmount } = renderHook(
      ({ scene }) =>
        useSceneImageUrls(assetApi, testCampaignId, scene),
      { initialProps: { scene: initial } },
    );

    await waitFor(() => {
      expect(result.current[MAP_ASSET_ID]).toContain(MAP_ASSET_ID);
    });
    const getPreview = assetApi.getPreview;
    expect(getPreview).toHaveBeenCalledTimes(1);

    rerender({
      scene: makeScene({
        images: {
          gm: [],
          map: [],
          token: [image('token', TOKEN_ASSET_ID)],
        },
        mapImage: image('map', MAP_ASSET_ID),
        revision: 1,
      }),
    });

    // The map URL remains available during the token's asynchronous preview
    // acquisition instead of collapsing the whole renderer to placeholders.
    expect(result.current[MAP_ASSET_ID]).toContain(MAP_ASSET_ID);
    await waitFor(() => {
      expect(result.current[TOKEN_ASSET_ID]).toContain(TOKEN_ASSET_ID);
    });
    expect(getPreview).toHaveBeenCalledTimes(2);

    rerender({
      scene: makeScene({
        images: {
          gm: [],
          map: [],
          token: [image('token', TOKEN_ASSET_ID)],
        },
        revision: 2,
      }),
    });
    await waitFor(() => {
      expect(result.current[MAP_ASSET_ID]).toBeUndefined();
    });
    expect(assetApi.releasePreview).toHaveBeenCalledTimes(1);

    unmount();
    expect(assetApi.releasePreview).toHaveBeenCalledTimes(2);
  });
});
