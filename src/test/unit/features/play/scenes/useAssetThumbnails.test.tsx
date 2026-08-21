import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetApi } from '../../../../../shared/assets';
import {
  createFakeAssetApi,
  makeImageAsset,
  testCampaignId,
} from '../../../../support/scenes';
import { useAssetThumbnails } from '../../../../../features/play/scenes/useAssetThumbnails';

const asset = makeImageAsset();
const otherAsset = makeImageAsset({
  displayName: 'Cellars',
  id: '66666666-6666-4666-8666-666666666666',
});

const originalFetch = globalThis.fetch;
const originalCreateImageBitmap = globalThis.createImageBitmap;
let objectUrls = 0;
let revoked: string[] = [];

function Probe({
  assetApi,
  assetIds,
}: {
  assetApi: AssetApi;
  assetIds: string[];
}) {
  const thumbnails = useAssetThumbnails(assetApi, testCampaignId, assetIds);
  return (
    <ul>
      {[...thumbnails].map(([assetId, thumbnail]) => (
        <li
          key={assetId}
          data-height={thumbnail.sourceHeight}
          data-width={thumbnail.sourceWidth}
        >
          {`${assetId}=${thumbnail.url}`}
        </li>
      ))}
    </ul>
  );
}

beforeEach(() => {
  objectUrls = 0;
  revoked = [];
  globalThis.fetch = (() =>
    Promise.resolve({
      blob: () => Promise.resolve(new Blob()),
      ok: true,
    } as unknown as Response)) as unknown as typeof fetch;
  globalThis.createImageBitmap = ((
    _blob: Blob,
    options?: { resizeHeight?: number; resizeWidth?: number },
  ) =>
    Promise.resolve({
      close: () => undefined,
      height: options?.resizeHeight ?? 3000,
      width: options?.resizeWidth ?? 4000,
    } as unknown as ImageBitmap)) as unknown as typeof createImageBitmap;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    ((callback: (blob: Blob) => void) => callback(new Blob())) as never,
  );
  URL.createObjectURL = vi.fn(() => `blob:thumb-${(objectUrls += 1)}`);
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.createImageBitmap = originalCreateImageBitmap;
  vi.restoreAllMocks();
});

describe('useAssetThumbnails', () => {
  it('builds one thumbnail per distinct asset and releases the grant', async () => {
    const assetApi = createFakeAssetApi([asset, otherAsset]);

    render(
      <Probe
        assetApi={assetApi}
        // The same image twice must not be fetched twice.
        assetIds={[asset.id, asset.id, otherAsset.id]}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });
    expect(assetApi.getPreview).toHaveBeenCalledTimes(2);
    // Nothing holds a preview grant open once the thumbnail exists.
    expect(assetApi.releasePreview).toHaveBeenCalledTimes(2);
    // Object URLs, not the asset protocol, so no refetch on the next mount.
    for (const row of screen.getAllByRole('listitem')) {
      expect(row.textContent).toMatch(/=blob:thumb-\d+$/);
    }
  });

  it('carries the source dimensions so scenes are sized to the map', async () => {
    const assetApi = createFakeAssetApi([asset]);

    render(<Probe assetApi={assetApi} assetIds={[asset.id]} />);

    const row = await screen.findByRole('listitem');
    expect(row).toHaveAttribute('data-width', '4000');
    expect(row).toHaveAttribute('data-height', '3000');
  });

  it('only builds the newcomer when a scene is added', async () => {
    const assetApi = createFakeAssetApi([asset, otherAsset]);
    const { rerender } = render(
      <Probe assetApi={assetApi} assetIds={[asset.id]} />,
    );
    await waitFor(() => {
      expect(assetApi.getPreview).toHaveBeenCalledTimes(1);
    });

    rerender(<Probe assetApi={assetApi} assetIds={[asset.id, otherAsset.id]} />);

    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });
    expect(assetApi.getPreview).toHaveBeenCalledTimes(2);
    // The first thumbnail was kept, not rebuilt.
    expect(revoked).toEqual([]);
  });

  it('rebuilds nothing when the same ids arrive in a new array', async () => {
    const assetApi = createFakeAssetApi([asset]);
    const { rerender } = render(
      <Probe assetApi={assetApi} assetIds={[asset.id]} />,
    );
    await waitFor(() => {
      expect(assetApi.getPreview).toHaveBeenCalledTimes(1);
    });

    rerender(<Probe assetApi={assetApi} assetIds={[asset.id]} />);

    expect(assetApi.getPreview).toHaveBeenCalledTimes(1);
    expect(revoked).toEqual([]);
  });

  it('revokes its object URLs on unmount', async () => {
    const assetApi = createFakeAssetApi([asset]);
    const { unmount } = render(
      <Probe assetApi={assetApi} assetIds={[asset.id]} />,
    );
    await screen.findByRole('listitem');

    unmount();

    expect(revoked).toEqual(['blob:thumb-1']);
  });

  it('falls back to the full asset URL when it cannot build a thumbnail', async () => {
    globalThis.createImageBitmap =
      undefined as unknown as typeof createImageBitmap;
    const assetApi = createFakeAssetApi([asset]);

    const { unmount } = render(
      <Probe assetApi={assetApi} assetIds={[asset.id]} />,
    );

    expect(
      await screen.findByText(`${asset.id}=blackbox-asset://token/${asset.id}`),
    ).toBeInTheDocument();
    // That URL only works while its grant is held, so this one is not released.
    expect(assetApi.releasePreview).not.toHaveBeenCalled();

    unmount();

    expect(assetApi.releasePreview).toHaveBeenCalledWith({
      token: '44444444-4444-4444-8444-444444444444',
    });
  });
});
