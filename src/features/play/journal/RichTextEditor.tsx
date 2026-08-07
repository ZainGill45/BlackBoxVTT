import { Node, mergeAttributes, type JSONContent, type NodeViewProps } from '@tiptap/core';
import { FileHandler } from '@tiptap/extension-file-handler';
import { Highlight } from '@tiptap/extension-highlight';
import { TableKit } from '@tiptap/extension-table';
import { TextAlign } from '@tiptap/extension-text-align';
import {
  Color,
  FontFamily,
  FontSize,
  TextStyle,
} from '@tiptap/extension-text-style';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import {
  Image as ImageIcon,
  Minus,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dropdown, DropdownOption } from '../../../components/ui/Dropdown';
import type { JournalAssetApi } from '../../../shared/assets';
import {
  DEFAULT_JOURNAL_LINE_LENGTH,
  JOURNAL_FONT_SIZES,
  type JournalLineLength,
  type JournalTitleStyle,
  type RichTextDocument,
} from '../../../shared/journal';
import {
  JOURNAL_FONT_OPTIONS,
  journalFontCss,
  journalFontValue,
} from './titleStyles';
import styles from './RichTextEditor.module.css';

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

const TEXT_COLOR_OPTIONS = [
  { label: 'Default', value: null },
  { label: 'White', value: '#f0f0f0' },
  { label: 'Gray', value: '#b8b8b8' },
  { label: 'Red', value: '#d76f6f' },
  { label: 'Orange', value: '#d9965b' },
  { label: 'Brown', value: '#a8795d' },
  { label: 'Yellow', value: '#d6c865' },
  { label: 'Green', value: '#6fbd73' },
  { label: 'Cyan', value: '#67b7c7' },
  { label: 'Blue', value: '#6f91d7' },
  { label: 'Purple', value: '#9a7bd1' },
  { label: 'Pink', value: '#d77fa5' },
] as const;

const LINE_LENGTH_OPTIONS: ReadonlyArray<{
  label: string;
  value: JournalLineLength;
}> = [
  { label: 'Narrow', value: 'narrow' },
  { label: 'Compact', value: 'compact' },
  { label: 'Standard', value: 'standard' },
  { label: 'Comfortable', value: 'comfortable' },
  { label: 'Wide', value: 'wide' },
  { label: 'Expanded', value: 'extra-wide' },
  { label: 'Full', value: 'full' },
];

interface ToolbarMenuProps {
  children: ReactNode;
  disabled?: boolean;
  label: string;
}

