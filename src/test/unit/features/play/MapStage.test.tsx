import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MapStage as ProductionMapStage,
  type MapStageControls,
} from '../../../../features/play/MapStage';
import {
  createFakeAssetApi,
  createFakeSceneApi,
  makeImageAsset,
  makeScene,
  testCampaignId,
} from '../../../support/scenes';
import type { PlaySession } from '../../../../features/play/types';
import { CANVAS_IMAGE_DRAG_TYPE } from '../../../../shared/assets';
import { createEmptyImageLayers } from '../../../../shared/scenes';
import { createFakeSceneRenderer } from '../../../support/sceneRenderer';

const session: PlaySession = {
  campaignId: testCampaignId,
  campaignName: 'Iron Meridian',
  role: 'gm',
  source: 'local',
};

const stageApis = {
  assetApi: createFakeAssetApi(),
  sceneApi: createFakeSceneApi(),
};

type TestMapStageProps = Omit<
  ComponentProps<typeof ProductionMapStage>,
  'assetApi' | 'networkApi' | 'sceneApi'
> &
  Partial<
    Pick<
      ComponentProps<typeof ProductionMapStage>,
      'assetApi' | 'networkApi' | 'sceneApi'
    >
  >;

function MapStage(props: TestMapStageProps) {
  return (
    <ProductionMapStage
      {...stageApis}
      networkApi={props.networkApi ?? window.blackBox.network}
      {...props}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fakeRenderer() {
  const renderer = createFakeSceneRenderer();
  return { createRenderer: () => renderer, renderer };
}

describe('MapStage', () => {
  it('mounts a renderer and hands it the current scene', async () => {
    const { createRenderer, renderer } = fakeRenderer();
    const scene = makeScene();

    render(
      <MapStage
        createRenderer={createRenderer}
        scene={scene}
        session={session}
      />,
    );

    await waitFor(() => {
      expect(renderer.mount).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(renderer.setScene).toHaveBeenCalledWith(scene, {});
    });
    expect(renderer.resize).toHaveBeenCalled();
  });

  it('resolves the map image before handing the scene over', async () => {
    const { createRenderer, renderer } = fakeRenderer();
    const asset = makeImageAsset();
    const scene = makeScene({
      mapImage: {
        assetId: asset.id,
        height: 600,
        rotation: 0,
        width: 800,
        x: 0,
        y: 0,
      },
    });

    render(
      <MapStage
        assetApi={createFakeAssetApi([asset])}
        createRenderer={createRenderer}
        scene={scene}
        session={session}
      />,
    );

    await waitFor(() => {
      expect(renderer.setScene).toHaveBeenCalledWith(
        scene,
        {
          [asset.id]: `blackbox-asset://token/${asset.id}`,
        },
      );
    });
  });

  it('reports the viewed scene to screen readers', () => {
    const { createRenderer } = fakeRenderer();
    const { rerender } = render(
      <MapStage createRenderer={createRenderer} scene={null} session={session} />,
    );

    expect(
      screen.getByText('No scene is being displayed.'),
    ).toBeInTheDocument();

    rerender(
      <MapStage
        createRenderer={createRenderer}
        scene={makeScene()}
        session={session}
      />,
    );

    expect(
      screen.getByText('Viewing the scene Iron Keep.'),
    ).toBeInTheDocument();
  });

  it('exposes centering and tears the renderer down on unmount', async () => {
    const { createRenderer, renderer } = fakeRenderer();
    const controls = createRef<MapStageControls>();

    const { unmount } = render(
      <MapStage
        controlsRef={controls}
        createRenderer={createRenderer}
        scene={makeScene()}
        session={session}
      />,
    );

    await waitFor(() => {
      expect(controls.current).not.toBeNull();
    });
    controls.current?.centerView();
    expect(renderer.fitToScene).toHaveBeenCalledTimes(1);

    unmount();
    await waitFor(() => {
      expect(renderer.destroy).toHaveBeenCalledTimes(1);
    });
  });

  it('places a new Storage image in the active layer and selects it', async () => {
    const { createRenderer, renderer } = fakeRenderer();
    renderer.clientToScene = vi.fn(() => ({ x: 123, y: 234 }));
    renderer.selectImages = vi.fn();
    const asset = makeImageAsset();
    const assetApi = createFakeAssetApi([asset]);
    const scene = makeScene({ images: createEmptyImageLayers() });
    const onCommitImages = vi.fn(async (_scene, state) => ({
      ...scene,
      ...state,
      revision: 1,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        blob: async () => new Blob([], { type: 'image/png' }),
        ok: true,
      })),
    );
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({
        close: vi.fn(),
        height: 100,
        width: 200,
      })),
    );
    render(
      <MapStage
        assetApi={assetApi}
        createRenderer={createRenderer}
        onCommitImages={onCommitImages}
        scene={scene}
        session={session}
      />,
    );
    await waitFor(() => expect(renderer.mount).toHaveBeenCalled());

    fireEvent.drop(
      screen.getByRole('region', { name: /map play area/i }),
      {
        clientX: 300,
        clientY: 200,
        dataTransfer: {
          getData: (type: string) =>
            type === CANVAS_IMAGE_DRAG_TYPE ? asset.id : '',
        },
      },
    );

    await waitFor(() => expect(onCommitImages).toHaveBeenCalledTimes(1));
    const state = onCommitImages.mock.calls[0][1];
    expect(state.images.token[0]).toMatchObject({
      assetId: asset.id,
      height: 100,
      width: 200,
      x: 100,
      y: 260,
    });
    expect(renderer.selectImages).toHaveBeenCalledWith([
      state.images.token[0].id,
    ]);
    expect(assetApi.releasePreview).toHaveBeenCalled();
  });

  it('enables pings only for Select and optimistically sends and displays them', async () => {
    const { createRenderer, renderer } = fakeRenderer();
    const currentScene = makeScene();
    const sendMapPing = vi.spyOn(window.blackBox.network, 'sendMapPing');
    const sendMeasurementUpdate = vi.spyOn(
      window.blackBox.network,
      'sendMeasurementUpdate',
    );
    const { rerender } = render(
      <MapStage
        activeTool="select"
        createRenderer={createRenderer}
        scene={currentScene}
        session={session}
      />,
    );
    await waitFor(() => expect(renderer.setInteraction).toHaveBeenCalled());
    const interaction = vi.mocked(renderer.setInteraction).mock.calls.at(-1)?.[0];
    expect(interaction?.pingEnabled).toBe(true);

    interaction?.onPing?.({
      id: '44444444-4444-4444-8444-444444444444',
      pullPlayers: false,
      sceneId: currentScene.id,
      x: 100,
      y: 200,
    });
    expect(renderer.showPing).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '44444444-4444-4444-8444-444444444444',
      }),
      false,
    );
    expect(sendMapPing).toHaveBeenCalledWith({
      campaignId: session.campaignId,
      id: '44444444-4444-4444-8444-444444444444',
      pullPlayers: false,
      sceneId: currentScene.id,
      x: 100,
      y: 200,
    });

    rerender(
      <MapStage
        activeTool="measure"
        createRenderer={createRenderer}
        scene={currentScene}
        session={session}
      />,
    );
    await waitFor(() =>
      expect(
        vi.mocked(renderer.setInteraction).mock.calls.at(-1)?.[0]
          ?.pingEnabled,
      ).toBe(false),
    );
    const measureInteraction =
      vi.mocked(renderer.setInteraction).mock.calls.at(-1)?.[0];
    expect(measureInteraction?.measureEnabled).toBe(true);
    measureInteraction?.onMeasurementUpdate?.({
      active: true,
      measurementId: '55555555-5555-4555-8555-555555555555',
      points: [{ x: 10, y: 20 }],
      sceneId: currentScene.id,
      updateSequence: 1,
    });
    expect(sendMeasurementUpdate).toHaveBeenCalledWith({
      active: true,
      campaignId: session.campaignId,
      measurementId: '55555555-5555-4555-8555-555555555555',
      points: [{ x: 10, y: 20 }],
      sceneId: currentScene.id,
      updateSequence: 1,
    });
  });

  it('delivers only measurement updates for the active campaign scene', async () => {
    const { createRenderer, renderer } = fakeRenderer();
    const currentScene = makeScene();
    let receiveMeasurement:
      | Parameters<typeof window.blackBox.network.onMeasurementUpdate>[0]
      | undefined;
    vi.spyOn(
      window.blackBox.network,
      'onMeasurementUpdate',
    ).mockImplementation((listener) => {
      receiveMeasurement = listener;
      return () => undefined;
    });
    render(
      <MapStage
        activeTool="measure"
        createRenderer={createRenderer}
        scene={currentScene}
        session={session}
      />,
    );
    await waitFor(() => expect(receiveMeasurement).toBeDefined());
    const update = {
      active: true,
      campaignId: session.campaignId,
      measurementId: '55555555-5555-4555-8555-555555555555',
      points: [{ x: 10, y: 20 }],
      sceneId: currentScene.id,
      sourceId: '66666666-6666-4666-8666-666666666666',
      updateSequence: 1,
    };
    await waitFor(() => {
      receiveMeasurement?.(update);
      expect(renderer.showMeasurement).toHaveBeenCalledWith(update);
    });
    receiveMeasurement?.({
      ...update,
      campaignId: '77777777-7777-4777-8777-777777777777',
    });
    receiveMeasurement?.({
      ...update,
      sceneId: '88888888-8888-4888-8888-888888888888',
    });
    expect(renderer.showMeasurement).toHaveBeenCalledTimes(1);
  });

  it('delivers network pulls to players, filters scenes, and deduplicates the sender echo', async () => {
    const { createRenderer, renderer } = fakeRenderer();
    const currentScene = makeScene();
    let receivePing:
      | Parameters<typeof window.blackBox.network.onMapPing>[0]
      | undefined;
    vi.spyOn(window.blackBox.network, 'onMapPing').mockImplementation(
      (listener) => {
        receivePing = listener;
        return () => undefined;
      },
    );
    const playerSession: PlaySession = {
      campaignId: session.campaignId,
      campaignName: session.campaignName,
      host: '127.0.0.1',
      port: 30_000,
      role: 'player',
      source: 'remote',
      userId: '55555555-5555-4555-8555-555555555555',
      username: 'Alice',
    };
    render(
      <MapStage
        createRenderer={createRenderer}
        scene={currentScene}
        session={playerSession}
      />,
    );
    await waitFor(() => expect(renderer.setInteraction).toHaveBeenCalled());
    await waitFor(() => expect(receivePing).toBeDefined());

    receivePing?.({
      campaignId: session.campaignId,
      id: '66666666-6666-4666-8666-666666666666',
      pullPlayers: true,
      sceneId: currentScene.id,
      x: 300,
      y: 400,
    });
    expect(renderer.showPing).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '66666666-6666-4666-8666-666666666666',
      }),
      true,
    );

    const interaction = vi.mocked(renderer.setInteraction).mock.calls.at(-1)?.[0];
    interaction?.onPing?.({
      id: '77777777-7777-4777-8777-777777777777',
      pullPlayers: true,
      sceneId: currentScene.id,
      x: 500,
      y: 600,
    });
    receivePing?.({
      campaignId: session.campaignId,
      id: '77777777-7777-4777-8777-777777777777',
      pullPlayers: true,
      sceneId: currentScene.id,
      x: 500,
      y: 600,
    });
    receivePing?.({
      campaignId: session.campaignId,
      id: '88888888-8888-4888-8888-888888888888',
      pullPlayers: true,
      sceneId: '99999999-9999-4999-8999-999999999999',
      x: 500,
      y: 600,
    });
    expect(renderer.showPing).toHaveBeenCalledTimes(2);
  });

  it('lets a player-originated network pull center the GM camera', async () => {
    const { createRenderer, renderer } = fakeRenderer();
    const currentScene = makeScene();
    let receivePing:
      | Parameters<typeof window.blackBox.network.onMapPing>[0]
      | undefined;
    vi.spyOn(window.blackBox.network, 'onMapPing').mockImplementation(
      (listener) => {
        receivePing = listener;
        return () => undefined;
      },
    );
    render(
      <MapStage
        createRenderer={createRenderer}
        scene={currentScene}
        session={session}
      />,
    );
    await waitFor(() => expect(renderer.setInteraction).toHaveBeenCalled());
    await waitFor(() => expect(receivePing).toBeDefined());

    receivePing?.({
      campaignId: session.campaignId,
      id: '99999999-9999-4999-8999-999999999999',
      pullPlayers: true,
      sceneId: currentScene.id,
      x: 700,
      y: 500,
    });

    expect(renderer.showPing).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '99999999-9999-4999-8999-999999999999',
      }),
      true,
    );
  });
});
