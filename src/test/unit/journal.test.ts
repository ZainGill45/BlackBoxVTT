import { describe, expect, it } from 'vitest';
import {
  emptyRichTextDocument,
  isRichTextDocument,
  JOURNAL_LINE_LENGTHS,
  MAX_RICH_TEXT_BYTES,
} from '../../shared/journal';

describe('Journal rich text validation', () => {
  it('accepts the empty document and a local Storage image node', () => {
    expect(emptyRichTextDocument()).toMatchObject({ lineLength: 'wide' });
    expect(isRichTextDocument(emptyRichTextDocument())).toBe(true);
    expect(isRichTextDocument({
      doc: {
        content: [{
          attrs: {
            assetId: '11111111-1111-4111-8111-111111111111',
          },
          type: 'assetImage',
        }],
        type: 'doc',
      },
    })).toBe(true);
  });

  it('rejects executable links, remote images, and excessive nesting', () => {
    expect(isRichTextDocument({
      doc: { content: [{ marks: [{ attrs: { href: 'javascript:alert(1)' }, type: 'link' }], text: 'bad', type: 'text' }], type: 'doc' },
    })).toBe(false);
    expect(isRichTextDocument({ doc: { attrs: { src: 'https://example.com/a.png' }, type: 'image' } })).toBe(false);
    let nested: Record<string, unknown> = { type: 'paragraph' };
    for (let index = 0; index < 34; index += 1) nested = { content: [nested], type: 'blockquote' };
    expect(isRichTextDocument({ doc: { content: [nested], type: 'doc' } })).toBe(false);
  });

  it('rejects unknown fields and bounded-but-hostile attribute shapes', () => {
    expect(isRichTextDocument({
      doc: { type: 'doc' },
      extra: true,
    })).toBe(false);
    expect(isRichTextDocument({
      doc: { content: [{ extra: true, type: 'paragraph' }], type: 'doc' },
    })).toBe(false);
    let nestedAttribute: Record<string, unknown> = { value: true };
    for (let index = 0; index < 10; index += 1) {
      nestedAttribute = { nested: nestedAttribute };
    }
    expect(isRichTextDocument({
      doc: {
        content: [{ attrs: nestedAttribute, type: 'paragraph' }],
        type: 'doc',
      },
    })).toBe(false);
    expect(isRichTextDocument({
      doc: {
        content: [{ attrs: { value: 'x'.repeat(MAX_RICH_TEXT_BYTES + 1) }, type: 'paragraph' }],
        type: 'doc',
      },
    })).toBe(false);
  });

  it('accepts supported text sizing and rejects unbounded sizing attributes', () => {
    const documentWithSizing = (
      attrs: Record<string, string | null>,
      lineLength?: string,
    ) => ({
      doc: {
        content: [{
          content: [{ marks: [{ attrs, type: 'textStyle' }], text: 'Text', type: 'text' }],
          type: 'paragraph',
        }],
        type: 'doc',
      },
      ...(lineLength ? { lineLength } : {}),
    });

    for (const lineLength of JOURNAL_LINE_LENGTHS) {
      expect(isRichTextDocument(documentWithSizing({
        color: null,
        fontFamily: null,
        fontSize: '24px',
      }, lineLength))).toBe(true);
    }
    expect(isRichTextDocument(documentWithSizing({ fontSize: null }, 'full'))).toBe(true);
    expect(isRichTextDocument(documentWithSizing({ fontSize: '999px' }))).toBe(false);
    expect(isRichTextDocument(documentWithSizing({}, 'endless'))).toBe(false);
  });
});
