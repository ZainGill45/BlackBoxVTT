import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  createEmptySceneManifest,
  type SceneApi,
  type SceneChangedEvent,
  type SceneManifest,
} from '../../../../../shared/scenes';
import {
  createFakeSceneApi,
  makeScene,
  testCampaignId,
} from '../../../../support/scenes';
import { useScenes } from '../../../../../features/play/scenes/useScenes';

function Probe({ sceneApi }: { sceneApi: SceneApi }) {
  const scenes = useScenes(sceneApi, testCampaignId, false);
  return <div>{scenes.viewedScene?.name ?? 'No scene'}</div>;
}

describe('useScenes', () => {
  it('does not let an older initial list overwrite a presented-scene event', async () => {
    const staleScene = makeScene({ name: 'Stale scene' });
    const presentedScene = makeScene({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Presented scene',
    });
    const staleManifest: SceneManifest = {
      ...createEmptySceneManifest(),
      activeSceneId: staleScene.id,
      scenes: [staleScene],
    };
    const presentedManifest: SceneManifest = {
      ...createEmptySceneManifest(),
      activeSceneId: presentedScene.id,
      revision: 1,
      scenes: [presentedScene],
    };
    let resolveList:
      | ((result: Awaited<ReturnType<SceneApi['list']>>) => void)
      | undefined;
    let changedListener: ((event: SceneChangedEvent) => void) | undefined;
    const sceneApi = createFakeSceneApi();
    sceneApi.list = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<SceneApi['list']>>>((resolve) => {
          resolveList = resolve;
        }),
    );
    sceneApi.onChanged = vi.fn((listener) => {
      changedListener = listener;
      return () => undefined;
    });

    render(<Probe sceneApi={sceneApi} />);
    await waitFor(() => expect(changedListener).toBeDefined());

    act(() => {
      changedListener?.({
        campaignId: testCampaignId,
        manifest: presentedManifest,
      });
    });
    expect(screen.getByText('Presented scene')).toBeInTheDocument();

    await act(async () => {
      resolveList?.({ ok: true, value: staleManifest });
      await Promise.resolve();
    });

    expect(screen.getByText('Presented scene')).toBeInTheDocument();
  });
});
