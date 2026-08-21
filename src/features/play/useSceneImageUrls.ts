import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetApi } from '../../shared/assets';
import type { SceneImage, SceneRecord } from '../../shared/scenes';

export function useSceneImageUrls(
  assetApi: AssetApi | undefined,
  campaignId: string,
  sceneOrScenes: SceneRecord | readonly SceneRecord[] | null,
): Record<string, string> {
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
          const result = await assetApi.getPreview({ assetId, campaignId });
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
    })();

    return () => {
      current = false;
    };
  }, [assetApi, assetRevision, campaignId, desiredIds, key]);

  return assetApi ? urls : {};
}
