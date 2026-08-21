import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetApi } from '../../shared/assets';
import type { SceneImage, SceneRecord } from '../../shared/scenes';

const SCENE_PREVIEW_INACTIVITY_MS = 30_000;

export interface SceneImageResources {
  /** True once every initially required preview URL has succeeded or failed. */
  ready: boolean;
  urls: Record<string, string>;
}

function acquireScenePreview(
  assetApi: AssetApi,
  input: Parameters<AssetApi['getPreview']>[0],
): Promise<Awaited<ReturnType<AssetApi['getPreview']>> | null> {
  return new Promise((resolve) => {
    let active = true;
    const finish = (
      result: Awaited<ReturnType<AssetApi['getPreview']>> | null,
    ) => {
      if (!active) return;
      active = false;
      window.clearTimeout(timer);
      resolve(result);
    };
    const timer = window.setTimeout(
      () => finish(null),
      SCENE_PREVIEW_INACTIVITY_MS,
    );
    let request: ReturnType<AssetApi['getPreview']>;
    try {
      request = assetApi.getPreview(input);
    } catch {
      finish(null);
      return;
    }
    void request.then(
      (result) => {
        if (!active) {
          if (result.ok) {
            void assetApi.releasePreview({ token: result.value.token });
          }
          return;
        }
        finish(result);
      },
      () => finish(null),
    );
  });
}

export function useSceneImageUrls(
  assetApi: AssetApi | undefined,
  campaignId: string,
  sceneOrScenes: SceneRecord | readonly SceneRecord[] | null,
): Record<string, string> {
  return useSceneImageResources(assetApi, campaignId, sceneOrScenes).urls;
}

export function useSceneImageResources(
  assetApi: AssetApi | undefined,
  campaignId: string,
  sceneOrScenes: SceneRecord | readonly SceneRecord[] | null,
): SceneImageResources {
  const ids = useMemo(
    () => {
      const scenes: readonly SceneRecord[] = Array.isArray(sceneOrScenes)
        ? sceneOrScenes
        : sceneOrScenes
          ? [sceneOrScenes]
          : [];
      return scenes
        .flatMap((scene) => [
          scene.mapImage?.assetId,
          ...(Object.values(scene.images) as SceneImage[][]).flatMap((layer) =>
            layer.map((image) => image.assetId),
          ),
        ])
        .filter((id): id is string => !!id);
    },
    [sceneOrScenes],
  );
  const desiredIds = useMemo(() => [...new Set(ids)].sort(), [ids]);
  const key = desiredIds.join(' ');
  const [assetRevision, setAssetRevision] = useState(0);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [initialAttemptComplete, setInitialAttemptComplete] = useState(
    desiredIds.length === 0,
  );
  const previews = useRef(
    new Map<
      string,
      { revision: number; token: string; url: string }
    >(),
  );

  useEffect(() => {
    if (!assetApi) {
      return undefined;
    }
    return assetApi.onChanged((event) => {
      if (event.campaignId === campaignId) {
        setAssetRevision((revision) => revision + 1);
      }
    });
  }, [assetApi, campaignId]);

  useEffect(() => {
    const storedPreviews = previews.current;
    return () => {
      if (!assetApi) {
        return;
      }
      for (const preview of storedPreviews.values()) {
        void assetApi.releasePreview({ token: preview.token });
      }
      storedPreviews.clear();
    };
  }, [assetApi, campaignId]);

  useEffect(() => {
    if (!assetApi) {
      return undefined;
    }

    let current = true;
    const desired = new Set(desiredIds);

    for (const [assetId, preview] of previews.current) {
      if (!desired.has(assetId)) {
        previews.current.delete(assetId);
        void assetApi.releasePreview({ token: preview.token });
      }
    }
    void (async () => {
      await Promise.resolve();
      if (!current) {
        return;
      }
      setUrls(
        Object.fromEntries(
          [...previews.current]
            .filter(([assetId]) => desired.has(assetId))
            .map(([assetId, preview]) => [assetId, preview.url]),
        ),
      );
      const queue = [...desiredIds];
      const worker = async () => {
        for (let assetId = queue.shift(); assetId; assetId = queue.shift()) {
          const existing = previews.current.get(assetId);
          if (existing?.revision === assetRevision) {
            continue;
          }
          const result = await acquireScenePreview(assetApi, {
            assetId,
            campaignId,
          });
          if (!result) {
            continue;
          }
          if (!result.ok) {
            continue;
          }
          if (!current || !desired.has(assetId)) {
            void assetApi.releasePreview({ token: result.value.token });
            continue;
          }
          const previous = previews.current.get(assetId);
          previews.current.set(assetId, {
            revision: assetRevision,
            token: result.value.token,
            url: result.value.url,
          });
          setUrls((loaded) => ({
            ...loaded,
            [assetId]: result.value.url,
          }));
          if (previous && previous.token !== result.value.token) {
            void assetApi.releasePreview({ token: previous.token });
          }
        }
      };
      await Promise.all([worker(), worker()]);
      if (current) {
        setInitialAttemptComplete(true);
      }
    })();

    return () => {
      current = false;
    };
  }, [assetApi, assetRevision, campaignId, desiredIds, key]);

  return {
    ready: !assetApi || initialAttemptComplete,
    urls: assetApi ? urls : {},
  };
}
