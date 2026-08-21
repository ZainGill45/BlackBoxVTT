import type { Result } from './result';
import type { JsonValue } from './gameSystems';
import type {
  PermissionConfiguration,
  PermissionSubject,
} from './permissions';

export const JOURNAL_ENTRY_TYPE_NOTE = 'core.note' as const;
export const JOURNAL_EDIT_LEASE_MS = 30_000;
export const JOURNAL_EDIT_LEASE_REFRESH_MS = 10_000;
export const JOURNAL_AUTOSAVE_DELAY_MS = 750;
export const MAX_JOURNAL_ENTRIES = 2_048;
export const MAX_NOTE_PAGES = 1_024;
export const MAX_JOURNAL_CLEANUP_ASSETS = 2_048;
export const MAX_JOURNAL_PERMISSION_OVERRIDES = 20;
export const MAX_JOURNAL_TITLE_GRAPHEMES = 128;
export const MAX_JOURNAL_TITLE_INPUT_CODE_UNITS = 1_024;
export const MAX_RICH_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_RICH_TEXT_NODES = 50_000;
export const MAX_RICH_TEXT_DEPTH = 32;

export const JOURNAL_FONT_FAMILIES = [
  'default',
  'inter',
  'lora',
  'cinzel',
  'noto-sans',
  'noto-sans-sc',
  'roboto-mono',
  'unifont',
] as const;

export const JOURNAL_FONT_SIZES = [
  '12px',
  '14px',
  '16px',
  '18px',
  '24px',
  '32px',
] as const;

export const JOURNAL_LINE_LENGTHS = [
  'narrow',
  'compact',
  'standard',
  'comfortable',
  'wide',
  'extra-wide',
  'full',
] as const;

export type JournalFontFamily = (typeof JOURNAL_FONT_FAMILIES)[number];
export type JournalLineLength = (typeof JOURNAL_LINE_LENGTHS)[number];
export type JournalTextAlignment = 'center' | 'default' | 'left' | 'right';

export const DEFAULT_JOURNAL_LINE_LENGTH: JournalLineLength = 'wide';

export interface JournalTitleStyle {
  alignment: JournalTextAlignment;
  bold: boolean;
  color: string | null;
  fontFamily: JournalFontFamily;
  italic: boolean;
  strike: boolean;
  underline: boolean;
}

export const journalIpcChannels = {
  acquireLease: 'journal:acquire-lease',
  changed: 'journal:changed',
  createEntry: 'journal:create-entry',
  createNote: 'journal:create-note',
  createPage: 'journal:create-page',
  deleteEntry: 'journal:delete-entry',
  deleteNote: 'journal:delete-note',
  deletePage: 'journal:delete-page',
  detachAsset: 'journal:detach-asset',
  findAssetDependents: 'journal:find-asset-dependents',
  getEntry: 'journal:get-entry',
  getNote: 'journal:get-note',
  getPage: 'journal:get-page',
  list: 'journal:list',
  listUsers: 'journal:list-users',
  moveEntry: 'journal:move-entry',
  moveNote: 'journal:move-note',
  movePage: 'journal:move-page',
  prepareContent: 'journal:prepare-content',
  preparationProgress: 'journal:preparation-progress',
  prepareDelete: 'journal:prepare-delete',
  releaseLease: 'journal:release-lease',
  renameEntry: 'journal:rename-entry',
  reorderEntries: 'journal:reorder-entries',
  reorderNotes: 'journal:reorder-notes',
  reorderPages: 'journal:reorder-pages',
  renewLease: 'journal:renew-lease',
  updateEntryData: 'journal:update-entry-data',
  updateEntryPermissions: 'journal:update-entry-permissions',
  updateNote: 'journal:update-note',
  updateNotePermissions: 'journal:update-note-permissions',
  updatePage: 'journal:update-page',
  updatePagePermissions: 'journal:update-page-permissions',
} as const;

export type JournalAccessLevel = 'edit' | 'none' | 'view';
export type JournalPageAccessLevel = JournalAccessLevel | 'inherit';


export interface RichTextMark {
  attrs?: Record<string, JsonValue>;
  type: string;
}

export interface RichTextNode {
  attrs?: Record<string, JsonValue>;
  content?: RichTextNode[];
  marks?: RichTextMark[];
  text?: string;
  type: string;
}

