import { renderHook, waitFor } from '@testing-library/react';
import type { RenderHookResult } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createFakeAssetApi,
  makeScene,
  testCampaignId,
} from '../../../support/scenes';
import type { SceneImage, SceneRecord } from '../../../../shared/scenes';
import { useSceneImageUrls } from '../../../../features/play/useSceneImageUrls';

const MAP_ASSET_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN_ASSET_ID = '33333333-3333-4333-8333-333333333333';

function image(id: string, assetId: string): SceneImage {
  return { assetId, height: 100, id, rotation: 0, width: 100, x: 100, y: 100 };
}

/** A scene holding only the map image. */
const mapOnly = () => makeScene({ mapImage: image('map', MAP_ASSET_ID) });

/** The same scene once a token has been added alongside the map. */
const mapAndToken = () =>
  makeScene({
    images: { gm: [], map: [], token: [image('token', TOKEN_ASSET_ID)] },
    mapImage: image('map', MAP_ASSET_ID),
    revision: 1,
  });

/** The scene after the map image has been removed, leaving the token. */
const tokenOnly = () =>
  makeScene({
    images: { gm: [], map: [], token: [image('token', TOKEN_ASSET_ID)] },
    revision: 2,
  });

let assetApi: ReturnType<typeof createFakeAssetApi>;
let hook: RenderHookResult<
  Record<string, string>,
  { scene: SceneRecord }
>;

beforeEach(async () => {
  assetApi = createFakeAssetApi();
  hook = renderHook(
    ({ scene }) => useSceneImageUrls(assetApi, testCampaignId, scene),
    { initialProps: { scene: mapOnly() } },
  );
  await waitFor(() => {
    expect(hook.result.current[MAP_ASSET_ID]).toContain(MAP_ASSET_ID);
  });
});

describe('useSceneImageUrls acquiring previews', () => {
  it('requests a preview for the scene it is given', () => {
    expect(assetApi.getPreview).toHaveBeenCalledTimes(1);
  });

  it('requests a preview only for an asset it has not seen', async () => {
    hook.rerender({ scene: mapAndToken() });

    await waitFor(() => {
      expect(hook.result.current[TOKEN_ASSET_ID]).toContain(TOKEN_ASSET_ID);
    });
    // One for the map, one for the token — the map is not fetched twice.
    expect(assetApi.getPreview).toHaveBeenCalledTimes(2);
  });

  it('keeps showing the existing image while a new one loads', async () => {
    hook.rerender({ scene: mapAndToken() });

    // Synchronously after the change: collapsing to placeholders here would
    // blank the whole stage every time a token appears.
    expect(hook.result.current[MAP_ASSET_ID]).toContain(MAP_ASSET_ID);
    await waitFor(() => {
      expect(hook.result.current[TOKEN_ASSET_ID]).toContain(TOKEN_ASSET_ID);
    });
  });
});

describe('useSceneImageUrls releasing previews', () => {
  it('drops the URL for an asset the scene no longer uses', async () => {
    hook.rerender({ scene: mapAndToken() });
    await waitFor(() => {
      expect(hook.result.current[TOKEN_ASSET_ID]).toContain(TOKEN_ASSET_ID);
    });

    hook.rerender({ scene: tokenOnly() });

    await waitFor(() => {
      expect(hook.result.current[MAP_ASSET_ID]).toBeUndefined();
    });
    expect(assetApi.releasePreview).toHaveBeenCalledTimes(1);
  });

  it('releases every remaining grant on unmount', async () => {
    hook.rerender({ scene: mapAndToken() });
    await waitFor(() => {
      expect(hook.result.current[TOKEN_ASSET_ID]).toContain(TOKEN_ASSET_ID);
    });

    hook.unmount();

    expect(assetApi.releasePreview).toHaveBeenCalledTimes(2);
  });
});
