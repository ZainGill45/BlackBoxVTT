import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CANVAS_IMAGE_DRAG_TYPE, type AssetApi } from '../../shared/assets';
import { ErrorModal } from '../../components/ui/ErrorModal';
import { InlineInput } from '../../components/ui/InlineInput';
import {
  JOURNAL_ENTRY_DRAG_TYPE,
  type JournalApi,
  type SystemJournalEntry,
} from '../../shared/journal';
import type { JournalWindowApi } from '../../shared/journalWindows';
import {
  DEFAULT_TRANSFORM_PREVIEW_RATE,
  type NetworkApi,
} from '../../shared/network';
import {
  sceneObjectStateOf,
  DEFAULT_TOKEN_ASSET_ID,
  MAX_SCENE_IMAGES,
  type SceneApi,
  type SceneImageLayer,
  type SceneObjectState,
  type SceneArrangement,
  type SceneFogMutation,
  type SceneRecord,
  type SceneToken,
} from '../../shared/scenes';
import { getJournalEntryTypeDefinition } from '../../systems/catalog';
import { SystemJournalEntryModal } from '../../systems/rendererRegistry';
import type {
  ScenePreparationProgress,
  SceneRendererHandle,
} from './canvas/SceneRenderer';
import type { TokenHealthHit } from './canvas/tokenHealthRenderer';
import type { PlaySession, PlayToolId } from './types';
import type { TextSettings } from './textSettings';
import type { ShapeSettings, ShapeSubtool } from './shapeSettings';
import type {
  FogMode,
  FogSubtool,
  FogToolSettings,
} from './fogSettings';
import {
  drawingStyle,
  type PaintSettings,
  type PaintSubtool,
} from './paintSettings';
import { snapMove } from './canvas/imageGeometry';
import { useSceneImageResources } from './useSceneImageUrls';
import styles from './PlayScreen.module.css';
import { TokenInspector } from './TokenInspector';

/*
 * Text is sized straight off the bar it sits in, with no legibility floor: a
 * field that stopped shrinking with its bar would start overhanging it, which is
 * the overlay look this editor exists to avoid. Zooming in is how you get a
 * bigger field.
 */
const HEALTH_EDITOR_FONT_RATIO = 0.55;
const EMPTY_IMAGE_URLS: Record<string, string> = {};
const EMPTY_SCENES: readonly SceneRecord[] = [];

function rememberPing(seen: Set<string>, id: string): boolean {
  if (seen.has(id)) {
    return false;
  }
  seen.add(id);
  if (seen.size > 256) {
    const oldest = seen.values().next().value;
    if (oldest) {
      seen.delete(oldest);
    }
  }
  return true;
}

interface MapStageProps {
  availableScenes?: readonly SceneRecord[];
  assetApi: AssetApi;
  /** Injected so tests can drive the stage without a WebGL context. */
  createRenderer?: () => SceneRendererHandle;
  editableTokenEntryIds?: ReadonlySet<string>;
  inspectableTokenEntryIds?: ReadonlySet<string>;
  networkApi: NetworkApi;
  journalApi?: JournalApi;
  journalWindowApi?: Pick<JournalWindowApi, 'focusCharacter'>;
  networkUpdateRate?: number;
  onPrepared?: () => void;
  onPreparationProgress?: (progress: ScenePreparationProgress) => void;
  activeLayer?: SceneImageLayer;
  activeTool?: PlayToolId;
  onActiveLayerChange?: (layer: SceneImageLayer) => void;
  onCommitImages?: (
    scene: SceneRecord,
    state: SceneObjectState,
  ) => Promise<SceneRecord | null>;
  onCommitObjects?: (
    scene: SceneRecord,
    state: SceneObjectState,
    operationId: string,
    arrangement?: SceneArrangement,
  ) => Promise<SceneRecord | null>;
  onCommitFog?: (
    scene: SceneRecord,
    mutation: SceneFogMutation,
    operationId: string,
  ) => Promise<SceneRecord | null>;
  onRedo?: (scene: SceneRecord) => Promise<SceneRecord | null>;
  onUndo?: (scene: SceneRecord) => Promise<SceneRecord | null>;
  paintSettings?: PaintSettings;
  preparedImageUrls?: Record<string, string>;
  paintSubtool?: PaintSubtool;
  fogMode?: FogMode;
  fogSettings?: FogToolSettings;
  fogSubtool?: FogSubtool;
  shapeSettings?: ShapeSettings;
  shapeSubtool?: ShapeSubtool;
  textSettings?: TextSettings;
  scene: SceneRecord | null;
  sceneApi: SceneApi;
  session: PlaySession;
}

