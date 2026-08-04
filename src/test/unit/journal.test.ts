import { describe, expect, it } from 'vitest';
import {
  emptyRichTextDocument,
  isRichTextDocument,
  MAX_RICH_TEXT_BYTES,
} from '../../shared/journal';

describe('Journal rich text validation', () => {
  it('accepts the empty document and a local Storage image node', () => {
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
      schemaVersion: 1,
    })).toBe(true);
  });

  it('rejects executable links, remote images, and excessive nesting', () => {
    expect(isRichTextDocument({
      doc: { content: [{ marks: [{ attrs: { href: 'javascript:alert(1)' }, type: 'link' }], text: 'bad', type: 'text' }], type: 'doc' },
      schemaVersion: 1,
    })).toBe(false);
    expect(isRichTextDocument({ doc: { attrs: { src: 'https://example.com/a.png' }, type: 'image' }, schemaVersion: 1 })).toBe(false);
    let nested: Record<string, unknown> = { type: 'paragraph' };
    for (let index = 0; index < 34; index += 1) nested = { content: [nested], type: 'blockquote' };
    expect(isRichTextDocument({ doc: { content: [nested], type: 'doc' }, schemaVersion: 1 })).toBe(false);
  });

  it('rejects unknown fields and bounded-but-hostile attribute shapes', () => {
    expect(isRichTextDocument({
      doc: { type: 'doc' },
      extra: true,
      schemaVersion: 1,
    })).toBe(false);
    expect(isRichTextDocument({
      doc: { content: [{ extra: true, type: 'paragraph' }], type: 'doc' },
      schemaVersion: 1,
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
      schemaVersion: 1,
    })).toBe(false);
    expect(isRichTextDocument({
      doc: {
        content: [{ attrs: { value: 'x'.repeat(MAX_RICH_TEXT_BYTES + 1) }, type: 'paragraph' }],
        type: 'doc',
      },
      schemaVersion: 1,
    })).toBe(false);
  });
});
