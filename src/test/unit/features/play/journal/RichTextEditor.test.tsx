import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RichTextEditor } from '../../../../../features/play/journal/RichTextEditor';
import {
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
    expect(screen.getByRole('toolbar', { name: 'Rich text formatting toolbar' }))
      .toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Insert' }));
    for (const label of ['Horizontal Rule', 'Table', 'Image']) {
      expect(screen.getByRole('menuitem', { name: label })).toBeVisible();
    }

    const editor = screen.getByRole('textbox', { name: 'Page content' });
    editor.focus();
    await user.keyboard('{Control>}a{/Control}');
    await user.click(screen.getByRole('button', { name: 'Text Color: Default' }));
    const colorOptions = screen.getByRole('listbox', {
      name: 'Text Color: Default options',
    });
    // Five to a row, so a count off the multiple would leave a ragged tail.
    expect(within(colorOptions).getAllByRole('option')).toHaveLength(15);
    expect(within(colorOptions).getByRole('option', { name: 'Text color: Brown' }))
      .toBeVisible();
    await user.click(screen.getByRole('option', { name: 'Text color: Red' }));
    expect(editor.querySelector('span')).toHaveStyle({ color: '#d76f6f' });

    editor.focus();
    await user.keyboard('{Control>}a{/Control}');
    await user.click(screen.getByRole('button', { name: 'Style: Paragraph' }));
    await user.click(screen.getByRole('option', { name: 'Code' }));

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
    await user.click(screen.getByRole('option', { name: '24px' }));
    await user.click(screen.getByRole('button', { name: 'Line Length: Wide' }));
    await user.click(screen.getByRole('option', { name: 'Comfortable' }));

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

const linkedContent = {
  doc: {
    content: [
      {
        content: [
          {
            marks: [
              { attrs: { href: 'https://example.com/' }, type: 'link' as const },
            ],
            text: 'Example',
            type: 'text' as const,
          },
        ],
        type: 'paragraph' as const,
      },
    ],
    type: 'doc' as const,
  },
};

const plainContent = {
  doc: {
    content: [
      {
        content: [{ text: 'Example', type: 'text' as const }],
        type: 'paragraph' as const,
      },
    ],
    type: 'doc' as const,
  },
};

describe('RichTextEditor links', () => {
  it('inserts a link from the toolbar without a browser prompt', async () => {
    const user = userEvent.setup();
    const promptSpy = vi.spyOn(window, 'prompt');

    render(
      <RichTextEditor
        assetApi={createFakeAssetApi()}
        campaignId={testCampaignId}
        content={plainContent}
        documentKey="page:0"
        editable
      />,
    );

    const editor = screen.getByRole('textbox', { name: 'Page content' });
    editor.focus();
    await user.keyboard('{Control>}a{/Control}');
    await user.click(screen.getByRole('button', { name: 'Style: Paragraph' }));
    await user.click(screen.getByRole('option', { name: 'Link' }));

    const field = await screen.findByRole('textbox', { name: 'Link URL' });
    await user.type(field, 'https://example.com/');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(editor.querySelector('a'))
        .toHaveAttribute('href', 'https://example.com/');
    });
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('inserts the URL as linked text when the caret is collapsed', async () => {
    const user = userEvent.setup();

    render(
      <RichTextEditor
        assetApi={createFakeAssetApi()}
        campaignId={testCampaignId}
        content={plainContent}
        documentKey="page:collapsed-link"
        editable
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Style: Paragraph' }));
    await user.click(screen.getByRole('option', { name: 'Link' }));
    const field = await screen.findByRole('textbox', { name: 'Link URL' });
    await user.type(field, 'example.com/handout');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Page content' }).querySelector('a'))
        .toHaveAttribute('href', 'https://example.com/handout');
    });
  });

  it('refuses to apply a URL outside the supported protocols', async () => {
    const user = userEvent.setup();

    render(
      <RichTextEditor
        assetApi={createFakeAssetApi()}
        campaignId={testCampaignId}
        content={plainContent}
        documentKey="page:0"
        editable
      />,
    );

    const editor = screen.getByRole('textbox', { name: 'Page content' });
    editor.focus();
    await user.keyboard('{Control>}a{/Control}');
    await user.click(screen.getByRole('button', { name: 'Style: Paragraph' }));
    await user.click(screen.getByRole('option', { name: 'Link' }));

    const field = await screen.findByRole('textbox', { name: 'Link URL' });
    await user.type(field, 'javascript:alert(1)');

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(editor.querySelector('a')).toBeNull();
  });

  it('follows a link on Alt+click while editing and on click when read only', async () => {
    const user = userEvent.setup();
    const onOpenLink = vi.fn();
    const assetApi = createFakeAssetApi();

    const view = render(
      <RichTextEditor
        assetApi={assetApi}
        campaignId={testCampaignId}
        content={linkedContent}
        documentKey="page:0"
        editable
        onOpenLink={onOpenLink}
      />,
    );

    const anchor = screen
      .getByRole('textbox', { name: 'Page content' })
      .querySelector('a');
    expect(anchor).not.toBeNull();
    (document as Document & { elementFromPoint: unknown }).elementFromPoint =
      () => anchor;

    await user.click(anchor as HTMLElement);
    expect(onOpenLink).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { code: 'AltLeft', key: 'Alt' });
    expect(screen.getByRole('toolbar', { name: 'Rich text formatting toolbar' }).parentElement)
      .toHaveAttribute('data-alt-held', 'true');
    fireEvent.mouseDown(anchor as HTMLElement, { altKey: true, button: 0 });
    expect(onOpenLink).toHaveBeenCalledWith('https://example.com/');
    fireEvent.keyUp(window, { code: 'AltLeft', key: 'Alt' });
    expect(screen.getByRole('toolbar', { name: 'Rich text formatting toolbar' }).parentElement)
      .not.toHaveAttribute('data-alt-held');

    onOpenLink.mockClear();
    view.rerender(
      <RichTextEditor
        assetApi={assetApi}
        campaignId={testCampaignId}
        content={linkedContent}
        documentKey="page:0"
        editable={false}
        onOpenLink={onOpenLink}
      />,
    );

    const readOnlyAnchor = screen
      .getByRole('textbox', { name: 'Page content (read only)' })
      .querySelector('a');
    fireEvent.mouseDown(readOnlyAnchor as HTMLElement, { button: 0 });
    expect(onOpenLink).toHaveBeenCalledWith('https://example.com/');
  });

  it('leaves an unmodified click to the caret and recovers from a missed Alt keyup', async () => {
    const onOpenLink = vi.fn();

    render(
      <RichTextEditor
        assetApi={createFakeAssetApi()}
        campaignId={testCampaignId}
        content={linkedContent}
        documentKey="page:caret"
        editable
        onOpenLink={onOpenLink}
      />,
    );

    const root = screen.getByRole('toolbar', { name: 'Rich text formatting toolbar' })
      .parentElement as HTMLElement;
    const anchor = screen
      .getByRole('textbox', { name: 'Page content' })
      .querySelector('a') as HTMLElement;
    (document as Document & { elementFromPoint: unknown }).elementFromPoint =
      () => anchor;

    // Not cancelled, so ProseMirror still gets to place the caret in the link.
    expect(fireEvent.mouseDown(anchor, { button: 0 })).toBe(true);
    expect(onOpenLink).not.toHaveBeenCalled();

    // Alt goes down here and is released while another window has focus, so the
    // keyup never arrives; the next pointer move has to clear it.
    fireEvent.keyDown(window, { code: 'AltLeft', key: 'Alt' });
    expect(root).toHaveAttribute('data-alt-held', 'true');
    fireEvent.mouseMove(window, { altKey: false });
    expect(root).not.toHaveAttribute('data-alt-held');

    expect(fireEvent.mouseDown(anchor, { button: 0 })).toBe(true);
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it('does not follow a javascript: href', async () => {
    const onOpenLink = vi.fn();
    render(
      <RichTextEditor
        assetApi={createFakeAssetApi()}
        campaignId={testCampaignId}
        content={{
          doc: {
            content: [
              {
                content: [
                  {
                    marks: [
                      { attrs: { href: 'javascript:alert(1)' }, type: 'link' },
                    ],
                    text: 'Unsafe',
                    type: 'text',
                  },
                ],
                type: 'paragraph',
              },
            ],
            type: 'doc',
          },
        }}
        documentKey="page:unsafe"
        editable={false}
        onOpenLink={onOpenLink}
      />,
    );

    const anchor = screen
      .getByRole('textbox', { name: 'Page content (read only)' })
      .querySelector('a');
    expect(anchor).not.toBeNull();
    fireEvent.click(anchor as HTMLElement);
    expect(onOpenLink).not.toHaveBeenCalled();
  });
});
