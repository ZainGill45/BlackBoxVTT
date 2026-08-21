import { useEffect, useMemo, useRef } from 'react';
import type { AssetApi, AssetPreview, AssetView } from '../../shared/assets';

/**
 * Adopts campaign-prepared grants and makes every play consumer share them.
 * Consumers may release a managed token normally; the wrapper holds it until
 * the campaign unmounts, then releases every grant exactly once.
 */
export function usePreparedAssetApi(
  assetApi: AssetApi,
  campaignId: string,
  seed?: ReadonlyMap<string, AssetPreview>,
  seedAssets?: readonly AssetView[],
): AssetApi {
  const managed = useRef(new Map(seed));
  const contentHashes = useRef(
    new Map(seedAssets?.map((asset) => [asset.id, asset.sha256])),
  );

  useEffect(() => {
    const cache = managed.current;
    return assetApi.onChanged((event) => {
      if (event.campaignId !== campaignId) return;
      const currentHashes = new Map(
        event.assets
          .filter((asset) => asset.capabilities.preview)
          .map((asset) => [asset.id, asset.sha256]),
      );
      for (const [assetId, preview] of cache) {
        if (contentHashes.current.get(assetId) !== currentHashes.get(assetId)) {
          cache.delete(assetId);
          void assetApi.releasePreview({ token: preview.token });
        }
      }
      contentHashes.current = currentHashes;
      // Rewarm changed/new payloads without interrupting current interaction.
      try {
        void Promise.resolve(assetApi.preparePreviews({ campaignId })).then(
          (result) => {
            if (!result?.ok) return;
            for (const preview of result.value.previews) {
              const previous = cache.get(preview.assetId);
              cache.set(preview.assetId, preview);
              if (previous && previous.token !== preview.token) {
                void assetApi.releasePreview({ token: previous.token });
              }
            }
          },
          () => undefined,
        );
      } catch {
        // Background warming is best effort, including imperfect test doubles.
      }
    });
  }, [assetApi, campaignId]);

  useEffect(() => {
    const cache = managed.current;
    return () => {
      for (const preview of cache.values()) {
        void assetApi.releasePreview({ token: preview.token });
      }
      cache.clear();
    };
  }, [assetApi]);

  return useMemo(
    () => ({
      ...assetApi,
      getPreview: async (input) => {
        const cached = managed.current.get(input.assetId);
        return cached
          ? { ok: true as const, value: cached }
          : assetApi.getPreview(input);
      },
      releasePreview: async ({ token }) => {
        if (
          [...managed.current.values()].some(
            (preview) => preview.token === token,
          )
        ) {
          return;
        }
        await assetApi.releasePreview({ token });
      },
    }),
    [assetApi],
  );
}
