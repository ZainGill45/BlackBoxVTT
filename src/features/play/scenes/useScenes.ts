import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createEmptySceneManifest,
  findScene,
  type SceneError,
  type SceneManifest,
  type ScenePatch,
  type SceneImageState,
  type SceneApi,
  type SceneRecord,
} from '../../../shared/scenes';

export interface SceneStore {
  activeScene: SceneRecord | null;
  activeSceneId: string | null;
  clearError: () => void;
  createScene: () => Promise<SceneRecord | null>;
  detachAsset: (assetId: string) => Promise<void>;
  error: SceneError | null;
  findDependents: (assetId: string) => Promise<SceneRecord[]>;
  present: (sceneId: string | null) => Promise<void>;
  scenes: SceneRecord[];
  trashScene: (scene: SceneRecord) => Promise<void>;
  updateScene: (
    scene: SceneRecord,
    patch: ScenePatch,
  ) => Promise<SceneRecord | null>;
  setImages: (
    scene: SceneRecord,
    state: SceneImageState,
  ) => Promise<SceneRecord | null>;
  setObjects: (
    scene: SceneRecord,
    state: SceneImageState,
    operationId: string,
  ) => Promise<SceneRecord | null>;
  undo: (scene: SceneRecord) => Promise<SceneRecord | null>;
  redo: (scene: SceneRecord) => Promise<SceneRecord | null>;
  viewScene: (sceneId: string | null) => void;
  viewedScene: SceneRecord | null;
  viewedSceneId: string | null;
}

/**
 * Owns the campaign's scene manifest for the play screen. The presented scene
 * and the scene the game master is looking at are tracked separately; a player
 * only ever looks at the presented one.
 */
export function useScenes(
  sceneApi: SceneApi | undefined,
  campaignId: string,
  canPresent: boolean,
): SceneStore {
  const [manifest, setManifest] = useState<SceneManifest>(
    createEmptySceneManifest,
  );
  const [error, setError] = useState<SceneError | null>(null);
  const [requestedSceneId, setRequestedSceneId] = useState<string | null>(null);

  useEffect(() => {
    if (!sceneApi) {
      return undefined;
    }
    let current = true;
    let receivedChange = false;
    const removeChanged = sceneApi.onChanged((event) => {
      if (event.campaignId === campaignId) {
        receivedChange = true;
        setManifest(event.manifest);
      }
    });
    void sceneApi.list({ campaignId }).then((result) => {
      if (!current) {
        return;
      }
      if (result.ok) {
        if (!receivedChange) {
          setManifest(result.value);
        }
      } else {
        setError(result.error);
      }
    });
    return () => {
      current = false;
      removeChanged();
    };
  }, [campaignId, sceneApi]);

  // A player follows the presented scene; a game master falls back to it until
  // they pick another, and again if the one they picked is deleted.
  const viewedSceneId = useMemo(() => {
    if (!canPresent) {
      return manifest.activeSceneId;
    }
    if (requestedSceneId && findScene(manifest, requestedSceneId)) {
      return requestedSceneId;
    }
    return manifest.activeSceneId;
  }, [canPresent, manifest, requestedSceneId]);

  const run = useCallback(
    async <T>(
      operation: () => Promise<
        { error: SceneError; ok: false } | { ok: true; value: T }
      >,
    ): Promise<T | null> => {
      const result = await operation();
      if (result.ok) {
        return result.value;
      }
      setError(result.error);
      return null;
    },
    [],
  );

  const createScene = useCallback(async () => {
    if (!sceneApi) {
      return null;
    }
    const scene = await run(() => sceneApi.create({ campaignId }));
    if (scene) {
      setRequestedSceneId(scene.id);
    }
    return scene;
  }, [campaignId, run, sceneApi]);

  const updateScene = useCallback(
    async (scene: SceneRecord, patch: ScenePatch) => {
      if (!sceneApi) {
        return null;
      }
      return run(() =>
        sceneApi.update({
          campaignId,
          expectedRevision: scene.revision,
          patch,
          sceneId: scene.id,
        }),
      );
    },
    [campaignId, run, sceneApi],
  );

  const setImages = useCallback(
    async (scene: SceneRecord, state: SceneImageState) => {
      const setImagesApi = sceneApi?.setImages;
      if (!setImagesApi) {
        return null;
      }
      return run(() =>
        setImagesApi({
          campaignId,
          expectedRevision: scene.revision,
          sceneId: scene.id,
          state,
        }),
      );
    },
    [campaignId, run, sceneApi],
  );

  const setObjects = useCallback(
    async (
      scene: SceneRecord,
      state: SceneImageState,
      operationId: string,
    ) => {
      const setObjectsApi = sceneApi?.setObjects;
      if (!setObjectsApi) {
        return null;
      }
      return run(() =>
        setObjectsApi({
          campaignId,
          expectedRevision: scene.revision,
          operationId,
          sceneId: scene.id,
          state,
        }),
      );
    },
    [campaignId, run, sceneApi],
  );

  const undo = useCallback(
    async (scene: SceneRecord) => {
      const undoApi = sceneApi?.undo;
      return undoApi
        ? run(() => undoApi({ campaignId, sceneId: scene.id }))
        : null;
    },
    [campaignId, run, sceneApi],
  );

  const redo = useCallback(
    async (scene: SceneRecord) => {
      const redoApi = sceneApi?.redo;
      return redoApi
        ? run(() => redoApi({ campaignId, sceneId: scene.id }))
        : null;
    },
    [campaignId, run, sceneApi],
  );

  const trashScene = useCallback(
    async (scene: SceneRecord) => {
      if (!sceneApi) {
        return;
      }
      await run(() =>
        sceneApi.trash({
          campaignId,
          expectedRevision: scene.revision,
          sceneId: scene.id,
        }),
      );
    },
    [campaignId, run, sceneApi],
  );

  const present = useCallback(
    async (sceneId: string | null) => {
      if (!sceneApi) {
        return;
      }
      // Presenting also moves the game master's own view to that scene.
      setRequestedSceneId(sceneId);
      await run(() => sceneApi.present({ campaignId, sceneId }));
    },
    [campaignId, run, sceneApi],
  );

  const detachAsset = useCallback(
    async (assetId: string) => {
      if (!sceneApi) {
        return;
      }
      await run(() => sceneApi.detachAsset({ assetId, campaignId }));
    },
    [campaignId, run, sceneApi],
  );

  const findDependents = useCallback(
    async (assetId: string) => {
      if (!sceneApi) {
        return [];
      }
      const result = await sceneApi.findDependents({ assetId, campaignId });
      return result.ok ? result.value : [];
    },
    [campaignId, sceneApi],
  );

  return {
    activeScene: findScene(manifest, manifest.activeSceneId),
    activeSceneId: manifest.activeSceneId,
    clearError: useCallback(() => setError(null), []),
    createScene,
    detachAsset,
    error,
    findDependents,
    present,
    scenes: manifest.scenes,
    redo,
    setImages,
    setObjects,
    trashScene,
    updateScene,
    undo,
    viewScene: setRequestedSceneId,
    viewedScene: findScene(manifest, viewedSceneId),
    viewedSceneId,
  };
}
