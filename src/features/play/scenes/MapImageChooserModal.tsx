import { ImageOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import type { AssetApi, AssetView } from '../../../shared/assets';
import { useAssetPreviewUrl } from '../useAssetPreviewUrl';
import type { AssetThumbnail } from './useAssetThumbnails';
import styles from './MapImageChooserModal.module.css';

export interface MapImageSelection {
  assetId: string;
  height: number;
  width: number;
}

interface MapImageChooserModalProps {
  assetApi?: AssetApi;
  campaignId: string;
  isOpen: boolean;
  onDismiss: () => void;
  onSelect: (selection: MapImageSelection) => void;
  selectedAssetId: string | null;
  thumbnails: ReadonlyMap<string, AssetThumbnail>;
}

function ChoiceTile({
  asset,
  assetApi,
  campaignId,
  isSelected,
  onSelect,
  thumbnail,
}: {
  asset: AssetView;
  assetApi?: AssetApi;
  campaignId: string;
  isSelected: boolean;
  onSelect: (selection: MapImageSelection) => void;
  thumbnail: AssetThumbnail | undefined;
}) {
  // Already-warmed images cost nothing; anything else falls back to the asset
  // itself so the chooser still works for images no scene uses yet.
  const fallbackUrl = useAssetPreviewUrl(
    assetApi,
    campaignId,
    thumbnail ? null : asset.id,
  );
  const url = thumbnail?.url ?? fallbackUrl;
  // The manifest does not record pixel dimensions, and the tile may be showing
  // a downscaled thumbnail, so the real size comes from the cache when it can.
  const imageRef = useRef<HTMLImageElement | null>(null);

  return (
    <li>
      <button
        type="button"
        className={styles.tile}
        data-selected={isSelected}
        disabled={!url}
        onClick={() =>
          onSelect({
            assetId: asset.id,
            height:
              thumbnail?.sourceHeight ||
              imageRef.current?.naturalHeight ||
              0,
            width:
              thumbnail?.sourceWidth || imageRef.current?.naturalWidth || 0,
          })
        }
      >
        <span className={styles.thumbnail}>
          {url ? (
            <img ref={imageRef} alt="" decoding="async" src={url} />
          ) : (
            <ImageOff aria-hidden size="1.5rem" strokeWidth={1.4} />
          )}
        </span>
        <span className={styles.tileName}>{asset.displayName}</span>
      </button>
    </li>
  );
}

export function MapImageChooserModal({
  assetApi,
  campaignId,
  isOpen,
  onDismiss,
  onSelect,
  selectedAssetId,
  thumbnails,
}: MapImageChooserModalProps) {
  const [images, setImages] = useState<AssetView[]>([]);

  useEffect(() => {
    if (!assetApi || !isOpen) {
      return undefined;
    }
    let current = true;
    const load = () => {
      void assetApi.list({ campaignId }).then((result) => {
        if (current && result.ok) {
          setImages(result.value.filter((asset) => asset.kind === 'image'));
        }
      });
    };
    load();
    const removeChanged = assetApi.onChanged((event) => {
      if (event.campaignId === campaignId) {
        setImages(event.assets.filter((asset) => asset.kind === 'image'));
      }
    });
    return () => {
      current = false;
      removeChanged();
    };
  }, [assetApi, campaignId, isOpen]);

  return (
    <Modal
      accessibleLabel="Choose a map image"
      className={styles.chooser}
      contentClassName={styles.content}
      isOpen={isOpen}
      onDismiss={onDismiss}
    >
      {images.length === 0 ? (
        <p className={styles.empty}>
          This campaign has no images yet. Add some from the Storage tab first.
        </p>
      ) : (
        <ul className={styles.tiles}>
          {images.map((asset) => (
            <ChoiceTile
              key={asset.id}
              asset={asset}
              assetApi={assetApi}
              campaignId={campaignId}
              isSelected={asset.id === selectedAssetId}
              thumbnail={thumbnails.get(asset.id)}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </Modal>
  );
}