export interface RichTextDocument {
  doc: RichTextNode;
  lineLength?: JournalLineLength;
}

export interface JournalEntryCapabilities {
  delete: boolean;
  edit: boolean;
  managePages: boolean;
  managePermissions: boolean;
  reorder: boolean;
  view: boolean;
}

export interface JournalPageCapabilities {
  delete: boolean;
  edit: boolean;
  managePermissions: boolean;
  reorder: boolean;
  view: boolean;
}

export interface JournalPageSummary {
  capabilities: JournalPageCapabilities;
  id: string;
  permissionRevision: number;
  permissions: PermissionConfiguration<JournalPageAccessLevel> | null;
  position: number;
  revision: number;
  title: string;
  titleStyle: JournalTitleStyle;
}

export interface JournalEntryBaseSummary {
  capabilities: JournalEntryCapabilities;
  groupId: string;
  id: string;
  kind: 'note' | 'system';
  name: string;
  permissionRevision: number;
  permissions: PermissionConfiguration<JournalAccessLevel> | null;
  position: number;
  revision: number;
  typeId: string;
}

export interface NoteEntry extends JournalEntryBaseSummary {
  kind: 'note';
  nameStyle: JournalTitleStyle;
  pages: JournalPageSummary[];
  typeId: typeof JOURNAL_ENTRY_TYPE_NOTE;
}

export interface SystemJournalEntrySummary extends JournalEntryBaseSummary {
  detail: string | null;
  kind: 'system';
}

export type JournalEntrySummary = NoteEntry | SystemJournalEntrySummary;

export interface SystemJournalEntry extends SystemJournalEntrySummary {
  data: JsonValue;
}

export type JournalEntry = NoteEntry | SystemJournalEntry;

export interface JournalManifest {
  entries: JournalEntrySummary[];
  revision: number;
}

/** All readable Journal bodies at one actor-filtered campaign snapshot. */
export interface JournalContentSnapshot {
  entries: SystemJournalEntry[];
  pages: JournalPage[];
}

export interface JournalPreparationProgress {
  campaignId: string;
  completedItems: number;
  currentName: string;
  totalItems: number;
}

export interface JournalPage extends JournalPageSummary {
  content: RichTextDocument;
  entryId: string;
}

export interface JournalAssetDependent {
  entryId: string;
  pageId: string;
  title: string;
}

export interface JournalAssetInput extends JournalCampaignInput {
  assetId: string;
}

export interface PageEditLease {
  expiresAt: string;
  holderName: string;
  leaseId: string;
  page: JournalPage;
}

export type JournalErrorCode =
  | 'conflict'
  | 'invalid_input'
  | 'locked'
  | 'not_found'
  | 'permission_denied'
  | 'storage_error'
  | 'unavailable';

export interface JournalError {
  code: JournalErrorCode;
  entryId?: string;
  holderName?: string;
  message: string;
  pageId?: string;
}

export type JournalResult<T> = Result<T, JournalError>;

export interface JournalCampaignInput {
  campaignId: string;
}

export interface JournalEntryInput extends JournalCampaignInput {
  entryId: string;
}

export interface CreateJournalEntryInput extends JournalCampaignInput {
  typeId: string;
}

export interface JournalPageInput extends JournalEntryInput {
  pageId: string;
}

export interface CreateJournalPageInput extends JournalEntryInput {
  expectedEntryRevision: number;
}

export interface UpdateJournalNoteInput extends JournalEntryInput {
  expectedRevision: number;
  name: string;
  nameStyle: JournalTitleStyle;
}

export interface RenameJournalEntryInput extends JournalEntryInput {
  expectedRevision: number;
  name: string;
}

export interface UpdateJournalEntryDataInput extends JournalEntryInput {
  data: JsonValue;
  expectedRevision: number;
}

export interface UpdateJournalPageInput extends JournalPageInput {
  content: RichTextDocument;
  expectedRevision: number;
  leaseId: string;
  title: string;
  titleStyle: JournalTitleStyle;
}

export interface UpdateJournalNotePermissionsInput extends JournalEntryInput {
  expectedPermissionRevision: number;
  permissions: PermissionConfiguration<JournalAccessLevel>;
}

export type UpdateJournalEntryPermissionsInput = UpdateJournalNotePermissionsInput;

