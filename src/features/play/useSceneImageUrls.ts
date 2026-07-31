import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetApi } from '../../shared/assets';
import type { SceneImage, SceneRecord } from '../../shared/scenes';

export function useSceneImageUrls(
  assetApi: AssetApi | undefined,
  campaignId: string,
  scene: SceneRecord | null,
): Record<string, string> {
  const ids = useMemo(
    () =>
      [
        scene?.mapImage?.assetId,
        ...(scene
          ? (Object.values(
              scene.images,
            ) as SceneImage[][]).flatMap((layer) =>
              layer.map((image) => image.assetId),
            )
          : []),
      ].filter((id): id is string => !!id),
    [scene],
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
      await Promise.all(
        desiredIds.map(async (assetId) => {
          const existing = previews.current.get(assetId);
          if (existing?.revision === assetRevision) {
            return;
          }
          const result = await assetApi.getPreview({ assetId, campaignId });
          if (!result.ok) {
            return;
          }
          if (!current || !desired.has(assetId)) {
            void assetApi.releasePreview({ token: result.value.token });
            return;
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
        }),
      );
    })();

    return () => {
      current = false;
    };
  }, [assetApi, assetRevision, campaignId, desiredIds, key]);

  return assetApi ? urls : {};
}
