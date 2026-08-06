import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RichTextEditor } from '../../../../../features/play/journal/RichTextEditor';
import {
  RICH_TEXT_SCHEMA_VERSION,
  isRichTextDocument,
} from '../../../../../shared/journal';
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
        documentKey="page:0"
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
        documentKey="page:0"
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

describe('RichTextEditor typography', () => {
  it('uses labeled toolbar groups and converts the selected paragraph to code', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RichTextEditor
        assetApi={createFakeAssetApi()}
        campaignId={testCampaignId}
        content={{
          doc: {
            content: [{
              content: [{ text: 'Convert this paragraph', type: 'text' }],
              type: 'paragraph',
            }],
            type: 'doc',
          },
          schemaVersion: RICH_TEXT_SCHEMA_VERSION,
        }}
        documentKey="page:toolbar-groups"
        editable
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('button', { name: 'Style: Paragraph' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Alignment: Left' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Font Family: Default' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Font Size: Default' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Line Length: Wide' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Insert' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Text Color: Default' })).toBeVisible();
    const toolbar = screen.getByRole('toolbar', { name: 'Rich text formatting toolbar' });
    expect(Array.from(toolbar.children).every((control) => control.tagName === 'DETAILS'))
      .toBe(true);

    await user.click(screen.getByRole('button', { name: 'Insert' }));
    for (const label of ['Horizontal Rule', 'Table', 'Image']) {
      expect(screen.getByRole('button', { name: label }).querySelector('svg'))
        .toBeInTheDocument();
    }

    const editor = screen.getByRole('textbox', { name: 'Page content' });
    editor.focus();
    await user.keyboard('{Control>}a{/Control}');
    await user.click(screen.getByRole('button', { name: 'Text Color: Default' }));
    const colorOptions = screen.getByRole('group', {
      name: 'Text Color: Default options',
    });
    expect(within(colorOptions).getAllByRole('button')).toHaveLength(12);
    expect(within(colorOptions).getByRole('button', { name: 'Text color: Brown' }))
      .toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Text color: Red' }));
    expect(editor.querySelector('span')).toHaveStyle({ color: '#d76f6f' });

    editor.focus();
    await user.keyboard('{Control>}a{/Control}');
    await user.click(screen.getByRole('button', { name: 'Style: Paragraph' }));
    await user.click(screen.getByRole('button', { name: 'Code' }));

    await waitFor(() => {
      expect(editor.querySelector('pre')).not.toBeNull();
      expect(onChange.mock.calls.at(-1)?.[0].doc.content?.[0]?.type)
        .toBe('codeBlock');
    });
  });

  it('applies font size to text and line length to the page width', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const existingContent = {
      doc: {
        content: [{
          attrs: { textAlign: null },
          content: [{ text: 'Existing journal text', type: 'text' as const }],
          type: 'paragraph' as const,
        }],
        type: 'doc' as const,
      },
      schemaVersion: RICH_TEXT_SCHEMA_VERSION,
    };
    render(
      <RichTextEditor
        assetApi={createFakeAssetApi()}
        campaignId={testCampaignId}
        content={existingContent}
        documentKey="page:typography"
        editable
        onChange={onChange}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    editor.focus();
    await user.keyboard('{Control>}a{/Control}');
    await user.click(screen.getByRole('button', { name: 'Font Size: Default' }));
    await user.click(screen.getByRole('button', { name: '24px' }));
    await user.click(screen.getByRole('button', { name: 'Line Length: Wide' }));
    await user.click(screen.getByRole('button', { name: 'Comfortable' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const emittedContent = onChange.mock.calls.at(-1)?.[0];
    expect(emittedContent).toMatchObject({
      doc: {
        content: [{
          content: [{
            marks: [{
              attrs: {
                color: null,
                fontFamily: null,
                fontSize: '24px',
              },
              type: 'textStyle',
            }],
            text: 'Existing journal text',
            type: 'text',
          }],
          type: 'paragraph',
        }],
        type: 'doc',
      },
      lineLength: 'comfortable',
    });
    expect(isRichTextDocument(emittedContent)).toBe(true);
    expect(editor.querySelector('span')).toHaveStyle({ fontSize: '24px' });
    expect(editor.parentElement).toHaveAttribute('data-line-length', 'comfortable');
  });
});