function getSessionLabel(session: PlaySession) {
  return session.source === 'local'
    ? session.campaignName
    : `${session.host}:${session.port}`;
}

async function loadDefaultRenderer(): Promise<SceneRendererHandle> {
  const { createSceneRenderer } = await import('./canvas/SceneRenderer');
  return createSceneRenderer();
}

function waitForCompositedFrame(): Promise<void> {
  return new Promise((resolve) => {
    // Animation-frame callbacks run before paint. Continue from a new task so
    // the prepared canvas is composited once while the play screen is still
    // hidden, then allow the loader to be removed.
    requestAnimationFrame(() => window.setTimeout(resolve, 0));
  });
}

export function MapStage({
  assetApi,
  availableScenes = EMPTY_SCENES,
  activeLayer = 'token',
  activeTool = 'select',
  createRenderer,
  editableTokenEntryIds,
  inspectableTokenEntryIds,
  networkApi,
  journalApi,
  journalWindowApi,
  networkUpdateRate = DEFAULT_TRANSFORM_PREVIEW_RATE,
  onPrepared,
  onPreparationProgress,
  scene,
  sceneApi,
  session,
  onActiveLayerChange,
  onCommitImages,
  onCommitObjects,
  onCommitFog,
  onRedo,
  onUndo,
  paintSettings,
  preparedImageUrls = EMPTY_IMAGE_URLS,
  paintSubtool = 'freeform',
  fogMode = 'reveal',
  fogSettings,
  fogSubtool = 'brush',
  shapeSettings,
  shapeSubtool = 'sphere',
  textSettings,
}: MapStageProps) {
  const elementRef = useRef<HTMLElement | null>(null);
  const sceneRef = useRef(scene);
  const displayedSceneIdRef = useRef(scene?.id ?? null);
  const availableScenesRef = useRef(availableScenes);
  const preparedCallbackRef = useRef(onPrepared);
  const progressCallbackRef = useRef(onPreparationProgress);
  const seenPingIds = useRef(new Set<string>());
  const [renderer, setRenderer] = useState<SceneRendererHandle | null>(null);
  const [tokenMessage, setTokenMessage] = useState<string | null>(null);
  const [inspectedTokenId, setInspectedTokenId] = useState<string | null>(null);
  const [healthEditor, setHealthEditor] = useState<
    (TokenHealthHit & { sceneId: string }) | null
  >(null);
  const closeHealthEditor = useCallback(() => {
    setHealthEditor(null);
    renderer?.setTokenHealthEditing(null);
  }, [renderer]);
  const [healthCommand, setHealthCommand] = useState('');
  const [openedEntry, setOpenedEntry] =
    useState<SystemJournalEntry | null>(null);
  const sessionUserId =
    session.role === 'player' ? session.userId : null;
  const preparableScenes = useMemo<readonly SceneRecord[]>(
    () =>
      scene && !availableScenes.some((candidate) => candidate.id === scene.id)
        ? [...availableScenes, scene]
        : availableScenes,
    [availableScenes, scene],
  );
  const imageResources = useSceneImageResources(
    assetApi,
    session.campaignId,
    preparableScenes,
  );
  const imageUrls = imageResources.urls;
  const resolvedImageUrls = useMemo(
    () => ({ ...preparedImageUrls, ...imageUrls }),
    [imageUrls, preparedImageUrls],
  );
  const resolvedImageUrlsRef = useRef(resolvedImageUrls);

  /**
   * Opening a sheet only needs view access; changing a Character's default
   * token size writes to the entry and needs edit. The caller names which,
   * so a view-only player is not refused the read-only sheet.
   */
  const loadTokenEntry = useCallback(async (
    entryId: string,
    capability: 'edit' | 'view',
  ) => {
    if (!journalApi) return null;
    const result = await journalApi.getEntry({
      campaignId: session.campaignId,
      entryId,
    });
    if (
      !result.ok ||
      result.value.kind !== 'system' ||
      !result.value.capabilities[capability]
    ) {
      return null;
    }
    const definition = getJournalEntryTypeDefinition(
      session.system,
      result.value.typeId,
    );
    return definition?.token && definition.validateData(result.value.data)
      ? { definition, entry: result.value }
      : null;
  }, [journalApi, session.campaignId, session.system]);

  const openLinkedToken = useCallback((token: SceneToken) => {
    void (async () => {
      if (journalWindowApi) {
        const focused = await journalWindowApi.focusCharacter({
          campaignId: session.campaignId,
          entryId: token.source.entryId,
        });
        if (focused.ok && focused.value) return;
      }
      const loaded = await loadTokenEntry(token.source.entryId, 'view');
      if (!loaded) {
        setTokenMessage(token.source.kind === 'template'
          ? 'The source Character no longer exists or cannot be opened. This Template token keeps its independent data.'
          : 'The linked Character Sheet could not be opened.');
        return;
      }
      setOpenedEntry(loaded.entry);
    })();
  }, [journalWindowApi, loadTokenEntry, session.campaignId]);

  const applyLinkedTokenDefaultSize = useCallback((token: SceneToken) => {
    void (async () => {
      const current = sceneRef.current;
      const loaded = await loadTokenEntry(token.source.entryId, 'edit');
      if (!current || !loaded || !onCommitObjects) {
        setTokenMessage('The Character Token size could not be changed.');
        return;
      }
      const defaultToken = loaded.definition.token!.readDefaultToken(
        loaded.entry.data,
      );
      const state = sceneObjectStateOf(current);
      const currentToken = Object.values(state.images)
        .flat()
        .find((image) => image.id === token.id);
      if (!currentToken || !('source' in currentToken)) {
        setTokenMessage('The Character Token no longer exists.');
        return;
      }
      currentToken.height = defaultToken.size.height * current.grid.size;
      currentToken.width = defaultToken.size.width * current.grid.size;
      currentToken.size = { ...defaultToken.size, kind: 'default' };
      const saved = await onCommitObjects(
        current,
        state,
        crypto.randomUUID(),
      );
      if (!saved) {
        setTokenMessage('The Character Token size could not be changed.');
      }
    })();
  }, [loadTokenEntry, onCommitObjects]);

  const saveLinkedTokenDefaultSize = useCallback((token: SceneToken) => {
    void (async () => {
      const current = sceneRef.current;
      const loaded = await loadTokenEntry(token.source.entryId, 'edit');
      if (!current || !loaded || !journalApi) {
        setTokenMessage('The default Character Token size could not be saved.');
        return;
      }
      const currentToken = Object.values(current.images)
        .flat()
        .find((image) => image.id === token.id);
      if (!currentToken || !('source' in currentToken)) {
        setTokenMessage('The Character Token no longer exists.');
        return;
      }
      const previous = loaded.definition.token!.readDefaultToken(
        loaded.entry.data,
      );
      const data = loaded.definition.token!.writeDefaultToken(
        loaded.entry.data,
        {
          ...previous,
          size: {
            height: currentToken.height / current.grid.size,
            width: currentToken.width / current.grid.size,
          },
        },
      );
      const result = await journalApi.updateEntryData({
        campaignId: session.campaignId,
        data,
        entryId: loaded.entry.id,
        expectedRevision: loaded.entry.revision,
      });
      if (!result.ok || result.value.kind !== 'system') {
        setTokenMessage('The default Character Token size could not be saved.');
        return;
      }
      setOpenedEntry((entry) => entry?.id === result.value.id
        ? result.value as SystemJournalEntry
        : entry);
      if (session.role === 'gm') {
        const scenes = current && !availableScenesRef.current.some(
          ({ id }) => id === current.id,
        )
          ? [...availableScenesRef.current, current]
          : availableScenesRef.current;
        const count = scenes.reduce(
          (total, candidate) => total + Object.values(candidate.images)
            .flat()
            .filter((image) =>
              'source' in image &&
              image.source.kind === 'linked' &&
              image.source.entryId === token.source.entryId,
            ).length,
          0,
        );
        setTokenMessage(
          `Saved the default size and updated ${count} linked ${count === 1 ? 'token' : 'tokens'}.`,
        );
      } else {
        setTokenMessage('Saved the default Character Token size.');
      }
    })();
  }, [journalApi, loadTokenEntry, session.campaignId, session.role]);

  useLayoutEffect(() => {
    sceneRef.current = scene;
    displayedSceneIdRef.current = scene?.id ?? null;
  }, [scene]);

  useEffect(() => {
    availableScenesRef.current = preparableScenes;
    resolvedImageUrlsRef.current = resolvedImageUrls;
    preparedCallbackRef.current = onPrepared;
    progressCallbackRef.current = onPreparationProgress;
  }, [
    preparableScenes,
    onPreparationProgress,
    onPrepared,
    resolvedImageUrls,
  ]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !imageResources.ready) {
      return undefined;
    }
    let disposed = false;
    const ready = (
      createRenderer
        ? Promise.resolve(createRenderer())
        : loadDefaultRenderer()
    ).then(async (instance) => {
      if (disposed) {
        instance.destroy();
        return null;
      }
      await instance.mount(element);
      if (disposed) {
        instance.destroy();
        return null;
      }
      try {
        await instance.prepareScenes(
          availableScenesRef.current,
          resolvedImageUrlsRef.current,
          sceneRef.current?.id ?? null,
          (progress) => progressCallbackRef.current?.(progress),
        );
      } catch {
        // Preparation is deliberately best effort; normal stage behavior is
        // still the fallback for anything that could not be warmed.
      }
      if (disposed) {
        instance.destroy();
        return null;
      }
      setRenderer(instance);
      instance.resize(element.clientWidth, element.clientHeight);
      await waitForCompositedFrame();
      if (disposed) {
        instance.destroy();
        return null;
      }
      preparedCallbackRef.current?.();
      return instance;
    });

    return () => {
      disposed = true;
      setRenderer(null);
      void ready.then((instance) => instance?.destroy());
    };
  }, [createRenderer, imageResources.ready]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !renderer) {
      return undefined;
    }
    renderer.resize(element.clientWidth, element.clientHeight);
    const observer = new ResizeObserver(() => {
      renderer.resize(element.clientWidth, element.clientHeight);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [renderer]);

  useEffect(() => {
    renderer?.setScene(scene, resolvedImageUrls);
  }, [renderer, resolvedImageUrls, scene]);

  useEffect(() => {
    let active = true;
    if (!renderer || !scene) {
      renderer?.setTokenHealth([]);
      return () => {
        active = false;
      };
    }
    void sceneApi.listTokenHealth({
      campaignId: session.campaignId,
      sceneId: scene.id,
    }).then((result) => {
      if (active && result.ok) renderer.setTokenHealth(result.value);
    });
    return () => {
      active = false;
    };
  }, [renderer, scene, sceneApi, session.campaignId]);

  const applyHealthCommand = useCallback(
    async (tokenId: string, command: string) => {
      const current = sceneRef.current;
      if (!current || !renderer) return;
      const result = await sceneApi.adjustTokenHealth({
        campaignId: session.campaignId,
        command,
        operationId: crypto.randomUUID(),
        sceneId: current.id,
        tokenId,
      });
      if (displayedSceneIdRef.current !== current.id) return;
      if (!result.ok) {
        setTokenMessage(
          'That health command was not accepted. Use Current+5, Current=12, ' +
          'or Maximum-2.5.',
        );
        return;
      }
      sceneRef.current = result.value;
      const health = await sceneApi.listTokenHealth({
        campaignId: session.campaignId,
        sceneId: current.id,
      });
      if (
        displayedSceneIdRef.current === current.id &&
        health.ok
      ) {
        renderer.setTokenHealth(health.value);
      }
    },
    [renderer, sceneApi, session.campaignId],
  );

  useEffect(() => {
    if (!renderer) return;
    void renderer
      .warmScenes(preparableScenes, resolvedImageUrls)
      .catch(() => undefined);
  }, [preparableScenes, renderer, resolvedImageUrls]);

  useEffect(() => {
    if (!renderer) {
      return undefined;
    }
    const matchesScene = (campaignId: string, sceneId: string) =>
      campaignId === session.campaignId && sceneId === scene?.id;
    const unsubscribe = [
      networkApi.onMapPing((ping) => {
        if (
          !matchesScene(ping.campaignId, ping.sceneId) ||
          !rememberPing(seenPingIds.current, ping.id)
        ) {
          return;
        }
        renderer.showPing(
          {
            id: ping.id,
            pullPlayers: ping.pullPlayers,
            sceneId: ping.sceneId,
            x: ping.x,
            y: ping.y,
          },
          ping.pullPlayers,
        );
      }),
      networkApi.onMeasurementUpdate((update) => {
        if (matchesScene(update.campaignId, update.sceneId)) {
          renderer.showMeasurement(update);
        }
      }),
      networkApi.onDrawingPreview((preview) => {
        if (matchesScene(preview.campaignId, preview.sceneId)) {
          renderer.showDrawingPreview(preview);
        }
      }),
      networkApi.onShapePreview((preview) => {
        if (matchesScene(preview.campaignId, preview.sceneId)) {
          renderer.showShapePreview(preview);
        }
      }),
      networkApi.onTransformStarted((input) => {
        if (matchesScene(input.campaignId, input.sceneId)) {
          renderer.showTransformStarted(input);
        }
      }),
      networkApi.onTransformPreview((input) => {
        if (input.campaignId === session.campaignId) {
          renderer.showTransformPreview(input);
        }
      }),
      networkApi.onTransformCancelled((input) => {
        if (matchesScene(input.campaignId, input.sceneId)) {
          renderer.showTransformCancelled(input);
        }
      }),
    ];
    return () => unsubscribe.forEach((remove) => remove());
  }, [networkApi, renderer, scene?.id, session.campaignId]);

  useEffect(() => {
    renderer?.setInteraction({
      activeLayer,
      actorId: sessionUserId,
      canEditImages: session.role === 'gm',
      editableTokenEntryIds,
      inspectableTokenEntryIds,
      editable: activeTool === 'select',
      fogEnabled: session.role === 'gm' && activeTool === 'fog',
      fogMode,
      fogSubtool,
      fogBrushHardness: fogSettings?.brushHardness,
      fogBrushWidth: fogSettings?.brushWidth,
      fogGmOpacity: fogSettings?.gmOpacity,
      measureEnabled: activeTool === 'measure',
      networkUpdateRate,
      paintEnabled: activeTool === 'paint',
      paintKind: paintSubtool,
      paintStyle: paintSettings
        ? drawingStyle(paintSettings, paintSubtool)
        : undefined,
      shapeEnabled: activeTool === 'shape',
      shapeKind: shapeSubtool,
      shapeStyle: shapeSettings,
      textEnabled: activeTool === 'text',
      textStyle: textSettings,
      pingEnabled: activeTool === 'select',
      onActiveLayerChange,
      onApplyLinkedTokenDefaultSize: applyLinkedTokenDefaultSize,
      onCommit: async (state, operationId, arrangement) => {
        const current = sceneRef.current;
        const saved = current
          ? onCommitObjects
            ? await onCommitObjects(current, state, operationId, arrangement)
            : onCommitImages
              ? await onCommitImages(current, state)
              : null
          : null;
        if (saved) {
          sceneRef.current = saved;
        }
        return saved;
      },
      onFogCommit: async (mutation, operationId) => {
        const current = sceneRef.current;
        const saved = current && onCommitFog
          ? await onCommitFog(current, mutation, operationId)
          : null;
        if (saved) {
          sceneRef.current = saved;
        }
        return saved;
      },
      onRedo: async () => {
        const current = sceneRef.current;
        const saved = current && onRedo ? await onRedo(current) : null;
        if (saved) {
          sceneRef.current = saved;
        }
        return saved;
      },
      onUndo: async () => {
        const current = sceneRef.current;
        const saved = current && onUndo ? await onUndo(current) : null;
        if (saved) {
          sceneRef.current = saved;
        }
        return saved;
      },
      onPing: (ping) => {
        if (!scene || !rememberPing(seenPingIds.current, ping.id)) {
          return;
        }
        renderer.showPing(
          ping,
          session.role === 'player' && ping.pullPlayers,
        );
        void networkApi.sendMapPing({
          ...ping,
          campaignId: session.campaignId,
        });
      },
      onMeasurementUpdate: (update) => {
        void networkApi.sendMeasurementUpdate({
          ...update,
          campaignId: session.campaignId,
        });
      },
      onDrawingPreview: (preview) => {
        void networkApi.sendDrawingPreview({
          ...preview,
          campaignId: session.campaignId,
        });
      },
      onOpenLinkedToken: openLinkedToken,
      onSelectionChange: (selectedIds) => {
        const current = sceneRef.current;
        const selectedId = selectedIds[selectedIds.length - 1];
        const token = current && selectedId
          ? Object.values(current.images).flat().find(
              (image): image is SceneToken =>
                image.id === selectedId && 'source' in image,
            )
          : null;
        setInspectedTokenId(token?.id ?? null);
      },
      onAdjustTokenHealth: (hit) => {
        const current = sceneRef.current;
        if (!current) return;
        setHealthCommand('Current');
        setHealthEditor({ ...hit, sceneId: current.id });
        renderer.setTokenHealthEditing(hit.tokenId);
      },
      onTokenHealthEditorRect: (rect) => {
        // The bar is the editor's frame, so losing the bar closes the editor.
        setHealthEditor((current) =>
          current && rect && rect.tokenId === current.tokenId
            ? { ...current, ...rect }
            : null,
        );
      },
      onShapePreview: (preview) => {
        void networkApi.sendShapePreview({
          ...preview,
          campaignId: session.campaignId,
        });
      },
      onPreviewStart: (input) => {
        void sceneApi.previewStart({
          ...input,
          campaignId: session.campaignId,
        });
      },
      onPreviewUpdate: (input) => {
        void sceneApi.previewUpdate({
          ...input,
          campaignId: session.campaignId,
        });
      },
      onPreviewCancel: (operationId, sceneId) => {
        void sceneApi.previewCancel({
          campaignId: session.campaignId,
          operationId,
          sceneId,
        });
      },
      onSaveLinkedTokenDefaultSize: saveLinkedTokenDefaultSize,
    });
  }, [
    activeLayer,
    activeTool,
    applyLinkedTokenDefaultSize,
    editableTokenEntryIds,
    inspectableTokenEntryIds,
    fogMode,
    fogSettings,
    fogSubtool,
    onActiveLayerChange,
    onCommitImages,
    onCommitObjects,
    onCommitFog,
    onRedo,
    onUndo,
    networkApi,
    networkUpdateRate,
    openLinkedToken,
    paintSettings,
    paintSubtool,
    renderer,
    saveLinkedTokenDefaultSize,
    scene,
    sceneApi,
    shapeSettings,
    shapeSubtool,
    session.campaignId,
    session.role,
    sessionUserId,
    textSettings,
  ]);

  return (
    <>
      <section
        ref={elementRef}
        className={styles.stage}
        aria-label={`Map play area for ${getSessionLabel(session)}`}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(JOURNAL_ENTRY_DRAG_TYPE)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            return;
          }
          if (
            session.role === 'gm' &&
            event.dataTransfer.types.includes(CANVAS_IMAGE_DRAG_TYPE)
          ) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(event) => {
          const journalPayload = event.dataTransfer.getData(
            JOURNAL_ENTRY_DRAG_TYPE,
          );
          if (journalPayload) {
            event.preventDefault();
            if (!scene || !journalApi || !onCommitObjects) {
              setTokenMessage('The Character Token could not be placed here.');
              return;
            }
            const clientX = event.clientX;
            const clientY = event.clientY;
            const placeOnGmLayer = session.role === 'gm' &&
              (event.altKey || event.getModifierState('Alt'));
            void (async () => {
              try {
                const payload = JSON.parse(journalPayload) as {
                  entryId?: unknown;
                  typeId?: unknown;
                };
                if (
                  typeof payload.entryId !== 'string' ||
                  typeof payload.typeId !== 'string'
                ) throw new Error('Invalid Journal drag data.');
                const result = await journalApi.getEntry({
                  campaignId: session.campaignId,
                  entryId: payload.entryId,
                });
                if (
                  !result.ok ||
                  result.value.kind !== 'system' ||
                  !result.value.capabilities.edit
                ) throw new Error('The Character cannot be edited.');
                const definition = getJournalEntryTypeDefinition(
                  session.system,
                  result.value.typeId,
                );
                if (
                  !definition?.token ||
                  !definition.validateData(result.value.data)
                ) throw new Error('This Journal entry does not define tokens.');
                const defaultToken = definition.token.readDefaultToken(
                  result.value.data,
                );
                const state = sceneObjectStateOf(scene);
                if (
                  Object.values(state.images).flat().length >= MAX_SCENE_IMAGES
                ) throw new Error('The scene image limit has been reached.');
                const point = renderer?.clientToScene(clientX, clientY) ?? {
                  x: scene.width / 2,
                  y: scene.height / 2,
                };
                let token = {
                  assetId:
                    defaultToken.imageAssetId ?? DEFAULT_TOKEN_ASSET_ID,
                  height: defaultToken.size.height * scene.grid.size,
                  id: crypto.randomUUID(),
                  rotation: 0,
                  size: { ...defaultToken.size, kind: 'default' as const },
                  source: {
                    entryId: result.value.id,
                    kind: 'linked' as const,
                  },
                  width: defaultToken.size.width * scene.grid.size,
                  x: point.x,
                  y: point.y,
                };
                if (scene.grid.type === 'square') {
                  token = snapMove(token, scene.grid);
                }
                const layer = placeOnGmLayer ? 'gm' : 'token';
                state.images[layer].push(token);
                state.objectOrder[layer].push(token.id);
                const saved = await onCommitObjects(
                  scene,
                  state,
                  crypto.randomUUID(),
                );
                if (!saved) {
                  throw new Error('The token placement was rejected.');
                }
                renderer?.selectImages([token.id]);
              } catch {
                setTokenMessage('The Character Token could not be placed.');
              }
            })();
            return;
          }
          if (
            session.role !== 'gm' ||
            !scene ||
            !assetApi ||
            !onCommitImages
          ) {
            return;
          }
          const assetId = event.dataTransfer.getData(CANVAS_IMAGE_DRAG_TYPE);
          if (!assetId) {
            return;
          }
          event.preventDefault();
          const clientX = event.clientX;
          const clientY = event.clientY;
          void (async () => {
            let temporaryToken: string | null = null;
            try {
              let url = imageUrls[assetId];
              if (!url) {
                const preview = await assetApi.getPreview({
                  assetId,
                  campaignId: session.campaignId,
                });
                if (!preview.ok) {
                  return;
                }
                temporaryToken = preview.value.token;
                url = preview.value.url;
              }
              const response = await fetch(url);
              if (!response.ok) {
                return;
              }
              const blob = await response.blob();
              const bitmap = await createImageBitmap(blob);
              const scale = Math.min(
                1,
                scene.width / Math.max(1, bitmap.width),
                scene.height / Math.max(1, bitmap.height),
              );
              const point = renderer?.clientToScene(clientX, clientY) ?? {
                x: scene.width / 2,
                y: scene.height / 2,
              };
              const state = sceneObjectStateOf(scene);
              if (
                Object.values(state.images).flat().length >= MAX_SCENE_IMAGES
              ) {
                bitmap.close();
                return;
              }
              let image = {
                assetId,
                height: bitmap.height * scale,
                id: crypto.randomUUID(),
                rotation: 0,
                width: bitmap.width * scale,
                x: point.x,
                y: point.y,
              };
              if (scene.grid.type === 'square') {
                image = snapMove(image, scene.grid);
              }
              state.images[activeLayer].push(image);
              state.objectOrder[activeLayer].push(image.id);
              bitmap.close();
              const saved = await onCommitImages(scene, state);
              if (saved) {
                renderer?.selectImages([image.id]);
              }
            } catch {
              // The asset can become unavailable while a drag is in flight.
            } finally {
              if (temporaryToken) {
                void assetApi.releasePreview({ token: temporaryToken });
              }
            }
          })();
        }}
      >
        <p className="sr-only">
          {scene
            ? `Viewing the scene ${scene.name}.`
            : 'No scene is being displayed.'}
        </p>
        {healthEditor && healthEditor.sceneId === scene?.id ? (
          <div
            className={styles.healthEditor}
            style={{
              /*
               * The bar draws its own dark fill and white outline in the scene, so
               * the field is transparent chrome laid over exactly that rect and
               * sized from it. Nothing here may exceed the bar.
               */
              fontSize: healthEditor.height * HEALTH_EDITOR_FONT_RATIO,
              height: healthEditor.height,
              left: healthEditor.x,
              top: healthEditor.y,
              width: healthEditor.width,
            }}
          >
            <InlineInput
              align="left"
              aria-label="Adjust token health"
              autoFocus
              height="fill"
              onBlur={closeHealthEditor}
              onChange={(event) => setHealthCommand(event.target.value)}
              onFocus={(event) => {
                const { value } = event.currentTarget;
                event.currentTarget.setSelectionRange(value.length, value.length);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeHealthEditor();
                  return;
                }
                if (event.key !== 'Enter') return;
                event.preventDefault();
                const command = healthCommand.trim();
                const { tokenId } = healthEditor;
                closeHealthEditor();
                if (command) void applyHealthCommand(tokenId, command);
              }}
              surface="borderless"
              value={healthCommand}
            />
          </div>
        ) : null}
        {scene && inspectedTokenId ? (
          <TokenInspector
            campaignId={session.campaignId}
            key={`${scene.id}:${inspectedTokenId}`}
            networkApi={networkApi}
            sceneApi={sceneApi}
            sceneId={scene.id}
            sceneRevision={scene.revision}
            tokenId={inspectedTokenId}
          />
        ) : null}
      </section>
      {openedEntry && journalApi ? (
        <SystemJournalEntryModal
          assetApi={assetApi}
          campaignId={session.campaignId}
          entry={openedEntry}
          journalApi={journalApi}
          networkApi={networkApi}
          onDismiss={() => setOpenedEntry(null)}
          onUpdated={(entry) => setOpenedEntry(entry)}
          system={session.system}
        />
      ) : null}
      <ErrorModal
        isOpen={tokenMessage !== null}
        message={tokenMessage ?? ''}
        onDismiss={() => setTokenMessage(null)}
        title="Character Token"
      />
    </>
  );
}
