import type { Result } from './result';
import type { JsonValue } from './gameSystems';

export const JOURNAL_SCHEMA_VERSION = 2 as const;
export const RICH_TEXT_SCHEMA_VERSION = 1 as const;
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

export type JournalFontFamily = (typeof JOURNAL_FONT_FAMILIES)[number];
export type JournalTextAlignment = 'center' | 'default' | 'left' | 'right';

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
  createNote: 'journal:create-note',
  createPage: 'journal:create-page',
  deleteNote: 'journal:delete-note',
  deletePage: 'journal:delete-page',
  detachAsset: 'journal:detach-asset',
  findAssetDependents: 'journal:find-asset-dependents',
  getNote: 'journal:get-note',
  getPage: 'journal:get-page',
  list: 'journal:list',
  listUsers: 'journal:list-users',
  moveNote: 'journal:move-note',
  movePage: 'journal:move-page',
  prepareDelete: 'journal:prepare-delete',
  releaseLease: 'journal:release-lease',
  reorderNotes: 'journal:reorder-notes',
  reorderPages: 'journal:reorder-pages',
  renewLease: 'journal:renew-lease',
  updateNote: 'journal:update-note',
  updateNotePermissions: 'journal:update-note-permissions',
  updatePage: 'journal:update-page',
  updatePagePermissions: 'journal:update-page-permissions',
} as const;

export type JournalAccessLevel = 'edit' | 'none' | 'view';
export type JournalPageAccessLevel = JournalAccessLevel | 'inherit';

export interface JournalPermissionOverride<TAccess extends string> {
  access: TAccess;
  userId: string;
}

export interface JournalPermissionConfiguration<TAccess extends string> {
  allPlayers: TAccess;
  overrides: JournalPermissionOverride<TAccess>[];
}

export interface RichTextMarkV1 {
  attrs?: Record<string, JsonValue>;
  type: string;
}

export interface RichTextNodeV1 {
  attrs?: Record<string, JsonValue>;
  content?: RichTextNodeV1[];
  marks?: RichTextMarkV1[];
  text?: string;
  type: string;
}

export interface RichTextDocumentV1 {
  doc: RichTextNodeV1;
  schemaVersion: typeof RICH_TEXT_SCHEMA_VERSION;
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
  permissions: JournalPermissionConfiguration<JournalPageAccessLevel> | null;
  position: number;
  revision: number;
  title: string;
  titleStyle: JournalTitleStyle;
}

export interface JournalEntrySummary {
  capabilities: JournalEntryCapabilities;
  id: string;
  name: string;
  nameStyle: JournalTitleStyle;
  pages: JournalPageSummary[];
  permissions: JournalPermissionConfiguration<JournalAccessLevel> | null;
  position: number;
  revision: number;
  typeId: typeof JOURNAL_ENTRY_TYPE_NOTE;
}

export interface JournalManifest {
  entries: JournalEntrySummary[];
  revision: number;
  schemaVersion: typeof JOURNAL_SCHEMA_VERSION;
}

export type NoteEntry = JournalEntrySummary;

export interface JournalPage extends JournalPageSummary {
  content: RichTextDocumentV1;
  entryId: string;
}

