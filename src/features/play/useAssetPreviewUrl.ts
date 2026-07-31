import { useEffect, useState } from 'react';
import type { AssetApi } from '../../shared/assets';

interface Grant {
  assetId: string | null;
  url: string | null;
}

/**
 * Holds a `blackbox-asset://` preview grant for the lifetime of the caller and
 * releases it when the asset changes or the component unmounts. A player who
 * has not finished synchronizing an asset gets `null` and a second attempt once
 * the asset manifest changes.
 */
export function useAssetPreviewUrl(
  assetApi: AssetApi | undefined,
  campaignId: string,
  assetId: string | null,
): string | null {
  const [grant, setGrant] = useState<Grant>({ assetId: null, url: null });
  const [attempt, setAttempt] = useState(0);
  // A stale grant from the previous asset must never leak into this render.
  const url = grant.assetId === assetId ? grant.url : null;

  useEffect(() => {
    if (!assetApi || !assetId) {
      return undefined;
    }

    let active = true;
    let token: string | null = null;

    void assetApi.getPreview({ assetId, campaignId }).then((result) => {
      if (!result.ok) {
        return;
      }
      if (!active) {
        void assetApi.releasePreview({ token: result.value.token });
        return;
      }
      token = result.value.token;
      setGrant({ assetId, url: result.value.url });
    });

    return () => {
      active = false;
      if (token) {
        void assetApi.releasePreview({ token });
      }
    };
  }, [assetApi, assetId, attempt, campaignId]);

  useEffect(() => {
    if (!assetApi || !assetId || url) {
      return undefined;
    }
    // The asset may still be downloading on a joined player; retry when the
    // campaign manifest changes rather than polling.
    return assetApi.onChanged((event) => {
      if (event.campaignId === campaignId) {
        setAttempt((value) => value + 1);
      }
    });
  }, [assetApi, assetId, campaignId, url]);

  return url;
}
