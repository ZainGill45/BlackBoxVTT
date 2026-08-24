import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MapStage as ProductionMapStage,
} from '../../../../features/play/MapStage';
import {
  createFakeAssetApi,
  createFakeSceneApi,
  makeImageAsset,
  makeScene,
  testCampaignId,
} from '../../../support/scenes';
import type { PlaySession } from '../../../../features/play/types';
import { TEST_CAMPAIGN_SYSTEM } from '../../../support/gameSystems';
import {
  CANVAS_IMAGE_DRAG_TYPE,
  type AssetApi,
} from '../../../../shared/assets';
import {
  JOURNAL_ENTRY_DRAG_TYPE,
  type JournalApi,
} from '../../../../shared/journal';
import {
  DEFAULT_TOKEN_ASSET_ID,
  createEmptyImageLayers,
} from '../../../../shared/scenes';
import {
  DND5E_CHARACTER_ENTRY_TYPE_ID,
} from '../../../../systems/dnd5e/definition';
import { createDefaultDnd5eCharacterData } from '../../../../systems/dnd5e/characterData';
import { createFakeSceneRenderer } from '../../../support/sceneRenderer';

const session: PlaySession = {
  campaignId: testCampaignId,
  campaignName: 'Iron Meridian',
  role: 'gm',
  source: 'local',
  system: TEST_CAMPAIGN_SYSTEM,
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

  it('does not report readiness until every scene preparation settles', async () => {
    const { createRenderer, renderer } = fakeRenderer();
    const first = makeScene();
    const second = makeScene({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Lower Keep',
    });
    let finishPreparation!: () => void;
    renderer.prepareScenes = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishPreparation = resolve;
        }),
    );
    const onPrepared = vi.fn();

    render(
      <MapStage
        availableScenes={[first, second]}
        createRenderer={createRenderer}
        onPrepared={onPrepared}
        scene={first}
        session={session}
      />,
    );
    await waitFor(() => expect(renderer.prepareScenes).toHaveBeenCalled());
    expect(renderer.prepareScenes).toHaveBeenCalledWith(
      [first, second],
      {},
      first.id,
      expect.any(Function),
    );
    expect(onPrepared).not.toHaveBeenCalled();

    finishPreparation();
    await waitFor(() => expect(onPrepared).toHaveBeenCalledOnce());
  });

  it('keeps readiness covered until the prepared canvas crosses a paint boundary', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    );
    const { createRenderer, renderer } = fakeRenderer();
    const onPrepared = vi.fn();

    render(
      <MapStage
        createRenderer={createRenderer}
        onPrepared={onPrepared}
        scene={makeScene()}
        session={session}
      />,
    );

    await waitFor(() => expect(frames).toHaveLength(1));
    expect(renderer.resize).toHaveBeenCalled();
    expect(onPrepared).not.toHaveBeenCalled();

    act(() => frames[0](performance.now()));
    expect(onPrepared).not.toHaveBeenCalled();
    await waitFor(() => expect(onPrepared).toHaveBeenCalledOnce());
  });

  it('does not prepare a placeholder while a missing preload URL is acquired', async () => {
    const asset = makeImageAsset();
    const scene = makeScene({
      mapImage: {
        assetId: asset.id,
        height: 600,
        rotation: 0,
        width: 800,
        x: 400,
        y: 300,
      },
    });
    const assetApi = createFakeAssetApi([asset]);
    const getPreview = assetApi.getPreview;
    let finishPreview!: () => void;
    const previewPending = new Promise<void>((resolve) => {
      finishPreview = resolve;
    });
    assetApi.getPreview = vi.fn(
      async (input: Parameters<AssetApi['getPreview']>[0]) => {
        await previewPending;
        return getPreview(input);
      },
    );
    const { createRenderer, renderer } = fakeRenderer();

    render(
      <MapStage
        assetApi={assetApi}
        createRenderer={createRenderer}
        scene={scene}
        session={session}
      />,
    );

    await waitFor(() => expect(assetApi.getPreview).toHaveBeenCalledOnce());
    expect(renderer.mount).not.toHaveBeenCalled();

    finishPreview();
    await waitFor(() => expect(renderer.prepareScenes).toHaveBeenCalledOnce());
    expect(renderer.prepareScenes).toHaveBeenCalledWith(
      [scene],
      { [asset.id]: `blackbox-asset://token/${asset.id}` },
      scene.id,
      expect.any(Function),
    );
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

  it('tears the renderer down on unmount', async () => {
    const { createRenderer, renderer } = fakeRenderer();

    const { unmount } = render(
      <MapStage
        createRenderer={createRenderer}
        scene={makeScene()}
        session={session}
      />,
    );

    await waitFor(() => expect(renderer.mount).toHaveBeenCalledOnce());

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

  it('drops an editable Character as a linked token and honors GM Alt placement', async () => {
    const { createRenderer, renderer } = fakeRenderer();
    renderer.clientToScene = vi.fn(() => ({ x: 123, y: 234 }));
    const scene = makeScene({ images: createEmptyImageLayers() });
    const characterId = '77777777-7777-4777-8777-777777777777';
    const onCommitObjects = vi.fn(async (_scene, state) => ({
      ...scene,
      ...state,
      revision: 1,
    }));
    const character = {
      capabilities: {
        delete: true,
        edit: true,
        managePages: false,
        managePermissions: true,
        reorder: true,
        view: true,
      },
      data: createDefaultDnd5eCharacterData(),
      detail: null,
      groupId: 'dnd5e.characters',
      id: characterId,
      kind: 'system' as const,
      name: 'Aria Stone',
      permissionRevision: 0,
      permissions: { allPlayers: 'none' as const, overrides: [] },
      position: 0,
      revision: 0,
      typeId: DND5E_CHARACTER_ENTRY_TYPE_ID,
    };
    const journalApi = {
      ...window.blackBox.journal,
      getEntry: vi.fn(async () => ({ ok: true as const, value: character })),
    } as JournalApi;
    render(
      <MapStage
        createRenderer={createRenderer}
        journalApi={journalApi}
        onCommitObjects={onCommitObjects}
        scene={scene}
        session={session}
      />,
    );
    await waitFor(() => expect(renderer.mount).toHaveBeenCalled());

    const stage = screen.getByRole('region', { name: /map play area/i });
    const drop = createEvent.drop(stage, {
      clientX: 300,
      clientY: 200,
      dataTransfer: {
        getData: (type: string) => type === JOURNAL_ENTRY_DRAG_TYPE
          ? JSON.stringify({
              entryId: characterId,
              typeId: DND5E_CHARACTER_ENTRY_TYPE_ID,
            })
          : '',
      },
    });
    Object.defineProperty(drop, 'altKey', { value: true });
    Object.defineProperty(drop, 'getModifierState', {
      value: (key: string) => key === 'Alt',
    });
    fireEvent(stage, drop);

    await waitFor(() => expect(onCommitObjects).toHaveBeenCalledOnce());
    const state = onCommitObjects.mock.calls[0][1];
    expect(state.images.gm).toMatchObject([{
      assetId: DEFAULT_TOKEN_ASSET_ID,
      size: { height: 1, kind: 'default', width: 1 },
      source: { entryId: characterId, kind: 'linked' },
    }]);
    expect(state.images.token).toEqual([]);
    expect(renderer.selectImages).toHaveBeenCalledWith([
      state.images.gm[0].id,
    ]);
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

  it('loads token health and applies a command typed into the bar editor', async () => {
    const { createRenderer, renderer } = fakeRenderer();
    const currentScene = makeScene();
    const sceneApi = createFakeSceneApi([currentScene]);
    const tokenId = '44444444-4444-4444-8444-444444444444';
    const health = [{
      currentHundredths: 1_750,
      down: false,
      editable: true,
      maximumHundredths: 2_000,
      ratio: 0.875,
      tokenId,
    }];
    vi.mocked(sceneApi.listTokenHealth)
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValueOnce({ ok: true, value: health });
    vi.mocked(sceneApi.adjustTokenHealth).mockResolvedValue({
      ok: true,
      value: { ...currentScene, revision: currentScene.revision + 1 },
    });

    render(
      <MapStage
        createRenderer={createRenderer}
        scene={currentScene}
        sceneApi={sceneApi}
        session={session}
      />,
    );

    await waitFor(() => expect(renderer.setInteraction).toHaveBeenCalled());
    const interaction = vi.mocked(renderer.setInteraction).mock.calls.at(-1)?.[0];
    act(() => {
      interaction?.onAdjustTokenHealth?.({
        height: 7,
        tokenId,
        width: 70,
        x: 120,
        y: 40,
      });
    });

    const editor = await screen.findByRole('textbox', {
      name: 'Adjust token health',
    });
    expect(editor).toHaveValue('Current');
    fireEvent.change(editor, { target: { value: 'Current-2.5' } });
    fireEvent.keyDown(editor, { key: 'Enter' });

    await waitFor(() => {
      expect(sceneApi.adjustTokenHealth).toHaveBeenCalledWith({
        campaignId: session.campaignId,
        command: 'Current-2.5',
        operationId: expect.any(String),
        sceneId: currentScene.id,
        tokenId,
      });
      expect(renderer.setTokenHealth).toHaveBeenCalledWith(health);
    });
  });

  it('ignores a health response after the viewed scene changes', async () => {
    const { createRenderer, renderer } = fakeRenderer();
    const currentScene = makeScene();
    const nextScene = makeScene({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Next Scene',
    });
    const sceneApi = createFakeSceneApi([currentScene, nextScene]);
    let resolveAdjustment!: (
      value: Awaited<ReturnType<typeof sceneApi.adjustTokenHealth>>,
    ) => void;
    const pendingAdjustment = new Promise<
      Awaited<ReturnType<typeof sceneApi.adjustTokenHealth>>
    >((resolve) => {
      resolveAdjustment = resolve;
    });
    vi.mocked(sceneApi.adjustTokenHealth)
      .mockReturnValueOnce(pendingAdjustment)
      .mockResolvedValueOnce({
        ok: true,
        value: { ...nextScene, revision: nextScene.revision + 1 },
      });
    vi.mocked(sceneApi.listTokenHealth).mockResolvedValue({ ok: true, value: [] });

    const view = render(
      <MapStage
        createRenderer={createRenderer}
        scene={currentScene}
        sceneApi={sceneApi}
        session={session}
      />,
    );

    await waitFor(() => expect(renderer.setInteraction).toHaveBeenCalled());
    const interaction = vi.mocked(renderer.setInteraction).mock.calls.at(-1)?.[0];
    const openAndSubmit = async () => {
      act(() => {
        interaction?.onAdjustTokenHealth?.({
          height: 7,
          tokenId: '44444444-4444-4444-8444-444444444444',
          width: 70,
          x: 120,
          y: 40,
        });
      });
      const editor = await screen.findByRole('textbox', {
        name: 'Adjust token health',
      });
      fireEvent.change(editor, { target: { value: 'Current-1' } });
      fireEvent.keyDown(editor, { key: 'Enter' });
    };

    await openAndSubmit();
    await waitFor(() => expect(sceneApi.adjustTokenHealth).toHaveBeenCalledTimes(1));
    view.rerender(
      <MapStage
        createRenderer={createRenderer}
        scene={nextScene}
        sceneApi={sceneApi}
        session={session}
      />,
    );
    await waitFor(() => expect(sceneApi.listTokenHealth).toHaveBeenCalledWith({
      campaignId: session.campaignId,
      sceneId: nextScene.id,
    }));
    await act(async () => {
      resolveAdjustment({
        ok: true,
        value: { ...currentScene, revision: currentScene.revision + 1 },
      });
      await pendingAdjustment;
    });

    await openAndSubmit();
    await waitFor(() => expect(sceneApi.adjustTokenHealth).toHaveBeenCalledTimes(2));
    expect(vi.mocked(sceneApi.adjustTokenHealth).mock.calls.at(-1)?.[0])
      .toMatchObject({ sceneId: nextScene.id });
  });

  it('keeps the health editor on its bar through camera moves', async () => {
    const { createRenderer, renderer } = fakeRenderer();
    const currentScene = makeScene();
    const sceneApi = createFakeSceneApi([currentScene]);
    const tokenId = '44444444-4444-4444-8444-444444444444';
    vi.mocked(sceneApi.listTokenHealth).mockResolvedValue({ ok: true, value: [] });

    render(
      <MapStage
        createRenderer={createRenderer}
        scene={currentScene}
        sceneApi={sceneApi}
        session={session}
      />,
    );

    await waitFor(() => expect(renderer.setInteraction).toHaveBeenCalled());
    const interaction = vi.mocked(renderer.setInteraction).mock.calls.at(-1)?.[0];
    act(() => {
      interaction?.onAdjustTokenHealth?.({
        height: 7,
        tokenId,
        width: 70,
        x: 120,
        y: 40,
      });
    });

    // Opening the editor turns the bar itself into the field's frame.
    expect(renderer.setTokenHealthEditing).toHaveBeenCalledWith(tokenId);
    const editor = await screen.findByRole('textbox', {
      name: 'Adjust token health',
    });
    const panel = editor.parentElement as HTMLElement;
    expect(panel.style.left).toBe('120px');

    // The renderer re-reports the bar as the camera moves; the field follows it
    // instead of staying at the pixel it was opened over.
    act(() => {
      interaction?.onTokenHealthEditorRect?.({
        height: 48,
        tokenId,
        width: 140,
        x: 300,
        y: 210,
      });
    });
    expect(panel.style.left).toBe('300px');
    expect(panel.style.top).toBe('210px');
    expect(panel.style.width).toBe('140px');
    expect(panel.style.height).toBe('48px');

    // Losing the bar leaves the field nothing to sit on.
    act(() => {
      interaction?.onTokenHealthEditorRect?.(null);
    });
    expect(screen.queryByRole('textbox', { name: 'Adjust token health' }))
      .not.toBeInTheDocument();
  });

  it('returns the bar to its resting paint when the editor closes', async () => {
    const { createRenderer, renderer } = fakeRenderer();
    const currentScene = makeScene();
    const sceneApi = createFakeSceneApi([currentScene]);
    const tokenId = '44444444-4444-4444-8444-444444444444';
    vi.mocked(sceneApi.listTokenHealth).mockResolvedValue({ ok: true, value: [] });

    render(
      <MapStage
        createRenderer={createRenderer}
        scene={currentScene}
        sceneApi={sceneApi}
        session={session}
      />,
    );

    await waitFor(() => expect(renderer.setInteraction).toHaveBeenCalled());
    const interaction = vi.mocked(renderer.setInteraction).mock.calls.at(-1)?.[0];
    act(() => {
      interaction?.onAdjustTokenHealth?.({
        height: 7,
        tokenId,
        width: 70,
        x: 120,
        y: 40,
      });
    });

    const editor = await screen.findByRole('textbox', {
      name: 'Adjust token health',
    });
    fireEvent.keyDown(editor, { key: 'Escape' });

    expect(renderer.setTokenHealthEditing).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole('textbox', { name: 'Adjust token health' }))
      .not.toBeInTheDocument();
  });

  it('wires GM fog settings and authoritative commits without preview transport', async () => {
    const { createRenderer, renderer } = fakeRenderer();
    const currentScene = makeScene();
    const operationId = '44444444-4444-4444-8444-444444444444';
    const onCommitFog = vi.fn(async () => ({
      ...currentScene,
      revision: currentScene.revision + 1,
    }));
    render(
      <MapStage
        activeTool="fog"
        createRenderer={createRenderer}
        fogMode="hide"
        fogSettings={{
          brushHardness: 0.45,
          brushWidth: 90,
          gmOpacity: 0.25,
        }}
        fogSubtool="brush"
        onCommitFog={onCommitFog}
        scene={currentScene}
        session={session}
      />,
    );

    await waitFor(() => expect(renderer.setInteraction).toHaveBeenCalled());
    const interaction = vi.mocked(renderer.setInteraction).mock.calls.at(-1)?.[0];
    expect(interaction).toMatchObject({
      fogBrushHardness: 0.45,
      fogBrushWidth: 90,
      fogEnabled: true,
      fogGmOpacity: 0.25,
      fogMode: 'hide',
      fogSubtool: 'brush',
    });
    const operation = {
      hardness: 0.45,
      id: operationId,
      kind: 'brush' as const,
      mode: 'hide' as const,
      points: [{ x: 10, y: 20 }],
      width: 90,
    };
    await interaction?.onFogCommit?.(
      {
        kind: 'append',
        operation,
      },
      operationId,
    );
    expect(onCommitFog).toHaveBeenCalledWith(
      currentScene,
      expect.objectContaining({ kind: 'append' }),
      operationId,
    );
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
      system: TEST_CAMPAIGN_SYSTEM,
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
