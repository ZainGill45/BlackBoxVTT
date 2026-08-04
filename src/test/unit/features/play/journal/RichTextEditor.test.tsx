import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RichTextEditor } from '../../../../../features/play/journal/RichTextEditor';
import { RICH_TEXT_SCHEMA_VERSION } from '../../../../../shared/journal';
import { createFakeAssetApi, testCampaignId } from '../../../../support/scenes';

const assetId = '55555555-5555-4555-8555-555555555555';
const content = {
  doc: {
    content: [
      {
        attrs: {
          assetId,
        },
        type: 'assetImage' as const,
      },
      { type: 'paragraph' as const },
    ],
    type: 'doc' as const,
  },
  schemaVersion: RICH_TEXT_SCHEMA_VERSION,
};

const originalFetch = globalThis.fetch;
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    blob: async () => new Blob(['image'], { type: 'image/png' }),
    ok: true,
  } as Response));
  URL.createObjectURL = vi.fn(() => 'blob:journal-image');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
  vi.restoreAllMocks();
});

describe('RichTextEditor images', () => {
  it('keeps one stable decoded preview while the editor mode rerenders', async () => {
    const assetApi = createFakeAssetApi();
    const view = render(
      <RichTextEditor
        assetApi={assetApi}
        campaignId={testCampaignId}
        content={content}
        editable
      />,
    );

    const image = await screen.findByRole('presentation');
    expect(image).toHaveAttribute('src', 'blob:journal-image');

    view.rerender(
      <RichTextEditor
        assetApi={assetApi}
        campaignId={testCampaignId}
        content={content}
        editable={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('presentation')).toHaveAttribute(
        'src',
        'blob:journal-image',
      );
    });
    expect(assetApi.getPreview).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(assetApi.releasePreview).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:journal-image');
  });
});
