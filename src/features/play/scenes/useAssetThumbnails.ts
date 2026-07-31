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

interface Entry extends AssetThumbnail {
  /** True when this is the untouched asset URL rather than a thumbnail. */
  isFallback: boolean;
}

async function buildThumbnail(
  assetApi: AssetApi,
  campaignId: string,
  assetId: string,
): Promise<Entry | null> {
  const preview = await assetApi.getPreview({ assetId, campaignId });
  if (!preview.ok) {
    return null;
  }
  const { token, url } = preview.value;

  // If anything below fails, the asset URL still renders — at the cost of
  // decoding the full image — rather than the row showing nothing at all.
  let entry: Entry = { isFallback: true, sourceHeight: 0, sourceWidth: 0, url };
  try {
    const response = await fetch(url);
    if (response.ok) {
      const thumbnail = await createThumbnail(await response.blob());
      if (thumbnail) {
        entry = {
          isFallback: false,
          sourceHeight: thumbnail.sourceHeight,
          sourceWidth: thumbnail.sourceWidth,
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
): ReadonlyMap<string, AssetThumbnail> {
  const [thumbnails, setThumbnails] = useState<
    ReadonlyMap<string, AssetThumbnail>
  >(EMPTY);
  // Object URLs must be revoked, and only the ones we minted.
  const owned = useRef(new Map<string, Entry>());

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
        if (!entry.isFallback) {
          URL.revokeObjectURL(entry.url);
        }
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
        const entry = await buildThumbnail(assetApi, campaignId, assetId);
        if (!active) {
          if (entry && !entry.isFallback) {
            URL.revokeObjectURL(entry.url);
          }
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
    return () => {
      for (const entry of cache.values()) {
        if (!entry.isFallback) {
          URL.revokeObjectURL(entry.url);
        }
      }
      cache.clear();
    };
  }, []);

  return thumbnails;
}