function ToolbarMenu({ children, disabled = false, label }: ToolbarMenuProps) {
  return (
    <Dropdown
      className={styles.menuControl}
      disabled={disabled}
      label={label}
    >
      {children}
    </Dropdown>
  );
}

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
  content: RichTextDocument;
  documentKey: string;
  editable: boolean;
  onBodyFocus?: () => void;
  onBlur?: () => void;
  onChange?: (content: RichTextDocument) => void;
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
  documentKey,
  editable,
  onBodyFocus,
  onBlur,
  onChange,
  onChooseImage,
  titleFormatting = null,
}: RichTextEditorProps) {
  const onBlurRef = useRef(onBlur);
  const onChangeRef = useRef(onChange);
  const contentRef = useRef(content);
  const [lineLength, setLineLength] = useState<JournalLineLength>(
    content.lineLength ?? DEFAULT_JOURNAL_LINE_LENGTH,
  );
  const lineLengthRef = useRef(lineLength);
  const previewCache = useMemo(
    () => new JournalImagePreviewCache(assetApi, campaignId),
    [assetApi, campaignId],
  );
  useEffect(() => {
    onBlurRef.current = onBlur;
    onChangeRef.current = onChange;
    contentRef.current = content;
    lineLengthRef.current = lineLength;
  }, [content, lineLength, onBlur, onChange]);
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
      FontSize,
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
      doc: instance.getJSON() as RichTextDocument['doc'],
      lineLength: lineLengthRef.current,
    }),
  }, [assetApi, campaignId, editable, previewCache]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const nextLineLength = contentRef.current.lineLength ?? DEFAULT_JOURNAL_LINE_LENGTH;
    lineLengthRef.current = nextLineLength;
    setLineLength(nextLineLength);
    const next = editor.schema.nodeFromJSON(contentRef.current.doc as JSONContent);
    if (!editor.state.doc.eq(next)) {
      editor.commands.setContent(contentRef.current.doc as JSONContent, { emitUpdate: false });
    }
  }, [documentKey, editor]);

  if (!editor) return <div className={styles.editor}>Loading editor…</div>;
  const titleStyle = titleFormatting?.style;
  const changeTitleStyle = (
    change: (current: JournalTitleStyle) => JournalTitleStyle,
  ) => {
    if (titleFormatting) titleFormatting.onChange(change(titleFormatting.style));
  };
  const bodyTextStyle = editor.getAttributes('textStyle');
  const bodyColor = bodyTextStyle.color;
  const selectedTextColor = titleStyle?.color ??
    (typeof bodyColor === 'string' && /^#[0-9a-f]{6}$/iu.test(bodyColor)
      ? bodyColor
      : null);
  const selectedTextColorName = TEXT_COLOR_OPTIONS.find(
    (option) => option.value?.toLowerCase() === selectedTextColor?.toLowerCase() ||
      option.value === selectedTextColor,
  )?.label ?? 'Custom';
  const selectedFont = titleStyle?.fontFamily ??
    journalFontValue(bodyTextStyle.fontFamily);
  const selectedFontName = JOURNAL_FONT_OPTIONS.find(
    (option) => option.value === selectedFont,
  )?.label ?? 'Default';
  const selectedFontSize = JOURNAL_FONT_SIZES.includes(
    bodyTextStyle.fontSize as typeof JOURNAL_FONT_SIZES[number],
  ) ? bodyTextStyle.fontSize as typeof JOURNAL_FONT_SIZES[number] : 'default';
  const selectedFontSizeName = selectedFontSize === 'default' ? 'Default' : selectedFontSize;
  const titleTarget = Boolean(titleFormatting);
  const selectedAlignment = titleStyle?.alignment === 'center' ||
    (!titleTarget && editor.isActive({ textAlign: 'center' }))
    ? 'center'
    : titleStyle?.alignment === 'right' ||
      (!titleTarget && editor.isActive({ textAlign: 'right' }))
      ? 'right'
      : 'left';
  const selectedBlockStyle = titleTarget
    ? 'Title'
    : editor.isActive('heading', { level: 1 })
      ? 'Heading 1'
      : editor.isActive('heading', { level: 2 })
        ? 'Heading 2'
        : editor.isActive('heading', { level: 3 })
          ? 'Heading 3'
          : editor.isActive('codeBlock')
            ? 'Code'
            : editor.isActive('blockquote')
              ? 'Quote'
              : editor.isActive('bulletList')
                ? 'Unordered List'
                : editor.isActive('orderedList')
                  ? 'Ordered List'
                  : 'Paragraph';
  const selectedLineLengthName = LINE_LENGTH_OPTIONS.find(
    (option) => option.value === lineLength,
  )?.label ?? 'Wide';
  const menuItem = (
    label: string,
    action: () => void,
    active?: boolean,
    disabled = false,
    Icon?: LucideIcon,
  ) => (
    <DropdownOption
      key={label}
      active={active}
      disabled={disabled || (!editable && !titleTarget)}
      icon={Icon ? <Icon aria-hidden size="1rem" /> : undefined}
      label={label}
      onSelect={action}
    />
  );
  const applyTextColor = (value: string | null) => {
    if (titleFormatting) {
      changeTitleStyle((current) => ({ ...current, color: value }));
    } else if (value) {
      editor.chain().focus().setColor(value).run();
    } else {
      editor.chain().focus().unsetColor().run();
    }
  };
  return (
    <div className={styles.editor} data-editable={editable} data-toolbar="true">
      <div className={styles.toolbar} aria-label="Rich text formatting toolbar" role="toolbar">
        <ToolbarMenu
          disabled={!editable && !titleTarget}
          label={`Style: ${selectedBlockStyle}`}
        >
          {menuItem('Paragraph', () => {
            editor.chain().focus().setParagraph().run();
          }, !titleTarget && editor.isActive('paragraph'), titleTarget)}
          {menuItem('Heading 1', () => {
            editor.chain().focus().setHeading({ level: 1 }).run();
          }, !titleTarget && editor.isActive('heading', { level: 1 }), titleTarget)}
          {menuItem('Heading 2', () => {
            editor.chain().focus().setHeading({ level: 2 }).run();
          }, !titleTarget && editor.isActive('heading', { level: 2 }), titleTarget)}
          {menuItem('Heading 3', () => {
            editor.chain().focus().setHeading({ level: 3 }).run();
          }, !titleTarget && editor.isActive('heading', { level: 3 }), titleTarget)}
          <div className={styles.menuDivider} />
          {menuItem('Bold', () => {
            if (titleFormatting) {
              changeTitleStyle((current) => ({ ...current, bold: !current.bold }));
            } else {
              editor.chain().focus().toggleBold().run();
            }
          }, titleStyle?.bold ?? editor.isActive('bold'))}
          {menuItem('Italic', () => {
            if (titleFormatting) {
              changeTitleStyle((current) => ({ ...current, italic: !current.italic }));
            } else {
              editor.chain().focus().toggleItalic().run();
            }
          }, titleStyle?.italic ?? editor.isActive('italic'))}
          {menuItem('Strikethrough', () => {
            if (titleFormatting) {
              changeTitleStyle((current) => ({ ...current, strike: !current.strike }));
            } else {
              editor.chain().focus().toggleStrike().run();
            }
          }, titleStyle?.strike ?? editor.isActive('strike'))}
          {menuItem('Quote', () => {
            editor.chain().focus().toggleBlockquote().run();
          }, editor.isActive('blockquote'), titleTarget)}
          {menuItem('Link', () => {
            const href = window.prompt('Link URL (http, https, or mailto)');
            if (href && /^(https?:|mailto:)/iu.test(href)) {
              editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
            }
          }, editor.isActive('link'), titleTarget)}
          {menuItem('Code', () => {
            editor.chain().focus().toggleCodeBlock().run();
          }, editor.isActive('codeBlock'), titleTarget)}
          {menuItem('Unordered List', () => {
            editor.chain().focus().toggleBulletList().run();
          }, editor.isActive('bulletList'), titleTarget)}
          {menuItem('Ordered List', () => {
            editor.chain().focus().toggleOrderedList().run();
          }, editor.isActive('orderedList'), titleTarget)}
        </ToolbarMenu>
        <ToolbarMenu
          disabled={!editable && !titleTarget}
          label={`Alignment: ${selectedAlignment[0].toUpperCase()}${selectedAlignment.slice(1)}`}
        >
          {(['left', 'center', 'right'] as const).map((value) => menuItem(
            `${value[0].toUpperCase()}${value.slice(1)}`,
            () => {
              if (titleFormatting) {
                changeTitleStyle((current) => ({ ...current, alignment: value }));
              } else {
                editor.chain().focus().setTextAlign(value).run();
              }
            },
            selectedAlignment === value,
          ))}
        </ToolbarMenu>
        <ToolbarMenu
          disabled={!editable && !titleTarget}
          label={`Font Family: ${selectedFontName}`}
        >
          {JOURNAL_FONT_OPTIONS.map((option) => menuItem(
            option.label,
            () => {
              if (titleFormatting) {
                changeTitleStyle((current) => ({ ...current, fontFamily: option.value }));
              } else {
                const family = journalFontCss(option.value);
                if (family) editor.chain().focus().setFontFamily(family).run();
                else editor.chain().focus().unsetFontFamily().run();
              }
            },
            selectedFont === option.value,
          ))}
        </ToolbarMenu>
        <ToolbarMenu
          disabled={titleTarget || !editable}
          label={`Font Size: ${selectedFontSizeName}`}
        >
          {menuItem('Default', () => {
            editor.chain().focus().unsetFontSize().run();
          }, selectedFontSize === 'default', titleTarget)}
          {JOURNAL_FONT_SIZES.map((size) => menuItem(
            size,
            () => editor.chain().focus().setFontSize(size).run(),
            selectedFontSize === size,
            titleTarget,
          ))}
        </ToolbarMenu>
        <ToolbarMenu
          disabled={!editable}
          label={`Line Length: ${selectedLineLengthName}`}
        >
          {LINE_LENGTH_OPTIONS.map((option) => menuItem(
            option.label,
            () => {
              setLineLength(option.value);
              onChange?.({
                doc: editor.getJSON() as RichTextDocument['doc'],
                lineLength: option.value,
              });
            },
            lineLength === option.value,
          ))}
        </ToolbarMenu>
        <ToolbarMenu disabled={!editable || titleTarget} label="Insert">
          {menuItem('Horizontal Rule', () => {
            editor.chain().focus().setHorizontalRule().run();
          }, undefined, titleTarget, Minus)}
          {menuItem('Table', () => {
            editor.chain().focus().insertTable({
              cols: 3,
              rows: 3,
              withHeaderRow: true,
            }).run();
          }, undefined, titleTarget, Table2)}
          {menuItem('Image', () => {
            const insertAt = editor.state.selection.to;
            onChooseImage?.((assetId) => {
              editor.commands.insertContentAt(insertAt, {
                attrs: { assetId },
                type: 'assetImage',
              });
            });
          }, undefined, titleTarget || !onChooseImage, ImageIcon)}
        </ToolbarMenu>
        <ToolbarMenu
          disabled={!editable && !titleTarget}
          label={`Text Color: ${selectedTextColorName}`}
        >
          <div className={styles.swatchGrid}>
            {TEXT_COLOR_OPTIONS.map((option) => (
              <button
                key={option.label}
                aria-label={`Text color: ${option.label}`}
                aria-pressed={option.value === null
                  ? selectedTextColor === null
                  : option.value.toLowerCase() === selectedTextColor?.toLowerCase()}
                className={styles.swatchButton}
                title={option.label}
                type="button"
                onClick={() => applyTextColor(option.value)}
              >
                <span
                  className={styles.colorSwatch}
                  data-default={option.value === null || undefined}
                  style={option.value ? { backgroundColor: option.value } : undefined}
                />
              </button>
            ))}
          </div>
        </ToolbarMenu>
      </div>
      <div className={styles.document}>
        <EditorContent
          className={styles.content}
          data-line-length={lineLength}
          editor={editor}
          onFocus={onBodyFocus}
        />
      </div>
    </div>
  );
}