export interface UpdateJournalPagePermissionsInput extends JournalPageInput {
  expectedPermissionRevision: number;
  permissions: PermissionConfiguration<JournalPageAccessLevel>;
}

export interface MoveJournalEntryInput extends JournalEntryInput {
  direction: 'down' | 'up';
  expectedManifestRevision: number;
}

export interface MoveJournalPageInput extends JournalPageInput {
  direction: 'down' | 'up';
  expectedEntryRevision: number;
}

export interface ReorderJournalEntriesInput extends JournalCampaignInput {
  expectedManifestRevision: number;
  orderedEntryIds: string[];
}

export interface ReorderJournalGroupInput extends ReorderJournalEntriesInput {
  groupId: string;
}

export interface ReorderJournalPagesInput extends JournalEntryInput {
  expectedEntryRevision: number;
  orderedPageIds: string[];
}

export interface JournalLeaseInput extends JournalPageInput {
  leaseId: string;
}

export type JournalDeleteTarget =
  | { entryId: string; kind: 'entry' }
  | { entryId: string; kind: 'note' }
  | { entryId: string; kind: 'page'; pageId: string };

export interface PrepareJournalDeleteInput extends JournalCampaignInput {
  target: JournalDeleteTarget;
}

export interface JournalDeleteAsset {
  cleanupAllowed: boolean;
  displayName: string;
  id: string;
  reason?: string;
}

export interface JournalDeletePreview {
  assets: JournalDeleteAsset[];
  target: JournalDeleteTarget;
}

export interface DeleteJournalTargetInput extends JournalCampaignInput {
  cleanupAssetIds: string[];
  expectedRevision: number;
  target: JournalDeleteTarget;
}

export interface JournalDeleteResult {
  cleanupFailures: string[];
}

export interface JournalChangedEvent {
  campaignId: string;
  entryId?: string;
  pageId?: string;
  type: 'content' | 'deleted' | 'permissions' | 'structure';
}

export interface JournalApi {
  acquireLease(input: JournalPageInput): Promise<JournalResult<PageEditLease>>;
  createEntry(input: CreateJournalEntryInput): Promise<JournalResult<JournalEntry>>;
  createNote(input: JournalCampaignInput): Promise<JournalResult<NoteEntry>>;
  createPage(input: CreateJournalPageInput): Promise<JournalResult<JournalPage>>;
  deleteTarget(input: DeleteJournalTargetInput): Promise<JournalResult<JournalDeleteResult>>;
  detachAsset(input: JournalAssetInput): Promise<JournalResult<null>>;
  findAssetDependents(input: JournalAssetInput): Promise<JournalResult<JournalAssetDependent[]>>;
  getEntry(input: JournalEntryInput): Promise<JournalResult<JournalEntry>>;
  getNote(input: JournalEntryInput): Promise<JournalResult<NoteEntry>>;
  getPage(input: JournalPageInput): Promise<JournalResult<JournalPage>>;
  list(input: JournalCampaignInput): Promise<JournalResult<JournalManifest>>;
  listUsers(input: JournalCampaignInput): Promise<JournalResult<PermissionSubject[]>>;
  moveEntry(input: MoveJournalEntryInput): Promise<JournalResult<JournalManifest>>;
  moveNote(input: MoveJournalEntryInput): Promise<JournalResult<JournalManifest>>;
  movePage(input: MoveJournalPageInput): Promise<JournalResult<NoteEntry>>;
  onChanged(listener: (event: JournalChangedEvent) => void): () => void;
  onPreparationProgress(
    listener: (event: JournalPreparationProgress) => void,
  ): () => void;
  prepareContent(
    input: JournalCampaignInput,
  ): Promise<JournalResult<JournalContentSnapshot>>;
  prepareDelete(input: PrepareJournalDeleteInput): Promise<JournalResult<JournalDeletePreview>>;
  releaseLease(input: JournalLeaseInput): Promise<JournalResult<null>>;
  renameEntry(input: RenameJournalEntryInput): Promise<JournalResult<JournalEntry>>;
  reorderEntries(input: ReorderJournalGroupInput): Promise<JournalResult<JournalManifest>>;
  reorderNotes(input: ReorderJournalEntriesInput): Promise<JournalResult<JournalManifest>>;
  reorderPages(input: ReorderJournalPagesInput): Promise<JournalResult<NoteEntry>>;
  renewLease(input: JournalLeaseInput): Promise<JournalResult<PageEditLease>>;
  updateEntryData(input: UpdateJournalEntryDataInput): Promise<JournalResult<JournalEntry>>;
  updateEntryPermissions(input: UpdateJournalEntryPermissionsInput): Promise<JournalResult<JournalEntry>>;
  updateNote(input: UpdateJournalNoteInput): Promise<JournalResult<NoteEntry>>;
  updateNotePermissions(input: UpdateJournalNotePermissionsInput): Promise<JournalResult<NoteEntry>>;
  updatePage(input: UpdateJournalPageInput): Promise<JournalResult<JournalPage>>;
  updatePagePermissions(input: UpdateJournalPagePermissionsInput): Promise<JournalResult<JournalPage>>;
}