export interface JournalPermissionSubject {
  id: string;
  username: string;
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

export interface UpdateJournalPageInput extends JournalPageInput {
  content: RichTextDocumentV1;
  expectedRevision: number;
  leaseId: string;
  title: string;
  titleStyle: JournalTitleStyle;
}

export interface UpdateJournalNotePermissionsInput extends JournalEntryInput {
  expectedRevision: number;
  permissions: JournalPermissionConfiguration<JournalAccessLevel>;
}

export interface UpdateJournalPagePermissionsInput extends JournalPageInput {
  expectedPermissionRevision: number;
  permissions: JournalPermissionConfiguration<JournalPageAccessLevel>;
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

export interface ReorderJournalPagesInput extends JournalEntryInput {
  expectedEntryRevision: number;
  orderedPageIds: string[];
}

export interface JournalLeaseInput extends JournalPageInput {
  leaseId: string;
}

export type JournalDeleteTarget =
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
  createNote(input: JournalCampaignInput): Promise<JournalResult<NoteEntry>>;
  createPage(input: CreateJournalPageInput): Promise<JournalResult<JournalPage>>;
  deleteTarget(input: DeleteJournalTargetInput): Promise<JournalResult<JournalDeleteResult>>;
  detachAsset(input: JournalAssetInput): Promise<JournalResult<null>>;
  findAssetDependents(input: JournalAssetInput): Promise<JournalResult<JournalAssetDependent[]>>;
  getNote(input: JournalEntryInput): Promise<JournalResult<NoteEntry>>;
  getPage(input: JournalPageInput): Promise<JournalResult<JournalPage>>;
  list(input: JournalCampaignInput): Promise<JournalResult<JournalManifest>>;
  listUsers(input: JournalCampaignInput): Promise<JournalResult<JournalPermissionSubject[]>>;
  moveNote(input: MoveJournalEntryInput): Promise<JournalResult<JournalManifest>>;
  movePage(input: MoveJournalPageInput): Promise<JournalResult<NoteEntry>>;
  onChanged(listener: (event: JournalChangedEvent) => void): () => void;
  prepareDelete(input: PrepareJournalDeleteInput): Promise<JournalResult<JournalDeletePreview>>;
  releaseLease(input: JournalLeaseInput): Promise<JournalResult<null>>;
  reorderNotes(input: ReorderJournalEntriesInput): Promise<JournalResult<JournalManifest>>;
  reorderPages(input: ReorderJournalPagesInput): Promise<JournalResult<NoteEntry>>;
  renewLease(input: JournalLeaseInput): Promise<JournalResult<PageEditLease>>;
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
const RICH_TEXT_DOCUMENT_KEYS = new Set(['doc', 'schemaVersion']);
const RICH_TEXT_NODE_KEYS = new Set(['attrs', 'content', 'marks', 'text', 'type']);
const RICH_TEXT_MARK_KEYS = new Set(['attrs', 'type']);
const MAX_RICH_TEXT_ATTRIBUTE_DEPTH = 8;
const MAX_RICH_TEXT_ATTRIBUTE_ENTRIES = 256;
const MAX_RICH_TEXT_MARKS_PER_NODE = 64;

export function emptyRichTextDocument(): RichTextDocumentV1 {
  return {
    doc: { content: [{ type: 'paragraph' }], type: 'doc' },
    schemaVersion: RICH_TEXT_SCHEMA_VERSION,
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

export function isRichTextDocument(value: unknown): value is RichTextDocumentV1 {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RichTextDocumentV1>;
  if (
    candidate.schemaVersion !== RICH_TEXT_SCHEMA_VERSION ||
    !Object.keys(candidate).every((key) => RICH_TEXT_DOCUMENT_KEYS.has(key))
  ) return false;
  let count = 0;
  const visit = (node: unknown, depth: number): node is RichTextNodeV1 => {
    count += 1;
    if (
      count > MAX_RICH_TEXT_NODES ||
      depth > MAX_RICH_TEXT_DEPTH ||
      !node ||
      typeof node !== 'object'
    ) return false;
    const item = node as Partial<RichTextNodeV1>;
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
            (mark.type === 'link' && !safeLink(mark.attrs?.href)),
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

export function extractJournalAssetIds(content: RichTextDocumentV1): string[] {
  const ids = new Set<string>();
  const visit = (node: RichTextNodeV1) => {
    if (node.type === 'assetImage' && typeof node.attrs?.assetId === 'string') {
      ids.add(node.attrs.assetId);
    }
    node.content?.forEach(visit);
  };
  visit(content.doc);
  return [...ids];
}

export function removeJournalAsset(
  content: RichTextDocumentV1,
  assetId: string,
): RichTextDocumentV1 {
  const filter = (node: RichTextNodeV1): RichTextNodeV1 | null => {
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
    doc: filter(content.doc) ?? emptyRichTextDocument().doc,
    schemaVersion: RICH_TEXT_SCHEMA_VERSION,
  };
}
