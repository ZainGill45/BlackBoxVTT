import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetApi } from '../../../shared/assets';
import { createThumbnail } from './thumbnails';

/** How many images are decoded at once, so a large campaign never spikes. */
const CONCURRENCY = 2;

const EMPTY: ReadonlyMap<string, AssetThumbnail> = new Map();

export interface AssetThumbnail {
  /**
   * The source image's real dimensions. Callers size scenes from these, so they
   * must describe the map, never the thumbnail. Zero when unknown.
   */
  sourceHeight: number;
  sourceWidth: number;
  url: string;
}

export type AssetThumbnailEntry = AssetThumbnail & (
  | {
      /** A generated object URL whose source preview grant was released. */
      isFallback: false;
      token: null;
    }
  | {
      /** The untouched asset URL, which only works while this grant is held. */
      isFallback: true;
      token: string;
    }
);

/** Releases whichever renderer resource backs an entry. */
export function releaseAssetThumbnail(
  assetApi: AssetApi | undefined,
  entry: AssetThumbnailEntry,
): void {
  if (entry.isFallback) {
    if (!assetApi) return;
    try {
      void Promise.resolve(
        assetApi.releasePreview({ token: entry.token }),
      ).catch(() => undefined);
    } catch {
      // Cleanup is best effort when the bridge itself has already gone away.
    }
  } else {
    URL.revokeObjectURL(entry.url);
  }
}

/**
 * Builds one thumbnail, and hands its renderer resource to the caller to own.
 *
 * Exported so a campaign can be warmed before its play screen exists; whoever
 * builds an entry is responsible for handing it to `useAssetThumbnails`, which
 * releases the resource once nothing references the asset any more.
 */
export async function buildAssetThumbnail(
  assetApi: AssetApi,
  campaignId: string,
  assetId: string,
): Promise<AssetThumbnailEntry | null> {
  let preview: Awaited<ReturnType<AssetApi['getPreview']>>;
  try {
    preview = await assetApi.getPreview({ assetId, campaignId });
  } catch {
    return null;
  }
  if (!preview.ok) {
    return null;
  }
  const { token, url } = preview.value;

  // If anything below fails, the asset URL still renders — at the cost of
  // decoding the full image — rather than the row showing nothing at all.
  let entry: AssetThumbnailEntry = {
    isFallback: true,
    sourceHeight: 0,
    sourceWidth: 0,
    token,
    url,
  };
  try {
    const response = await fetch(url);
    if (response.ok) {
      const thumbnail = await createThumbnail(await response.blob());
      if (thumbnail) {
        entry = {
          isFallback: false,
          sourceHeight: thumbnail.sourceHeight,
          sourceWidth: thumbnail.sourceWidth,
          token: null,
          url: URL.createObjectURL(thumbnail.blob),
        };
      }
    }
  } catch {
    // Keep the fallback.
  }

  // Once a thumbnail exists the grant has served its purpose, so nothing holds a
  // preview grant open for the whole session. A fallback still points at the
  // asset URL, so that one has to keep its grant.
  if (!entry.isFallback) {
    void assetApi.releasePreview({ token });
  }
  return entry;
}

/**
 * Small, long-lived thumbnails for a set of assets, keyed by asset id.
 *
 * Built once when the ids first appear — which for the scene list means at
 * campaign open, since `PlayScreen` mounts then and stays mounted. The asset
 * protocol sends `Cache-Control: no-store` and `ScenePanel` unmounts on every
 * sidebar tab switch, so without this each visit re-downloaded and re-decoded
 * every map at full resolution just to paint a row thumbnail.
 */
export function useAssetThumbnails(
  assetApi: AssetApi | undefined,
  campaignId: string,
  assetIds: readonly string[],
  /**
   * Thumbnails built before this hook existed, whose object URLs it adopts:
   * their object URLs or fallback grants are released here like any it built
   * itself, and must not be released by whoever passed them in.
   */
  seed?: ReadonlyMap<string, AssetThumbnailEntry>,
): ReadonlyMap<string, AssetThumbnail> {
  // Renderer resources must be released, and only the ones we minted or adopted.
  const owned = useRef(new Map<string, AssetThumbnailEntry>(seed));
  const owningAssetApi = useRef(assetApi);
  const [thumbnails, setThumbnails] = useState<
    ReadonlyMap<string, AssetThumbnail>
  >(() => (seed && seed.size > 0 ? new Map(seed) : EMPTY));

  // A string key so a rename or a present, which produce a new manifest object
  // holding the same images, does not rebuild anything.
  const key = useMemo(
    () => [...new Set(assetIds)].sort().join(' '),
    [assetIds],
  );

  useEffect(() => {
    const wanted = key ? key.split(' ') : [];
    if (!assetApi) {
      return undefined;
    }

    let active = true;
    const cache = owned.current;

    // Drop anything no longer referenced before generating what is missing.
    let changed = false;
    for (const [assetId, entry] of [...cache]) {
      if (!wanted.includes(assetId)) {
        releaseAssetThumbnail(assetApi, entry);
        cache.delete(assetId);
        changed = true;
      }
    }
    if (changed) {
      setThumbnails(new Map(cache));
    }

    const pending = wanted.filter((assetId) => !cache.has(assetId));
    if (pending.length === 0) {
      return undefined;
    }

    const queue = [...pending];
    const worker = async () => {
      for (let assetId = queue.shift(); assetId; assetId = queue.shift()) {
        const entry = await buildAssetThumbnail(assetApi, campaignId, assetId);
        if (!active) {
          if (entry) releaseAssetThumbnail(assetApi, entry);
          return;
        }
        if (entry) {
          cache.set(assetId, entry);
          setThumbnails(new Map(cache));
        }
      }
    };
    void Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker),
    );

    return () => {
      active = false;
    };
  }, [assetApi, campaignId, key]);

  useEffect(() => {
    const cache = owned.current;
    const owner = owningAssetApi.current;
    return () => {
      for (const entry of cache.values()) {
        releaseAssetThumbnail(owner, entry);
      }
      cache.clear();
    };
  }, []);

  return thumbnails;
}