const NODE_TYPES = new Set([
  'assetImage',
  'blockquote',
  'bulletList',
  'codeBlock',
  'doc',
  'hardBreak',
  'heading',
  'horizontalRule',
  'listItem',
  'orderedList',
  'paragraph',
  'table',
  'tableCell',
  'tableHeader',
  'tableRow',
  'text',
]);
const MARK_TYPES = new Set([
  'bold',
  'code',
  'highlight',
  'italic',
  'link',
  'strike',
  'textStyle',
  'underline',
]);
const RICH_TEXT_DOCUMENT_KEYS = new Set(['doc', 'lineLength']);
const RICH_TEXT_NODE_KEYS = new Set(['attrs', 'content', 'marks', 'text', 'type']);
const RICH_TEXT_MARK_KEYS = new Set(['attrs', 'type']);
const MAX_RICH_TEXT_ATTRIBUTE_DEPTH = 8;
const MAX_RICH_TEXT_ATTRIBUTE_ENTRIES = 256;
const MAX_RICH_TEXT_MARKS_PER_NODE = 64;

export function emptyRichTextDocument(): RichTextDocument {
  return {
    doc: { content: [{ type: 'paragraph' }], type: 'doc' },
    lineLength: DEFAULT_JOURNAL_LINE_LENGTH,
  };
}

export function defaultJournalTitleStyle(): JournalTitleStyle {
  return {
    alignment: 'default',
    bold: true,
    color: null,
    fontFamily: 'default',
    italic: false,
    strike: false,
    underline: false,
  };
}

export function isJournalTitleStyle(value: unknown): value is JournalTitleStyle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<JournalTitleStyle>;
  return (
    ['center', 'default', 'left', 'right'].includes(String(candidate.alignment)) &&
    typeof candidate.bold === 'boolean' &&
    (candidate.color === null ||
      (typeof candidate.color === 'string' && /^#[0-9a-f]{6}$/iu.test(candidate.color))) &&
    JOURNAL_FONT_FAMILIES.includes(candidate.fontFamily as JournalFontFamily) &&
    typeof candidate.italic === 'boolean' &&
    typeof candidate.strike === 'boolean' &&
    typeof candidate.underline === 'boolean' &&
    Object.keys(candidate).length === 7
  );
}

export function normalizeJournalTitle(value: string): string {
  return value.normalize('NFKC').trim();
}

export function countGraphemes(value: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length;
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (
    value === null ||
    typeof value === 'boolean'
  ) return true;
  if (typeof value === 'string') return value.length <= MAX_RICH_TEXT_BYTES;
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth >= MAX_RICH_TEXT_ATTRIBUTE_DEPTH) return false;
  if (Array.isArray(value)) {
    return value.length <= MAX_RICH_TEXT_ATTRIBUTE_ENTRIES &&
      value.every((item) => isJsonValue(item, depth + 1));
  }
  return Boolean(
    value &&
      typeof value === 'object' &&
      Object.keys(value).length <= MAX_RICH_TEXT_ATTRIBUTE_ENTRIES &&
      Object.entries(value).every(
        ([key, item]) => key.length <= 128 && isJsonValue(item, depth + 1),
      ),
  );
}

function validAttributes(value: unknown): value is Record<string, JsonValue> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length <= MAX_RICH_TEXT_ATTRIBUTE_ENTRIES &&
      Object.values(value).every((item) => isJsonValue(item)),
  );
}

function safeLink(href: unknown): boolean {
  return typeof href === 'string' && /^(https?:|mailto:)/iu.test(href);
}

