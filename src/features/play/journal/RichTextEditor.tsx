import { Node, mergeAttributes, type JSONContent, type NodeViewProps } from '@tiptap/core';
import { FileHandler } from '@tiptap/extension-file-handler';
import { Highlight } from '@tiptap/extension-highlight';
import { TableKit } from '@tiptap/extension-table';
import { TextAlign } from '@tiptap/extension-text-align';
import { Color, FontFamily, TextStyle } from '@tiptap/extension-text-style';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Code2,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Table2,
  Underline,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { JournalAssetApi } from '../../../shared/assets';
import {
  RICH_TEXT_SCHEMA_VERSION,
  type JournalTitleStyle,
  type RichTextDocumentV1,
} from '../../../shared/journal';
import {
  JOURNAL_FONT_OPTIONS,
  journalFontCss,
  journalFontValue,
} from './titleStyles';
import styles from './RichTextEditor.module.css';

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

interface CachedImagePreview {
  dispose: () => void;
  url: string;
}

class JournalImagePreviewCache {
  private generation = 0;
  private readonly pending = new Map<string, Promise<string | null>>();
  private readonly previews = new Map<string, CachedImagePreview>();

  constructor(
    private readonly assetApi: JournalAssetApi,
    private readonly campaignId: string,
  ) {}

  peek(assetId: string): string | null {
    return this.previews.get(assetId)?.url ?? null;
  }

  get(assetId: string): Promise<string | null> {
    const cached = this.peek(assetId);
    if (cached) return Promise.resolve(cached);
    const existing = this.pending.get(assetId);
    if (existing) return existing;

    const generation = this.generation;
    const pending = this.load(assetId).then((preview) => {
      if (this.pending.get(assetId) === pending) {
        this.pending.delete(assetId);
      }
      if (!preview) return null;
      if (generation !== this.generation) {
        preview.dispose();
        return null;
      }
      this.previews.set(assetId, preview);
      return preview.url;
    });
    this.pending.set(assetId, pending);
    return pending;
  }

  dispose(): void {
    this.generation += 1;
    this.pending.clear();
    for (const preview of this.previews.values()) preview.dispose();
    this.previews.clear();
  }

  private async load(assetId: string): Promise<CachedImagePreview | null> {
    const result = await this.assetApi.getPreview({
      assetId,
      campaignId: this.campaignId,
    });
    if (!result.ok) return null;

    const { token, url } = result.value;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Image preview failed to load.');
      const objectUrl = URL.createObjectURL(await response.blob());
      void this.assetApi.releasePreview({ token });
      return {
        dispose: () => URL.revokeObjectURL(objectUrl),
        url: objectUrl,
      };
    } catch {
      return {
        dispose: () => void this.assetApi.releasePreview({ token }),
        url,
      };
    }
  }
}

function AssetImageView({ extension, node, selected }: NodeViewProps) {
  const { previewCache } = extension.options as { previewCache: JournalImagePreviewCache };
  const assetId = node.attrs.assetId as string;
  const [source, setSource] = useState<string | null>(() => previewCache.peek(assetId));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    void previewCache.get(assetId).then((url) => {
      if (!current) return;
      setSource(url);
      setFailed(!url);
    });
    return () => {
      current = false;
    };
  }, [assetId, previewCache]);
  return (
    <NodeViewWrapper
      as="figure"
      className={styles.assetImage}
      data-selected={selected}
    >
      {source ? <img alt="" draggable={false} src={source} /> : <div className={styles.imageLoading}>{failed ? 'Image unavailable' : 'Loading image...'}</div>}
    </NodeViewWrapper>
  );
}

