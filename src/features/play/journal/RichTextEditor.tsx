import {
  Node,
  mergeAttributes,
  type Editor,
  type JSONContent,
  type NodeViewProps,
} from '@tiptap/core';
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
import {
  Dropdown,
  DropdownOption,
  type DropdownMode,
} from '../../../components/ui/Dropdown';
import { Button } from '../../../components/ui/Button';
import { InlineInput } from '../../../components/ui/InlineInput';
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

/*
 * Fifteen entries so the palette fills the dropdown as three even rows of five
 * with no ragged tail. Ordered neutral, then warm, then cool, so a row reads as
 * a group; inserting a colour means keeping that sweep intact.
 */
const TEXT_COLOR_OPTIONS = [
  { label: 'Default', value: null },
  { label: 'White', value: '#f0f0f0' },
  { label: 'Gray', value: '#b8b8b8' },
  { label: 'Slate', value: '#8f9ab0' },
  { label: 'Red', value: '#d76f6f' },
  { label: 'Orange', value: '#d9965b' },
  { label: 'Brown', value: '#a8795d' },
  { label: 'Yellow', value: '#d6c865' },
  { label: 'Green', value: '#6fbd73' },
  { label: 'Teal', value: '#5fbba4' },
  { label: 'Cyan', value: '#67b7c7' },
  { label: 'Blue', value: '#6f91d7' },
  { label: 'Purple', value: '#9a7bd1' },
  { label: 'Magenta', value: '#c079c7' },
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
  mode?: DropdownMode;
}