function validMarkAttributes(
  type: string,
  attrs: Record<string, JsonValue> | undefined,
): boolean {
  if (type === 'link') return safeLink(attrs?.href);
  if (type !== 'textStyle') return true;
  return attrs?.fontSize == null ||
    JOURNAL_FONT_SIZES.includes(attrs.fontSize as typeof JOURNAL_FONT_SIZES[number]);
}

function validNodeAttributes(type: string, attrs: Record<string, JsonValue> | undefined): boolean {
  if (type !== 'assetImage') return true;
  if (!attrs) return false;
  return (
    typeof attrs.assetId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(attrs.assetId) &&
    (attrs.alt === undefined || (typeof attrs.alt === 'string' && countGraphemes(attrs.alt) <= 256)) &&
    (attrs.caption === undefined || (typeof attrs.caption === 'string' && countGraphemes(attrs.caption) <= 256)) &&
    (attrs.width === undefined || (typeof attrs.width === 'number' && attrs.width >= 10 && attrs.width <= 100)) &&
    (attrs.alignment === undefined || ['left', 'center', 'right'].includes(String(attrs.alignment)))
  );
}

export function isRichTextDocument(value: unknown): value is RichTextDocument {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RichTextDocument>;
  if (
    (candidate.lineLength !== undefined &&
      !JOURNAL_LINE_LENGTHS.includes(candidate.lineLength)) ||
    !Object.keys(candidate).every((key) => RICH_TEXT_DOCUMENT_KEYS.has(key))
  ) return false;
  let count = 0;
  const visit = (node: unknown, depth: number): node is RichTextNode => {
    count += 1;
    if (
      count > MAX_RICH_TEXT_NODES ||
      depth > MAX_RICH_TEXT_DEPTH ||
      !node ||
      typeof node !== 'object'
    ) return false;
    const item = node as Partial<RichTextNode>;
    if (
      !Object.keys(item).every((key) => RICH_TEXT_NODE_KEYS.has(key)) ||
      typeof item.type !== 'string' ||
      !NODE_TYPES.has(item.type)
    ) return false;
    if (item.attrs !== undefined && !validAttributes(item.attrs)) return false;
    if (!validNodeAttributes(item.type, item.attrs)) return false;
    if (item.text !== undefined && (item.type !== 'text' || typeof item.text !== 'string')) return false;
    if (
      item.marks !== undefined &&
      (!Array.isArray(item.marks) ||
        item.marks.length > MAX_RICH_TEXT_MARKS_PER_NODE ||
        item.marks.some(
          (mark) =>
            !mark ||
            typeof mark !== 'object' ||
            !Object.keys(mark).every((key) => RICH_TEXT_MARK_KEYS.has(key)) ||
            typeof mark.type !== 'string' ||
            !MARK_TYPES.has(mark.type) ||
            (mark.attrs !== undefined && !validAttributes(mark.attrs)) ||
            !validMarkAttributes(mark.type, mark.attrs),
        ))
    ) return false;
    return item.content === undefined ||
      (Array.isArray(item.content) && item.content.every((child) => visit(child, depth + 1)));
  };
  try {
    return (
      visit(candidate.doc, 0) &&
      candidate.doc?.type === 'doc' &&
      new TextEncoder().encode(JSON.stringify(candidate)).byteLength <= MAX_RICH_TEXT_BYTES
    );
  } catch {
    return false;
  }
}

export function extractJournalAssetIds(content: RichTextDocument): string[] {
  const ids = new Set<string>();
  const visit = (node: RichTextNode) => {
    if (node.type === 'assetImage' && typeof node.attrs?.assetId === 'string') {
      ids.add(node.attrs.assetId);
    }
    node.content?.forEach(visit);
  };
  visit(content.doc);
  return [...ids];
}

export function removeJournalAsset(
  content: RichTextDocument,
  assetId: string,
): RichTextDocument {
  const filter = (node: RichTextNode): RichTextNode | null => {
    if (node.type === 'assetImage' && node.attrs?.assetId === assetId) return null;
    return {
      ...node,
      content: node.content?.flatMap((child) => {
        const next = filter(child);
        return next ? [next] : [];
      }),
    };
  };
  return {
    ...content,
    doc: filter(content.doc) ?? emptyRichTextDocument().doc,
  };
}
