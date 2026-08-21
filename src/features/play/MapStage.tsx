import { useEffect, useMemo, useRef, useState } from 'react';
import { CANVAS_IMAGE_DRAG_TYPE, type AssetApi } from '../../shared/assets';
import {
  DEFAULT_TRANSFORM_PREVIEW_RATE,
  type NetworkApi,
} from '../../shared/network';
import {
  sceneObjectStateOf,
  MAX_SCENE_IMAGES,
  type SceneApi,
  type SceneImageLayer,
  type SceneObjectState,
  type SceneArrangement,
  type SceneFogMutation,
  type SceneRecord,
} from '../../shared/scenes';
import type {
  ScenePreparationProgress,
  SceneRendererHandle,
} from './canvas/SceneRenderer';
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
import { useSceneImageUrls } from './useSceneImageUrls';
import styles from './PlayScreen.module.css';

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
  networkApi: NetworkApi;
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

export function MapStage({
  assetApi,
  availableScenes = [],
  activeLayer = 'token',
  activeTool = 'select',
  createRenderer,
  networkApi,
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
  preparedImageUrls = {},
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
  const availableScenesRef = useRef(availableScenes);
  const preparedCallbackRef = useRef(onPrepared);
  const progressCallbackRef = useRef(onPreparationProgress);
  const seenPingIds = useRef(new Set<string>());
  const [renderer, setRenderer] = useState<SceneRendererHandle | null>(null);
  const sessionUserId =
    session.role === 'player' ? session.userId : null;
  const preparableScenes = useMemo<readonly SceneRecord[]>(
    () =>
      scene && !availableScenes.some((candidate) => candidate.id === scene.id)
        ? [...availableScenes, scene]
        : availableScenes,
    [availableScenes, scene],
  );
  const imageUrls = useSceneImageUrls(
    assetApi,
    session.campaignId,
    preparableScenes,
  );
  const resolvedImageUrls = useMemo(
    () => ({ ...preparedImageUrls, ...imageUrls }),
    [imageUrls, preparedImageUrls],
  );
  const resolvedImageUrlsRef = useRef(resolvedImageUrls);

  useEffect(() => {
    sceneRef.current = scene;
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
    if (!element) {
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
      preparedCallbackRef.current?.();
      return instance;
    });

    return () => {
      disposed = true;
      setRenderer(null);
      void ready.then((instance) => instance?.destroy());
    };
  }, [createRenderer]);

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
    });
  }, [
    activeLayer,
    activeTool,
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
    paintSettings,
    paintSubtool,
    renderer,
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
    <section
      ref={elementRef}
      className={styles.stage}
      aria-label={`Map play area for ${getSessionLabel(session)}`}
      onDragOver={(event) => {
        if (
          session.role === 'gm' &&
          event.dataTransfer.types.includes(CANVAS_IMAGE_DRAG_TYPE)
        ) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(event) => {
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
    </section>
  );
}