function assetImageExtension(previewCache: JournalImagePreviewCache) {
  return Node.create({
    name: 'assetImage',
    group: 'block',
    atom: true,
    draggable: false,
    addOptions: () => ({ previewCache }),
    addAttributes: () => ({
      assetId: { default: null },
    }),
    parseHTML: () => [{ tag: 'figure[data-journal-asset]' }],
    renderHTML: ({ HTMLAttributes }) => [
      'figure',
      mergeAttributes(HTMLAttributes, { 'data-journal-asset': HTMLAttributes.assetId }),
    ],
    addNodeView: () => ReactNodeViewRenderer(AssetImageView),
  }).configure({ previewCache });
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

interface RichTextEditorProps {
  assetApi: JournalAssetApi;
  campaignId: string;
  content: RichTextDocumentV1;
  contentHeader?: ReactNode;
  editable: boolean;
  onBodyFocus?: () => void;
  onBlur?: () => void;
  onChange?: (content: RichTextDocumentV1) => void;
  onChooseImage?: (insert: (assetId: string) => void) => void;
  titleFormatting?: {
    onChange: (style: JournalTitleStyle) => void;
    style: JournalTitleStyle;
  } | null;
}

export function RichTextEditor({
  assetApi,
  campaignId,
  content,
  contentHeader,
  editable,
  onBodyFocus,
  onBlur,
  onChange,
  onChooseImage,
  titleFormatting = null,
}: RichTextEditorProps) {
  const onBlurRef = useRef(onBlur);
  const onChangeRef = useRef(onChange);
  const previewCache = useMemo(
    () => new JournalImagePreviewCache(assetApi, campaignId),
    [assetApi, campaignId],
  );
  onBlurRef.current = onBlur;
  onChangeRef.current = onChange;
  useEffect(() => () => previewCache.dispose(), [previewCache]);
  const insertImportedFiles = async (editor: ReturnType<typeof useEditor>, files: File[]) => {
    if (!editor) return;
    for (const file of files) {
      if (!IMAGE_MIME_TYPES.includes(file.type as typeof IMAGE_MIME_TYPES[number])) continue;
      const result = await assetApi.importImageBytes({
        bytesBase64: await fileToBase64(file),
        campaignId,
        filename: file.name || 'Pasted Image',
        mimeType: file.type as typeof IMAGE_MIME_TYPES[number],
      });
      const asset = result.ok ? result.value.at(-1) : null;
      if (asset) editor.chain().focus().insertContent({ type: 'assetImage', attrs: { assetId: asset.id } }).run();
    }
  };
  const editor = useEditor({
    content: content.doc as JSONContent,
    editable,
    editorProps: {
      attributes: {
        'aria-label': editable ? 'Page content' : 'Page content (read only)',
        'aria-multiline': 'true',
        'aria-readonly': String(!editable),
        role: 'textbox',
      },
    },
    extensions: [
      StarterKit.configure({ link: { openOnClick: !editable, protocols: ['http', 'https', 'mailto'] } }),
      TextStyle,
      Color,
      FontFamily,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TableKit.configure({ table: { resizable: true } }),
      assetImageExtension(previewCache),
      FileHandler.configure({
        allowedMimeTypes: [...IMAGE_MIME_TYPES],
        consumePasteEvent: true,
        onDrop: (instance, files) => void insertImportedFiles(instance, files),
        onPaste: (instance, files) => void insertImportedFiles(instance, files),
      }),
    ],
    immediatelyRender: false,
    onBlur: () => onBlurRef.current?.(),
    onUpdate: ({ editor: instance }) => onChangeRef.current?.({
      doc: instance.getJSON() as RichTextDocumentV1['doc'],
      schemaVersion: RICH_TEXT_SCHEMA_VERSION,
    }),
  }, [assetApi, campaignId, editable, previewCache]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = JSON.stringify(editor.getJSON());
    const next = JSON.stringify(content.doc);
    if (current !== next) editor.commands.setContent(content.doc as JSONContent, { emitUpdate: false });
  }, [content, editor]);

  if (!editor) return <div className={styles.editor}>Loading editor…</div>;
  const button = (
    label: string,
    Icon: LucideIcon,
    action: () => void,
    active = false,
    disabled = false,
  ) => (
    <button
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      title={label}
      type="button"
      onClick={action}
    >
      <Icon aria-hidden size="1rem" strokeWidth={1.6} />
    </button>
  );
  const titleStyle = titleFormatting?.style;
  const changeTitleStyle = (
    change: (current: JournalTitleStyle) => JournalTitleStyle,
  ) => {
    if (titleFormatting) titleFormatting.onChange(change(titleFormatting.style));
  };
  const bodyColor = editor.getAttributes('textStyle').color;
  const selectedColor = titleStyle?.color ??
    (typeof bodyColor === 'string' && /^#[0-9a-f]{6}$/iu.test(bodyColor)
      ? bodyColor
      : '#f0f0f0');
  const selectedFont = titleStyle?.fontFamily ??
    journalFontValue(editor.getAttributes('textStyle').fontFamily);
  const titleTarget = Boolean(titleFormatting);
  const showToolbar = editable || titleTarget;
  return (
    <div className={styles.editor} data-editable={editable} data-toolbar={showToolbar}>
      {showToolbar ? (
        <div className={styles.toolbar} aria-label="Rich text formatting toolbar" role="toolbar">
          <label className={styles.selectControl}>
            <span className="sr-only">Text format</span>
            <select aria-label="Text format" disabled={titleTarget} value={editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p'} onChange={(event) => {
              if (event.currentTarget.value === 'p') editor.chain().focus().setParagraph().run();
              else editor.chain().focus().toggleHeading({ level: Number(event.currentTarget.value.slice(1)) as 1 | 2 | 3 }).run();
            }}>
              <option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option>
            </select>
            <ChevronDown aria-hidden size="0.9rem" strokeWidth={1.7} />
          </label>
          <label className={`${styles.selectControl} ${styles.fontSelect}`}>
            <span className="sr-only">Font family</span>
            <select aria-label="Font family" value={selectedFont} onChange={(event) => {
              const value = event.currentTarget.value as JournalTitleStyle['fontFamily'];
              if (titleFormatting) changeTitleStyle((current) => ({ ...current, fontFamily: value }));
              else {
                const family = journalFontCss(value);
                if (family) editor.chain().focus().setFontFamily(family).run();
                else editor.chain().focus().unsetFontFamily().run();
              }
            }}>
              {JOURNAL_FONT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <ChevronDown aria-hidden size="0.9rem" strokeWidth={1.7} />
          </label>
          {button('Bold', Bold, () => titleFormatting ? changeTitleStyle((current) => ({ ...current, bold: !current.bold })) : void editor.chain().focus().toggleBold().run(), titleStyle?.bold ?? editor.isActive('bold'))}
          {button('Italic', Italic, () => titleFormatting ? changeTitleStyle((current) => ({ ...current, italic: !current.italic })) : void editor.chain().focus().toggleItalic().run(), titleStyle?.italic ?? editor.isActive('italic'))}
          {button('Underline', Underline, () => titleFormatting ? changeTitleStyle((current) => ({ ...current, underline: !current.underline })) : void editor.chain().focus().toggleUnderline().run(), titleStyle?.underline ?? editor.isActive('underline'))}
          {button('Strike', Strikethrough, () => titleFormatting ? changeTitleStyle((current) => ({ ...current, strike: !current.strike })) : void editor.chain().focus().toggleStrike().run(), titleStyle?.strike ?? editor.isActive('strike'))}
          <input aria-label="Text color" type="color" value={selectedColor} onChange={(event) => titleFormatting ? changeTitleStyle((current) => ({ ...current, color: event.currentTarget.value })) : void editor.chain().focus().setColor(event.currentTarget.value).run()} />
          {button('Align left', AlignLeft, () => titleFormatting ? changeTitleStyle((current) => ({ ...current, alignment: 'left' })) : void editor.chain().focus().setTextAlign('left').run(), titleStyle?.alignment === 'left' || (!titleTarget && editor.isActive({ textAlign: 'left' })))}
          {button('Align center', AlignCenter, () => titleFormatting ? changeTitleStyle((current) => ({ ...current, alignment: 'center' })) : void editor.chain().focus().setTextAlign('center').run(), titleStyle?.alignment === 'center' || (!titleTarget && editor.isActive({ textAlign: 'center' })))}
          {button('Align right', AlignRight, () => titleFormatting ? changeTitleStyle((current) => ({ ...current, alignment: 'right' })) : void editor.chain().focus().setTextAlign('right').run(), titleStyle?.alignment === 'right' || (!titleTarget && editor.isActive({ textAlign: 'right' })))}
          {button('Bulleted list', List, () => { editor.chain().focus().toggleBulletList().run(); }, editor.isActive('bulletList'), titleTarget)}
          {button('Numbered list', ListOrdered, () => { editor.chain().focus().toggleOrderedList().run(); }, editor.isActive('orderedList'), titleTarget)}
          {button('Quote', Quote, () => { editor.chain().focus().toggleBlockquote().run(); }, editor.isActive('blockquote'), titleTarget)}
          {button('Horizontal rule', Minus, () => { editor.chain().focus().setHorizontalRule().run(); }, false, titleTarget)}
          {button('Link', LinkIcon, () => {
            const href = window.prompt('Link URL (http, https, or mailto)');
            if (href && /^(https?:|mailto:)/i.test(href)) editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
          }, editor.isActive('link'), titleTarget)}
          {button('Table', Table2, () => { editor.chain().focus().insertTable({ cols: 3, rows: 3, withHeaderRow: true }).run(); }, false, titleTarget)}
          {button('Code block', Code2, () => { editor.chain().focus().toggleCodeBlock().run(); }, editor.isActive('codeBlock'), titleTarget)}
          {button('Image', ImageIcon, () => onChooseImage?.((assetId) => editor.commands.insertContentAt(editor.state.selection.to, { type: 'assetImage', attrs: { assetId } })), false, titleTarget)}
        </div>
      ) : null}
      {contentHeader}
      <EditorContent className={styles.content} editor={editor} onFocus={onBodyFocus} />
    </div>
  );
}