function ToolbarMenu({
  children,
  disabled = false,
  label,
  mode = 'single',
}: ToolbarMenuProps) {
  return (
    <Dropdown
      className={styles.menuControl}
      disabled={disabled}
      label={label}
      mode={mode}
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

/** The only protocols a Journal link may target, in markup and on click. */
const LINK_PROTOCOL_PATTERN = /^(https?:|mailto:)/iu;
const BARE_HOST_PATTERN = /^(www\.|[\w-]+(?:\.[\w-]+)+)/iu;

function normalizeJournalHref(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (LINK_PROTOCOL_PATTERN.test(trimmed)) return trimmed;
  if (BARE_HOST_PATTERN.test(trimmed)) {
    const href = `https://${trimmed}`;
    return LINK_PROTOCOL_PATTERN.test(href) ? href : null;
  }
  return null;
}

function linkHrefFromEvent(event: Event): string | null {
  const node = event.target;
  const element = node instanceof Element
    ? node
    : node instanceof Text
      ? node.parentElement
      : null;
  const href = element?.closest('a')?.getAttribute('href');
  return href && LINK_PROTOCOL_PATTERN.test(href) ? href : null;
}

function linkHrefAtPointer(editor: Editor, event: MouseEvent): string | null {
  const fromDom = linkHrefFromEvent(event);
  if (fromDom) return fromDom;
  try {
    const position = editor.view.posAtCoords({
      left: event.clientX,
      top: event.clientY,
    });
    if (!position) return null;
    const href = editor.state.doc.resolve(position.pos).marks().find(
      (mark) => mark.type.name === 'link',
    )?.attrs.href;
    return typeof href === 'string' && LINK_PROTOCOL_PATTERN.test(href)
      ? href
      : null;
  } catch {
    return null;
  }
}

interface RichTextEditorProps {
  /**
   * True while Alt is held. Electron spends Alt on the native menu on Windows,
   * so the modifier can be missing from the click that follows and the main
   * process has to report it instead.
   */
  altHeld?: () => boolean;
  assetApi: JournalAssetApi;
  campaignId: string;
  content: RichTextDocument;
  documentKey: string;
  editable: boolean;
  onBodyFocus?: () => void;
  onBlur?: () => void;
  onChange?: (content: RichTextDocument) => void;
  onChooseImage?: (insert: (assetId: string) => void) => void;
  onOpenLink?: (url: string) => void;
  titleFormatting?: {
    onChange: (style: JournalTitleStyle) => void;
    style: JournalTitleStyle;
  } | null;
}

export function RichTextEditor({
  altHeld,
  assetApi,
  campaignId,
  content,
  documentKey,
  editable,
  onBodyFocus,
  onBlur,
  onChange,
  onChooseImage,
  onOpenLink,
  titleFormatting = null,
}: RichTextEditorProps) {
  const onBlurRef = useRef(onBlur);
  const onOpenLinkRef = useRef(onOpenLink);
  const onChangeRef = useRef(onChange);
  const reportedAltHeldRef = useRef(altHeld);
  const altHeldRef = useRef(false);
  const editorRootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef(content);
  const [lineLength, setLineLength] = useState<JournalLineLength>(
    content.lineLength ?? DEFAULT_JOURNAL_LINE_LENGTH,
  );
  const lineLengthRef = useRef(lineLength);
  const [linkDraft, setLinkDraft] = useState<{
    from: number;
    href: string;
    to: number;
  } | null>(null);
  const previewCache = useMemo(
    () => new JournalImagePreviewCache(assetApi, campaignId),
    [assetApi, campaignId],
  );
  useEffect(() => {
    onBlurRef.current = onBlur;
    onOpenLinkRef.current = onOpenLink;
    onChangeRef.current = onChange;
    reportedAltHeldRef.current = altHeld;
    contentRef.current = content;
    lineLengthRef.current = lineLength;
  }, [altHeld, content, lineLength, onBlur, onChange, onOpenLink]);
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
      StarterKit.configure({
        link: {
          HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
          openOnClick: false,
          protocols: ['http', 'https', 'mailto'],
        },
      }),
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

  useEffect(() => {
    if (!editor) return undefined;
    let lastFollowAt = 0;
    let lastFollowHref = '';
    const applyAltHeld = (down: boolean) => {
      if (altHeldRef.current === down) return;
      altHeldRef.current = down;
      const root = editorRootRef.current;
      if (!root) return;
      if (down) root.dataset.altHeld = 'true';
      else delete root.dataset.altHeld;
    };
    /*
     * AltGr is reported as Ctrl+Alt on Windows and types characters, so a
     * right-hand Alt combined with Ctrl is never a request to follow a link.
     */
    const altFromEvent = (event: KeyboardEvent | MouseEvent) =>
      event.getModifierState('Alt') && !event.getModifierState('Control');
    /*
     * The event's own modifier state is the live answer; the reported flag only
     * covers the Windows case where the menu swallows the key event before the
     * renderer sees it. Notably absent is altHeldRef, so that a pointer moving
     * with Alt up always clears a keyup this window missed.
     */
    const altIsDown = (event: KeyboardEvent | MouseEvent) =>
      altFromEvent(event) || Boolean(reportedAltHeldRef.current?.());
    const setAlt = (event: KeyboardEvent) => {
      if (event.key === 'Alt' || event.code === 'AltLeft' || event.code === 'AltRight') {
        applyAltHeld(event.type === 'keydown' && !event.getModifierState('Control'));
        return;
      }
      applyAltHeld(altIsDown(event));
    };
    const clearAlt = () => {
      applyAltHeld(false);
    };
    const intercept = (event: MouseEvent) => {
      if (event.button || editor.isDestroyed) return;
      const node = event.target;
      const element = node instanceof Element
        ? node
        : node instanceof Text
          ? node.parentElement
          : null;
      if (!element || !editor.view.dom.contains(element)) return;
      /*
       * Ownership of the click is decided before anything is cancelled: while
       * editing, an unmodified click still belongs to ProseMirror so the caret
       * can land inside the link text.
       */
      if (editor.isEditable && !(altIsDown(event) || altHeldRef.current)) return;
      const href = linkHrefAtPointer(editor, event);
      if (!href) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type !== 'pointerdown' && event.type !== 'mousedown') return;
      const now = Date.now();
      if (href === lastFollowHref && now - lastFollowAt < 400) return;
      lastFollowHref = href;
      lastFollowAt = now;
      onOpenLinkRef.current?.(href);
    };
    const mouseEvents = ['pointerdown', 'mousedown', 'click'] as const;
    const syncAltFromPointer = (event: MouseEvent) => {
      applyAltHeld(altIsDown(event));
    };
    window.addEventListener('keydown', setAlt, true);
    window.addEventListener('keyup', setAlt, true);
    window.addEventListener('mousemove', syncAltFromPointer, true);
    window.addEventListener('blur', clearAlt);
    for (const type of mouseEvents) {
      window.addEventListener(type, intercept, true);
    }
    return () => {
      window.removeEventListener('keydown', setAlt, true);
      window.removeEventListener('keyup', setAlt, true);
      window.removeEventListener('mousemove', syncAltFromPointer, true);
      window.removeEventListener('blur', clearAlt);
      for (const type of mouseEvents) {
        window.removeEventListener(type, intercept, true);
      }
    };
  }, [editor]);

  const linkBarOpen = linkDraft !== null;
  useEffect(() => {
    if (!linkBarOpen) return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('journal-link-url')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [linkBarOpen]);

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
  const linkCandidate = linkDraft?.href.trim() ?? '';
  const normalizedHref = normalizeJournalHref(linkCandidate);
  const linkValid = normalizedHref !== null;
  const applyLink = () => {
    if (!linkDraft || normalizedHref === null) return;
    editor.chain().focus().setTextSelection({
      from: linkDraft.from,
      to: linkDraft.to,
    }).run();
    if (normalizedHref === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else if (linkDraft.from === linkDraft.to) {
      editor.chain().focus().insertContent({
        marks: [{ attrs: { href: normalizedHref }, type: 'link' }],
        text: normalizedHref,
        type: 'text',
      }).run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({
        href: normalizedHref,
      }).run();
    }
    setLinkDraft(null);
  };
  return (
    <div
      ref={editorRootRef}
      className={styles.editor}
      data-editable={editable}
      data-link-bar={linkDraft ? 'true' : undefined}
      data-toolbar="true"
    >
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
            setLinkDraft({
              from: editor.state.selection.from,
              href: String(editor.getAttributes('link').href ?? ''),
              to: editor.state.selection.to,
            });
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
        <ToolbarMenu disabled={!editable || titleTarget} label="Insert" mode="action">
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
              <Button
                aria-label={`Text color: ${option.label}`}
                aria-selected={option.value === null
                  ? selectedTextColor === null
                  : option.value.toLowerCase() === selectedTextColor?.toLowerCase()}
                className={styles.swatchButton}
                data-dropdown-option
                key={option.label}
                role="option"
                tabIndex={-1}
                title={option.label}
                variant="ghost"
                onClick={() => applyTextColor(option.value)}
              >
                <span
                  className={styles.colorSwatch}
                  data-color-swatch=""
                  data-default={option.value === null || undefined}
                  style={option.value ? { backgroundColor: option.value } : undefined}
                />
                <span className="sr-only">{option.label}</span>
              </Button>
            ))}
          </div>
        </ToolbarMenu>
      </div>
      {linkDraft !== null ? (
        <div className={styles.linkBar}>
          <InlineInput
            aria-label="Link URL"
            className={styles.linkInput}
            id="journal-link-url"
            onChange={(event) => setLinkDraft((current) =>
              current
                ? { ...current, href: event.target.value }
                : current
            )}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setLinkDraft(null);
                return;
              }
              if (event.key !== 'Enter') return;
              event.preventDefault();
              applyLink();
            }}
            placeholder="https://example.com"
            surface="underline"
            value={linkDraft.href}
          />
          <span className={styles.linkHint}>http, https, or mailto</span>
          <Button
            disabled={!linkValid}
            onClick={applyLink}
            size="compact"
            variant="secondary"
          >
            {linkCandidate === '' ? 'Remove' : 'Apply'}
          </Button>
          <Button onClick={() => setLinkDraft(null)} size="compact" variant="text">
            Cancel
          </Button>
        </div>
      ) : null}
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
