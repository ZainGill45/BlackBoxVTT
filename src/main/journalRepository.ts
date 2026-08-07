import { randomUUID } from 'node:crypto';
import type { AssetRepository } from './assetRepository';
import type { SceneRepository } from './sceneRepository';
import type { CampaignDatabase } from './storage/campaignDatabase';
import { MutationQueue } from './storage/mutationQueue';
import type { CampaignSystemState, JsonValue } from '../shared/gameSystems';
import {
  CORE_NOTE_GROUP_ID,
  createDefaultJournalEntryData,
  getJournalEntryTypeDefinition,
  parseJournalEntryData,
} from '../systems/catalog';
import {
  JOURNAL_EDIT_LEASE_MS,
  JOURNAL_ENTRY_TYPE_NOTE,
  MAX_JOURNAL_ENTRIES,
  MAX_JOURNAL_TITLE_GRAPHEMES,
  MAX_NOTE_PAGES,
  countGraphemes,
  defaultJournalTitleStyle,
  emptyRichTextDocument,
  extractJournalAssetIds,
  isJournalTitleStyle,
  isRichTextDocument,
  normalizeJournalTitle,
  removeJournalAsset,
  type DeleteJournalTargetInput,
  type JournalEntry,
  type JournalAccessLevel,
  type JournalDeleteAsset,
  type JournalDeletePreview,
  type JournalDeleteResult,
  type JournalEntrySummary,
  type JournalErrorCode,
  type JournalManifest,
  type JournalPage,
  type JournalPageAccessLevel,
  type JournalPageSummary,
  type JournalPermissionConfiguration,
  type JournalPermissionSubject,
  type JournalResult,
  type JournalTitleStyle,
  type MoveJournalEntryInput,
  type MoveJournalPageInput,
  type NoteEntry,
  type PageEditLease,
  type ReorderJournalEntriesInput,
  type ReorderJournalGroupInput,
  type ReorderJournalPagesInput,
  type RichTextDocument,
  type UpdateJournalEntryDataInput,
  type UpdateJournalNotePermissionsInput,
  type UpdateJournalPagePermissionsInput,
} from '../shared/journal';

export type JournalActor =
  | { kind: 'gm' }
  | { kind: 'player'; userId: string; username: string };

interface JournalRepositoryOptions {
  assets: AssetRepository;
  createId?: () => string;
  database: CampaignDatabase;
  now?: () => Date;
  scenes: SceneRepository;
  system?: CampaignSystemState;
  touchCampaign: () => Promise<void>;
}

interface EntryRow {
  created_at: string;
  created_by: string;
  default_access: JournalAccessLevel;
  data_json: string;
  id: string;
  name: string;
  name_style_json: string;
  position: number;
  revision: number;
  type_id: string;
  updated_at: string;
  updated_by: string;
}

interface PageSummaryRow {
  created_at: string;
  created_by: string;
  default_access: JournalPageAccessLevel;
  entry_id: string;
  id: string;
  permission_revision: number;
  position: number;
  revision: number;
  title: string;
  title_style_json: string;
  updated_at: string;
  updated_by: string;
}

interface PageRow extends PageSummaryRow {
  content_json: string;
}

interface PermissionRow<TAccess extends string> {
  access: TAccess;
  user_id: string;
}

interface ActiveLease {
  actorKey: string;
  expiresAt: number;
  holderName: string;
  leaseId: string;
}

function failure<T>(
  code: JournalErrorCode,
  message: string,
  ids: { entryId?: string; holderName?: string; pageId?: string } = {},
): JournalResult<T> {
  return { error: { code, message, ...ids }, ok: false };
}

function actorKey(actor: JournalActor): string {
  return actor.kind === 'gm' ? 'gm' : `player:${actor.userId}`;
}

function actorName(actor: JournalActor): string {
  return actor.kind === 'gm' ? 'Game Master' : actor.username;
}

function accessAllowsView(access: JournalAccessLevel): boolean {
  return access === 'view' || access === 'edit';
}

function validTitle(value: string): boolean {
  return (
    value.length > 0 &&
    countGraphemes(value) >= 1 &&
    countGraphemes(value) <= MAX_JOURNAL_TITLE_GRAPHEMES
  );
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export class JournalRepository {
  private readonly assets: AssetRepository;
  private readonly createId: () => string;
  private readonly database: CampaignDatabase;
  private readonly leases = new Map<string, ActiveLease>();
  private readonly mutations = new MutationQueue();
  private readonly now: () => Date;
  private readonly scenes: SceneRepository;
  private readonly system: CampaignSystemState;
  private readonly touchCampaign: () => Promise<void>;

  constructor({
    assets,
    createId = randomUUID,
    database,
    now = () => new Date(),
    scenes,
    system,
    touchCampaign,
  }: JournalRepositoryOptions) {
    this.assets = assets;
    this.createId = createId;
    this.database = database;
    this.now = now;
    this.scenes = scenes;
    this.system = structuredClone(system ?? database.readSystem());
    this.touchCampaign = touchCampaign;
  }

  async list(actor: JournalActor): Promise<JournalResult<JournalManifest>> {
    try {
      return { ok: true, value: this.projectManifest(actor) };
    } catch {
      return failure('storage_error', 'The Journal could not be loaded.');
    }
  }

  async getNote(
    actor: JournalActor,
    entryId: string,
  ): Promise<JournalResult<NoteEntry>> {
    const result = await this.getEntry(actor, entryId);
    if (!result.ok) return result;
    return result.value.kind === 'note'
      ? { ok: true, value: result.value }
      : failure('not_found', 'The note no longer exists.', { entryId });
  }

  async getEntry(
    actor: JournalActor,
    entryId: string,
  ): Promise<JournalResult<JournalEntry>> {
    try {
      const entry = this.entry(entryId);
      if (!entry) return failure('not_found', 'The Journal entry no longer exists.', { entryId });
      const projected = this.projectEntry(actor, entry);
      if (!projected) {
        return failure('permission_denied', 'You cannot view this Journal entry.', { entryId });
      }
      if (projected.kind === 'note') return { ok: true, value: projected };
      return { ok: true, value: { ...projected, data: this.entryData(entry) } };
    } catch {
      return failure('storage_error', 'The Journal entry could not be loaded.', { entryId });
    }
  }

  async getPage(
    actor: JournalActor,
    entryId: string,
    pageId: string,
  ): Promise<JournalResult<JournalPage>> {
    try {
      const row = this.page(pageId);
      if (!row || row.entry_id !== entryId) {
        return failure('not_found', 'The page no longer exists.', { entryId, pageId });
      }
      const entry = this.entry(entryId);
      if (!entry) return failure('not_found', 'The note no longer exists.', { entryId });
      const projected = this.projectPages(actor, entry).find(({ id }) => id === pageId);
      return projected
        ? { ok: true, value: { ...projected, content: this.content(row), entryId } }
        : failure('permission_denied', 'You cannot view this page.', { entryId, pageId });
    } catch {
      return failure('storage_error', 'The page could not be loaded.', { entryId, pageId });
    }
  }

  async listUsers(
    actor: JournalActor,
  ): Promise<JournalResult<JournalPermissionSubject[]>> {
    if (actor.kind !== 'gm') {
      return failure('permission_denied', 'Only the Game Master can manage permissions.');
    }
    try {
      const users = this.database.connection
        .prepare('SELECT id, username FROM campaign_users ORDER BY username_key, id')
        .all() as unknown as Array<{ id: string; username: string }>;
      return { ok: true, value: users };
    } catch {
      return failure('storage_error', 'Campaign users could not be loaded.');
    }
  }

  createNote(actor: JournalActor): Promise<JournalResult<NoteEntry>> {
    return this.createEntry(actor, JOURNAL_ENTRY_TYPE_NOTE).then((result) => {
      if (!result.ok) return result;
      return result.value.kind === 'note'
        ? { ok: true, value: result.value }
        : failure('storage_error', 'The note could not be created.');
    });
  }

  createEntry(actor: JournalActor, typeId: string): Promise<JournalResult<JournalEntry>> {
    if (actor.kind !== 'gm') {
      return Promise.resolve(failure('permission_denied', 'Only the Game Master can create Journal entries.'));
    }
    return this.mutations.run(async () => {
      try {
        const definition = getJournalEntryTypeDefinition(this.system, typeId);
        const defaultData = createDefaultJournalEntryData(this.system, typeId);
        if (!definition || !defaultData) {
          return failure('invalid_input', 'This Journal entry type is not available for the campaign system.');
        }
        const entries = this.entries();
        if (entries.length >= MAX_JOURNAL_ENTRIES) {
          return failure('invalid_input', 'This campaign has reached its Journal entry limit.');
        }
        const entryId = this.createId();
        const timestamp = this.now().toISOString();
        const titleStyleJson = JSON.stringify(defaultJournalTitleStyle());
        this.transaction(() => {
          this.database.connection.prepare(
            `INSERT INTO journal_entries (
               id, type_id, position, name, name_style_json, default_access, revision,
               created_at, created_by, updated_at, updated_by, data_json
             ) VALUES (?, ?, ?, ?, ?, 'none', 0, ?, 'gm', ?, 'gm', ?)`,
          ).run(
            entryId,
            typeId,
            entries.length,
            definition.defaultName,
            titleStyleJson,
            timestamp,
            timestamp,
            JSON.stringify(defaultData.data),
          );
          if (typeId === JOURNAL_ENTRY_TYPE_NOTE) {
            const pageId = this.createId();
            this.database.connection.prepare(
              `INSERT INTO journal_pages (
                 id, entry_id, position, title, title_style_json, default_access,
                 content_json, revision, permission_revision,
                 created_at, created_by, updated_at, updated_by
               ) VALUES (?, ?, 0, 'New Page', ?, 'inherit', ?, 0, 0, ?, 'gm', ?, 'gm')`,
            ).run(
              pageId,
              entryId,
              titleStyleJson,
              JSON.stringify(emptyRichTextDocument()),
              timestamp,
              timestamp,
            );
          }
          this.bumpManifest();
        });
        await this.touchCampaign();
        return this.getEntry(actor, entryId);
      } catch {
        return failure('storage_error', 'The Journal entry could not be created.');
      }
    });
  }

  updateNote(
    actor: JournalActor,
    entryId: string,
    nameInput: string,
    nameStyle: JournalTitleStyle,
    expectedRevision: number,
  ): Promise<JournalResult<NoteEntry>> {
    return this.mutations.run(async () => {
      const name = normalizeJournalTitle(nameInput);
      if (!validTitle(name) || !isJournalTitleStyle(nameStyle)) {
        return failure('invalid_input', 'Note names must contain 1 to 128 characters.', { entryId });
      }
      try {
        const entry = this.entry(entryId);
        if (!entry) return failure('not_found', 'The note no longer exists.', { entryId });
        if (entry.type_id !== JOURNAL_ENTRY_TYPE_NOTE) {
          return failure('not_found', 'The note no longer exists.', { entryId });
        }
        const projected = this.projectEntry(actor, entry);
        if (!projected?.capabilities.edit) {
          return failure('permission_denied', 'You cannot rename this note.', { entryId });
        }
        if (entry.revision !== expectedRevision) {
          return failure('conflict', 'The note changed before it could be renamed.', { entryId });
        }
        const nameStyleJson = JSON.stringify(nameStyle);
        if (entry.name !== name || entry.name_style_json !== nameStyleJson) {
          const timestamp = this.now().toISOString();
          this.transaction(() => {
            this.database.connection.prepare(
              `UPDATE journal_entries
               SET name = ?, name_style_json = ?, revision = revision + 1, updated_at = ?, updated_by = ?
               WHERE id = ?`,
            ).run(name, nameStyleJson, timestamp, actorKey(actor), entryId);
            this.bumpManifest();
          });
          await this.touchCampaign();
        }
        return this.getNote(actor, entryId);
      } catch {
        return failure('storage_error', 'The note could not be renamed.', { entryId });
      }
    });
  }

  renameEntry(
    actor: JournalActor,
    entryId: string,
    nameInput: string,
    expectedRevision: number,
  ): Promise<JournalResult<JournalEntry>> {
    return this.mutations.run(async () => {
      const name = normalizeJournalTitle(nameInput);
      if (!validTitle(name)) {
        return failure('invalid_input', 'Journal entry names must contain 1 to 128 characters.', { entryId });
      }
      try {
        const entry = this.entry(entryId);
        if (!entry) return failure('not_found', 'The Journal entry no longer exists.', { entryId });
        const projected = this.projectEntry(actor, entry);
        if (!projected?.capabilities.edit) {
          return failure('permission_denied', 'You cannot rename this Journal entry.', { entryId });
        }
        if (entry.revision !== expectedRevision) {
          return failure('conflict', 'The Journal entry changed before it could be renamed.', { entryId });
        }
        if (entry.name !== name) {
          const timestamp = this.now().toISOString();
          this.transaction(() => {
            this.database.connection.prepare(
              `UPDATE journal_entries
               SET name = ?, revision = revision + 1, updated_at = ?, updated_by = ?
               WHERE id = ?`,
            ).run(name, timestamp, actorKey(actor), entryId);
            this.bumpManifest();
          });
          await this.touchCampaign();
        }
        return this.getEntry(actor, entryId);
      } catch {
        return failure('storage_error', 'The Journal entry could not be renamed.', { entryId });
      }
    });
  }

  updateEntryData(
    actor: JournalActor,
    input: Omit<UpdateJournalEntryDataInput, 'campaignId'>,
  ): Promise<JournalResult<JournalEntry>> {
    return this.mutations.run(async () => {
      try {
        const entry = this.entry(input.entryId);
        if (!entry || entry.type_id === JOURNAL_ENTRY_TYPE_NOTE) {
          return failure('not_found', 'The system Journal entry no longer exists.', {
            entryId: input.entryId,
          });
        }
        const projected = this.projectEntry(actor, entry);
        if (!projected?.capabilities.edit) {
          return failure('permission_denied', 'You cannot edit this Journal entry.', {
            entryId: input.entryId,
          });
        }
        if (entry.revision !== input.expectedRevision) {
          return failure('conflict', 'The Journal entry changed before it could be saved.', {
            entryId: input.entryId,
          });
        }
        const definition = getJournalEntryTypeDefinition(this.system, entry.type_id);
        if (!definition || !definition.validateData(input.data)) {
          return failure('invalid_input', 'The Journal entry data is invalid.', {
            entryId: input.entryId,
          });
        }
        const dataJson = JSON.stringify(input.data);
        const timestamp = this.now().toISOString();
        this.transaction(() => {
          this.database.connection.prepare(
            `UPDATE journal_entries
             SET data_json = ?,
                  revision = revision + 1, updated_at = ?, updated_by = ?
             WHERE id = ?`,
          ).run(
            dataJson,
            timestamp,
            actorKey(actor),
            input.entryId,
          );
          this.bumpManifest();
        });
        await this.touchCampaign();
        return this.getEntry(actor, input.entryId);
      } catch {
        return failure('storage_error', 'The Journal entry data could not be saved.', {
          entryId: input.entryId,
        });
      }
    });
  }

  updateNotePermissions(
    actor: JournalActor,
    input: Omit<UpdateJournalNotePermissionsInput, 'campaignId'>,
  ): Promise<JournalResult<NoteEntry>> {
    if (actor.kind !== 'gm') {
      return Promise.resolve(failure('permission_denied', 'Only the Game Master can manage permissions.'));
    }
    return this.mutations.run(async () => {
      try {
        const entry = this.entry(input.entryId);
        if (!entry) return failure('not_found', 'The note no longer exists.', { entryId: input.entryId });
        if (entry.type_id !== JOURNAL_ENTRY_TYPE_NOTE) {
          return failure('not_found', 'The note no longer exists.', { entryId: input.entryId });
        }
        if (entry.revision !== input.expectedRevision) {
          return failure('conflict', 'The note changed before permissions could be saved.', { entryId: input.entryId });
        }
        if (!this.validPermissionConfiguration(input.permissions, ['none', 'view', 'edit'])) {
          return failure('invalid_input', 'The note permissions are invalid.', { entryId: input.entryId });
        }
        const timestamp = this.now().toISOString();
        this.transaction(() => {
          this.database.connection.prepare(
            `UPDATE journal_entries
             SET default_access = ?, revision = revision + 1,
                 updated_at = ?, updated_by = 'gm'
             WHERE id = ?`,
          ).run(input.permissions.allPlayers, timestamp, input.entryId);
          this.replaceEntryOverrides(input.entryId, input.permissions);
          this.bumpManifest();
        });
        this.revokeUnauthorizedLeases(input.entryId);
        await this.touchCampaign();
        return this.getNote(actor, input.entryId);
      } catch {
        return failure('storage_error', 'The note permissions could not be saved.', { entryId: input.entryId });
      }
    });
  }

  updateEntryPermissions(
    actor: JournalActor,
    input: Omit<UpdateJournalNotePermissionsInput, 'campaignId'>,
  ): Promise<JournalResult<JournalEntry>> {
    if (actor.kind !== 'gm') {
      return Promise.resolve(failure('permission_denied', 'Only the Game Master can manage permissions.'));
    }
    return this.mutations.run(async () => {
      try {
        const entry = this.entry(input.entryId);
        if (!entry) return failure('not_found', 'The Journal entry no longer exists.', { entryId: input.entryId });
        if (entry.revision !== input.expectedRevision) {
          return failure('conflict', 'The Journal entry changed before permissions could be saved.', { entryId: input.entryId });
        }
        if (!this.validPermissionConfiguration(input.permissions, ['none', 'view', 'edit'])) {
          return failure('invalid_input', 'The Journal entry permissions are invalid.', { entryId: input.entryId });
        }
        const timestamp = this.now().toISOString();
        this.transaction(() => {
          this.database.connection.prepare(
            `UPDATE journal_entries
             SET default_access = ?, revision = revision + 1,
                 updated_at = ?, updated_by = 'gm'
             WHERE id = ?`,
          ).run(input.permissions.allPlayers, timestamp, input.entryId);
          this.replaceEntryOverrides(input.entryId, input.permissions);
          this.bumpManifest();
        });
        if (entry.type_id === JOURNAL_ENTRY_TYPE_NOTE) this.revokeUnauthorizedLeases(input.entryId);
        await this.touchCampaign();
        return this.getEntry(actor, input.entryId);
      } catch {
        return failure('storage_error', 'The Journal entry permissions could not be saved.', { entryId: input.entryId });
      }
    });
  }

  createPage(
    actor: JournalActor,
    entryId: string,
    expectedEntryRevision: number,
  ): Promise<JournalResult<JournalPage>> {
    return this.mutations.run(async () => {
      try {
        const entry = this.entry(entryId);
        if (!entry) return failure('not_found', 'The note no longer exists.', { entryId });
        const projected = this.projectEntry(actor, entry);
        if (!projected?.capabilities.managePages) {
          return failure('permission_denied', 'You cannot add pages to this note.', { entryId });
        }
        if (entry.revision !== expectedEntryRevision) {
          return failure('conflict', 'The note changed before the page could be added.', { entryId });
        }
        const pages = this.pages(entryId);
        if (pages.length >= MAX_NOTE_PAGES) {
          return failure('invalid_input', 'This note has reached its page limit.', { entryId });
        }
        const pageId = this.createId();
        const timestamp = this.now().toISOString();
        const key = actorKey(actor);
        this.transaction(() => {
          this.database.connection.prepare(
            `INSERT INTO journal_pages (
               id, entry_id, position, title, title_style_json, default_access,
               content_json, revision, permission_revision,
               created_at, created_by, updated_at, updated_by
             ) VALUES (?, ?, ?, 'New Page', ?, 'inherit', ?, 0, 0, ?, ?, ?, ?)`,
          ).run(
            pageId,
            entryId,
            pages.length,
            JSON.stringify(defaultJournalTitleStyle()),
            JSON.stringify(emptyRichTextDocument()),
            timestamp,
            key,
            timestamp,
            key,
          );
          this.bumpEntry(entryId, key, timestamp);
          this.bumpManifest();
        });
        await this.touchCampaign();
        return this.getPage(actor, entryId, pageId);
      } catch {
        return failure('storage_error', 'The page could not be created.', { entryId });
      }
    });
  }

  acquireLease(
    actor: JournalActor,
    entryId: string,
    pageId: string,
  ): Promise<JournalResult<PageEditLease>> {
    return this.mutations.run(async () => {
      try {
        const page = await this.getPage(actor, entryId, pageId);
        if (!page.ok) return page;
        if (!page.value.capabilities.edit) {
          return failure('permission_denied', 'You cannot edit this page.', { entryId, pageId });
        }
        this.removeExpiredLease(pageId);
        const current = this.leases.get(pageId);
        const key = actorKey(actor);
        if (current) {
          return failure('locked', `${current.holderName} is editing this page.`, {
            entryId,
            holderName: current.holderName,
            pageId,
          });
        }
        const lease: ActiveLease = {
          actorKey: key,
          expiresAt: this.now().getTime() + JOURNAL_EDIT_LEASE_MS,
          holderName: actorName(actor),
          leaseId: this.createId(),
        };
        this.leases.set(pageId, lease);
        return { ok: true, value: this.toLease(lease, page.value) };
      } catch {
        return failure('storage_error', 'The page edit lease could not be acquired.', { entryId, pageId });
      }
    });
  }

  renewLease(
    actor: JournalActor,
    entryId: string,
    pageId: string,
    leaseId: string,
  ): Promise<JournalResult<PageEditLease>> {
    return this.mutations.run(async () => {
      this.removeExpiredLease(pageId);
      const lease = this.leases.get(pageId);
      if (!lease || lease.leaseId !== leaseId || lease.actorKey !== actorKey(actor)) {
        return failure('locked', 'The page edit lease is no longer active.', { entryId, pageId });
      }
      const page = await this.getPage(actor, entryId, pageId);
      if (!page.ok || !page.value.capabilities.edit) {
        this.leases.delete(pageId);
        return page.ok
          ? failure('permission_denied', 'You can no longer edit this page.', { entryId, pageId })
          : page;
      }
      lease.expiresAt = this.now().getTime() + JOURNAL_EDIT_LEASE_MS;
      return { ok: true, value: this.toLease(lease, page.value) };
    });
  }

  releaseLease(
    actor: JournalActor,
    pageId: string,
    leaseId: string,
  ): Promise<JournalResult<null>> {
    return this.mutations.run(async () => {
      const lease = this.leases.get(pageId);
      if (lease && lease.leaseId === leaseId && lease.actorKey === actorKey(actor)) {
        this.leases.delete(pageId);
      }
      return { ok: true, value: null };
    });
  }

  releaseActorLeases(actor: JournalActor): void {
    const key = actorKey(actor);
    for (const [pageId, lease] of this.leases) {
      if (lease.actorKey === key) this.leases.delete(pageId);
    }
  }

  updatePage(
    actor: JournalActor,
    entryId: string,
    pageId: string,
    leaseId: string,
    titleInput: string,
    titleStyle: JournalTitleStyle,
    content: RichTextDocument,
    expectedRevision: number,
  ): Promise<JournalResult<JournalPage>> {
    return this.mutations.run(async () => {
      const title = normalizeJournalTitle(titleInput);
      if (!validTitle(title) || !isJournalTitleStyle(titleStyle) || !isRichTextDocument(content)) {
        return failure('invalid_input', 'The page title or content is invalid.', { entryId, pageId });
      }
      try {
        this.removeExpiredLease(pageId);
        const lease = this.leases.get(pageId);
        if (!lease || lease.leaseId !== leaseId || lease.actorKey !== actorKey(actor)) {
          return failure('locked', 'The page edit lease is no longer active.', { entryId, pageId });
        }
        const row = this.page(pageId);
        const entry = this.entry(entryId);
        if (!row || row.entry_id !== entryId || !entry) {
          return failure('not_found', 'The page no longer exists.', { entryId, pageId });
        }
        const projected = this.projectPages(actor, entry).find(({ id }) => id === pageId);
        if (!projected?.capabilities.edit) {
          this.leases.delete(pageId);
          return failure('permission_denied', 'You can no longer edit this page.', { entryId, pageId });
        }
        if (row.revision !== expectedRevision) {
          return failure('conflict', 'The page changed before it could be saved.', { entryId, pageId });
        }
        if (!this.assetsExist(extractJournalAssetIds(content))) {
          return failure('invalid_input', 'The page references a missing campaign asset.', { entryId, pageId });
        }
        const titleStyleJson = JSON.stringify(titleStyle);
        const titleChanged = row.title !== title || row.title_style_json !== titleStyleJson;
        const timestamp = this.now().toISOString();
        const key = actorKey(actor);
        this.transaction(() => {
          this.database.connection.prepare(
            `UPDATE journal_pages
             SET title = ?, title_style_json = ?, content_json = ?,
                 revision = revision + 1, updated_at = ?, updated_by = ?
             WHERE id = ?`,
          ).run(
            title,
            titleStyleJson,
            JSON.stringify(content),
            timestamp,
            key,
            pageId,
          );
          this.replacePageAssets(pageId, extractJournalAssetIds(content));
          if (titleChanged) {
            this.bumpEntry(entryId, key, timestamp);
            this.bumpManifest();
          }
        });
        lease.expiresAt = this.now().getTime() + JOURNAL_EDIT_LEASE_MS;
        await this.touchCampaign();
        return this.getPage(actor, entryId, pageId);
      } catch {
        return failure('storage_error', 'The page could not be saved.', { entryId, pageId });
      }
    });
  }

  updatePagePermissions(
    actor: JournalActor,
    input: Omit<UpdateJournalPagePermissionsInput, 'campaignId'>,
  ): Promise<JournalResult<JournalPage>> {
    if (actor.kind !== 'gm') {
      return Promise.resolve(failure('permission_denied', 'Only the Game Master can manage permissions.'));
    }
    return this.mutations.run(async () => {
      try {
        const row = this.page(input.pageId);
        if (!row || row.entry_id !== input.entryId) {
          return failure('not_found', 'The page no longer exists.', {
            entryId: input.entryId,
            pageId: input.pageId,
          });
        }
        if (row.permission_revision !== input.expectedPermissionRevision) {
          return failure('conflict', 'The page changed before permissions could be saved.', {
            entryId: input.entryId,
            pageId: input.pageId,
          });
        }
        if (!this.validPermissionConfiguration(input.permissions, ['inherit', 'none', 'view', 'edit'])) {
          return failure('invalid_input', 'The page permissions are invalid.', {
            entryId: input.entryId,
            pageId: input.pageId,
          });
        }
        const timestamp = this.now().toISOString();
        this.transaction(() => {
          this.database.connection.prepare(
            `UPDATE journal_pages
             SET default_access = ?, permission_revision = permission_revision + 1,
                 updated_at = ?, updated_by = 'gm'
             WHERE id = ?`,
          ).run(input.permissions.allPlayers, timestamp, input.pageId);
          this.replacePageOverrides(input.pageId, input.permissions);
          this.bumpEntry(input.entryId, 'gm', timestamp);
          this.bumpManifest();
        });
        this.revokeUnauthorizedLease(input.pageId);
        await this.touchCampaign();
        return this.getPage(actor, input.entryId, input.pageId);
      } catch {
        return failure('storage_error', 'The page permissions could not be saved.', {
          entryId: input.entryId,
          pageId: input.pageId,
        });
      }
    });
  }

  moveNote(
    actor: JournalActor,
    input: Omit<MoveJournalEntryInput, 'campaignId'>,
  ): Promise<JournalResult<JournalManifest>> {
    return this.moveEntry(actor, input);
  }

  moveEntry(
    actor: JournalActor,
    input: Omit<MoveJournalEntryInput, 'campaignId'>,
  ): Promise<JournalResult<JournalManifest>> {
    if (actor.kind !== 'gm') {
      return Promise.resolve(failure('permission_denied', 'Only the Game Master can reorder Journal entries.'));
    }
    return this.mutations.run(async () => {
      try {
        const revision = this.manifestRevision();
        if (revision !== input.expectedManifestRevision) {
          return failure('conflict', 'The Journal order changed before it could be saved.');
        }
        const rows = this.entries();
        const entry = rows.find(({ id }) => id === input.entryId);
        if (!entry) return failure('not_found', 'The Journal entry no longer exists.', { entryId: input.entryId });
        const groupId = this.entryGroupId(entry);
        const groupIds = rows.filter((row) => this.entryGroupId(row) === groupId).map(({ id }) => id);
        const index = groupIds.indexOf(input.entryId);
        const target = input.direction === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= groupIds.length) return { ok: true, value: this.projectManifest(actor) };
        [groupIds[index], groupIds[target]] = [groupIds[target]!, groupIds[index]!];
        this.commitEntryGroupOrder(rows, groupId, groupIds);
        await this.touchCampaign();
        return { ok: true, value: this.projectManifest(actor) };
      } catch {
        return failure('storage_error', 'The Journal entry order could not be saved.');
      }
    });
  }

  reorderNotes(
    actor: JournalActor,
    input: Omit<ReorderJournalEntriesInput, 'campaignId'>,
  ): Promise<JournalResult<JournalManifest>> {
    return this.reorderEntries(actor, { ...input, groupId: CORE_NOTE_GROUP_ID });
  }

  reorderEntries(
    actor: JournalActor,
    input: Omit<ReorderJournalGroupInput, 'campaignId'>,
  ): Promise<JournalResult<JournalManifest>> {
    if (actor.kind !== 'gm') {
      return Promise.resolve(failure('permission_denied', 'Only the Game Master can reorder Journal entries.'));
    }
    return this.mutations.run(async () => {
      try {
        if (this.manifestRevision() !== input.expectedManifestRevision) {
          return failure('conflict', 'The Journal order changed before it could be saved.');
        }
        const rows = this.entries();
        if (!rows.some((row) => this.entryGroupId(row) === input.groupId)) {
          return failure('invalid_input', 'The requested Journal group is invalid.');
        }
        const current = rows
          .filter((row) => this.entryGroupId(row) === input.groupId)
          .map(({ id }) => id);
        if (!this.sameIdSet(current, input.orderedEntryIds)) {
          return failure('invalid_input', 'The requested Journal entry order is invalid.');
        }
        if (!sameIds(current, input.orderedEntryIds)) {
          this.commitEntryGroupOrder(rows, input.groupId, input.orderedEntryIds);
          await this.touchCampaign();
        }
        return { ok: true, value: this.projectManifest(actor) };
      } catch {
        return failure('storage_error', 'The Journal entry order could not be saved.');
      }
    });
  }

  movePage(
    actor: JournalActor,
    input: Omit<MoveJournalPageInput, 'campaignId'>,
  ): Promise<JournalResult<NoteEntry>> {
    return this.mutations.run(async () => {
      try {
        const entry = this.entry(input.entryId);
        if (!entry) return failure('not_found', 'The note no longer exists.', { entryId: input.entryId });
        if (entry.revision !== input.expectedEntryRevision) {
          return failure('conflict', 'The note changed before its pages could be reordered.', { entryId: input.entryId });
        }
        const eligible = this.reorderablePageIds(actor, entry);
        const index = eligible.indexOf(input.pageId);
        if (index < 0) return failure('permission_denied', 'You cannot reorder this page.', input);
        const target = input.direction === 'up' ? index - 1 : index + 1;
        if (target >= 0 && target < eligible.length) {
          [eligible[index], eligible[target]] = [eligible[target]!, eligible[index]!];
          this.commitPageOrder(entry.id, eligible, actor);
          await this.touchCampaign();
        }
        return this.getNote(actor, entry.id);
      } catch {
        return failure('storage_error', 'The page order could not be saved.', { entryId: input.entryId });
      }
    });
  }

  reorderPages(
    actor: JournalActor,
    input: Omit<ReorderJournalPagesInput, 'campaignId'>,
  ): Promise<JournalResult<NoteEntry>> {
    return this.mutations.run(async () => {
      try {
        const entry = this.entry(input.entryId);
        if (!entry) return failure('not_found', 'The note no longer exists.', { entryId: input.entryId });
        if (entry.revision !== input.expectedEntryRevision) {
          return failure('conflict', 'The note changed before its pages could be reordered.', { entryId: input.entryId });
        }
        const eligible = this.reorderablePageIds(actor, entry);
        if (!this.sameIdSet(eligible, input.orderedPageIds)) {
          return failure('invalid_input', 'The requested page order is invalid.', { entryId: input.entryId });
        }
        if (!sameIds(eligible, input.orderedPageIds)) {
          this.commitPageOrder(entry.id, input.orderedPageIds, actor);
          await this.touchCampaign();
        }
        return this.getNote(actor, entry.id);
      } catch {
        return failure('storage_error', 'The page order could not be saved.', { entryId: input.entryId });
      }
    });
  }

  async prepareDelete(
    actor: JournalActor,
    target: DeleteJournalTargetInput['target'],
  ): Promise<JournalResult<JournalDeletePreview>> {
    try {
      const authorization = this.authorizeDelete(actor, target);
      if (!authorization.ok) return authorization;
      const assetIds = this.targetAssetIds(target);
      const assets = await this.describeDeleteAssets(actor, target, assetIds);
      return { ok: true, value: { assets, target } };
    } catch {
      return failure('storage_error', 'The delete dependencies could not be checked.');
    }
  }

  deleteTarget(
    actor: JournalActor,
    input: Omit<DeleteJournalTargetInput, 'campaignId'>,
  ): Promise<JournalResult<JournalDeleteResult>> {
    return this.mutations.run(async () => {
      try {
        const authorization = this.authorizeDelete(actor, input.target);
        if (!authorization.ok) return authorization;
        if (authorization.value.revision !== input.expectedRevision) {
          return failure('conflict', 'The note or page changed before it could be deleted.');
        }
        const preview = await this.prepareDelete(actor, input.target);
        if (!preview.ok) return preview;
        const allowed = new Set(
          preview.value.assets.filter(({ cleanupAllowed }) => cleanupAllowed).map(({ id }) => id),
        );
        if (input.cleanupAssetIds.some((id) => !allowed.has(id))) {
          return failure('permission_denied', 'One or more selected assets cannot be cleaned up.');
        }
        const entryId = input.target.entryId;
        const pageId = input.target.kind === 'page' ? input.target.pageId : null;
        const deletingPageIds = pageId
          ? [pageId]
          : this.pages(entryId).map(({ id }) => id);
        this.transaction(() => {
          if (pageId) {
            this.database.connection.prepare('DELETE FROM journal_pages WHERE id = ?').run(pageId);
            this.normalizePagePositions(entryId);
            this.bumpEntry(entryId, actorKey(actor), this.now().toISOString());
          } else {
            this.database.connection.prepare('DELETE FROM journal_entries WHERE id = ?').run(entryId);
            this.normalizeEntryPositions();
          }
          this.bumpManifest();
        });
        for (const deletingPageId of deletingPageIds) {
          this.leases.delete(deletingPageId);
        }
        await this.touchCampaign();
        const cleanupFailures: string[] = [];
        const assetManifest = input.cleanupAssetIds.length > 0
          ? await this.assets.readManifest()
          : null;
        for (const assetId of input.cleanupAssetIds) {
          const asset = assetManifest?.assets.find(({ id }) => id === assetId);
          if (!asset) continue;
          const result = await this.assets.trashAsset(asset.id, asset.revision);
          if (!result.ok) cleanupFailures.push(asset.id);
        }
        return { ok: true, value: { cleanupFailures } };
      } catch {
        return failure('storage_error', 'The note or page could not be deleted.');
      }
    });
  }

  async findAssetDependents(
    assetId: string,
    actor?: JournalActor,
  ): Promise<Array<{ entryId: string; pageId: string; title: string }>> {
    const rows = this.database.connection.prepare(
      `SELECT pages.entry_id, pages.id AS page_id, pages.title
       FROM journal_page_assets AS references_
       JOIN journal_pages AS pages ON pages.id = references_.page_id
       WHERE references_.asset_id = ?
       ORDER BY pages.entry_id, pages.position`,
    ).all(assetId) as unknown as Array<{
      entry_id: string;
      page_id: string;
      title: string;
    }>;
    if (!actor) {
      return rows.map(({ entry_id, page_id, title }) => ({
        entryId: entry_id,
        pageId: page_id,
        title,
      }));
    }
    const visibleByEntry = new Map<string, Set<string>>();
    return rows.flatMap(({ entry_id, page_id, title }) => {
      let visible = visibleByEntry.get(entry_id);
      if (!visible) {
        const entry = this.entry(entry_id);
        const projected = entry ? this.projectEntry(actor, entry) : null;
        visible = new Set(projected?.kind === 'note' ? projected.pages.map(({ id }) => id) : []);
        visibleByEntry.set(entry_id, visible);
      }
      return visible.has(page_id)
        ? [{ entryId: entry_id, pageId: page_id, title }]
        : [];
    });
  }

  detachAsset(assetId: string, actor: JournalActor = { kind: 'gm' }): Promise<JournalResult<null>> {
    return this.mutations.run(async () => {
      try {
        if (actor.kind === 'player') {
          const asset = (await this.assets.readManifest()).assets.find(({ id }) => id === assetId);
          if (asset && asset.createdBy !== actor.userId) {
            return failure('permission_denied', 'You cannot remove this image from Journal pages.');
          }
        }
        const dependents = await this.findAssetDependents(assetId);
        if (dependents.some(({ pageId }) => this.activeLease(pageId))) {
          return failure('locked', 'An edited Journal page still uses this asset.');
        }
        if (dependents.length === 0) return { ok: true, value: null };
        const timestamp = this.now().toISOString();
        const key = actorKey(actor);
        this.transaction(() => {
          const touchedEntries = new Set<string>();
          for (const dependent of dependents) {
            const page = this.page(dependent.pageId)!;
            const content = removeJournalAsset(this.content(page), assetId);
            this.database.connection.prepare(
              `UPDATE journal_pages
               SET content_json = ?, revision = revision + 1,
                   updated_at = ?, updated_by = ?
               WHERE id = ?`,
            ).run(JSON.stringify(content), timestamp, key, page.id);
            this.database.connection.prepare(
              'DELETE FROM journal_page_assets WHERE page_id = ? AND asset_id = ?',
            ).run(page.id, assetId);
            touchedEntries.add(page.entry_id);
          }
          for (const entryId of touchedEntries) this.bumpEntry(entryId, key, timestamp);
          this.bumpManifest();
        });
        await this.touchCampaign();
        return { ok: true, value: null };
      } catch {
        return failure('storage_error', 'Journal image references could not be removed.');
      }
    });
  }

  private projectManifest(actor: JournalActor): JournalManifest {
    return {
      entries: this.entries().flatMap((entry) => {
        const projected = this.projectEntry(actor, entry);
        return projected ? [projected] : [];
      }).map((entry, position) => ({ ...entry, position })),
      revision: this.manifestRevision(),
    };
  }

  private projectEntry(actor: JournalActor, entry: EntryRow): JournalEntrySummary | null {
    const definition = getJournalEntryTypeDefinition(this.system, entry.type_id);
    if (!definition) throw new Error(`Unsupported Journal entry type ${entry.type_id}.`);
    this.entryData(entry);
    const access = this.entryAccess(actor, entry);
    const isGm = actor.kind === 'gm';
    const base = {
      capabilities: {
        delete: isGm,
        edit: isGm || access === 'edit',
        managePages: entry.type_id === JOURNAL_ENTRY_TYPE_NOTE && (isGm || access === 'edit'),
        managePermissions: isGm,
        reorder: isGm,
        view: true,
      },
      groupId: definition.groupId,
      id: entry.id,
      name: entry.name,
      permissions: isGm ? this.entryPermissionConfiguration(entry) : null,
      position: entry.position,
      revision: entry.revision,
      typeId: entry.type_id,
    };
    if (entry.type_id === JOURNAL_ENTRY_TYPE_NOTE) {
      const pages = this.projectPages(actor, entry, access);
      if (!accessAllowsView(access) && pages.length === 0) return null;
      return {
        ...base,
        kind: 'note',
        nameStyle: this.titleStyle(entry.name_style_json),
        pages,
        typeId: JOURNAL_ENTRY_TYPE_NOTE,
      };
    }
    if (!accessAllowsView(access)) return null;
    return { ...base, kind: 'system' };
  }

  private projectPage(
    actor: JournalActor,
    page: PageSummaryRow,
    pageCount: number,
    entryAccess: JournalAccessLevel,
    overrideAccess: JournalPageAccessLevel | undefined,
    permissions: JournalPermissionConfiguration<JournalPageAccessLevel> | null,
  ): JournalPageSummary | null {
    const pageAccess = this.pageAccess(actor, page, entryAccess, overrideAccess);
    if (!accessAllowsView(pageAccess)) return null;
    const isGm = actor.kind === 'gm';
    const structure = isGm || entryAccess === 'edit';
    const canEdit = isGm || pageAccess === 'edit';
    return {
      capabilities: {
        delete: structure && canEdit && pageCount > 1,
        edit: canEdit,
        managePermissions: isGm,
        reorder: structure && canEdit,
        view: true,
      },
      id: page.id,
      permissionRevision: page.permission_revision,
      permissions,
      position: page.position,
      revision: page.revision,
      title: page.title,
      titleStyle: this.titleStyle(page.title_style_json),
    };
  }

  private entryAccess(actor: JournalActor, entry: EntryRow): JournalAccessLevel {
    if (actor.kind === 'gm') return 'edit';
    const override = this.database.connection.prepare(
      `SELECT access FROM journal_entry_permissions
       WHERE entry_id = ? AND user_id = ?`,
    ).get(entry.id, actor.userId) as { access?: JournalAccessLevel } | undefined;
    return override?.access ?? entry.default_access;
  }

  private pageAccess(
    actor: JournalActor,
    page: PageSummaryRow,
    entryAccess: JournalAccessLevel,
    overrideAccess?: JournalPageAccessLevel,
  ): JournalAccessLevel {
    if (actor.kind === 'gm') return 'edit';
    const pageAccess = overrideAccess ?? page.default_access;
    return pageAccess === 'inherit' ? entryAccess : pageAccess;
  }

  private entryPermissionConfiguration(
    entry: EntryRow,
  ): JournalPermissionConfiguration<JournalAccessLevel> {
    return {
      allPlayers: entry.default_access,
      overrides: (this.database.connection.prepare(
        `SELECT user_id, access FROM journal_entry_permissions
         WHERE entry_id = ? ORDER BY user_id`,
      ).all(entry.id) as unknown as PermissionRow<JournalAccessLevel>[])
        .map(({ access, user_id }) => ({ access, userId: user_id })),
    };
  }

  private projectPages(
    actor: JournalActor,
    entry: EntryRow,
    entryAccess = this.entryAccess(actor, entry),
  ): JournalPageSummary[] {
    const rows = this.pages(entry.id);
    const permissionRows = actor.kind === 'gm'
      ? this.database.connection.prepare(
          `SELECT permissions.page_id, permissions.user_id, permissions.access
           FROM journal_page_permissions AS permissions
           JOIN journal_pages AS pages ON pages.id = permissions.page_id
           WHERE pages.entry_id = ?
           ORDER BY permissions.page_id, permissions.user_id`,
        ).all(entry.id)
      : this.database.connection.prepare(
          `SELECT permissions.page_id, permissions.user_id, permissions.access
           FROM journal_page_permissions AS permissions
           JOIN journal_pages AS pages ON pages.id = permissions.page_id
           WHERE pages.entry_id = ? AND permissions.user_id = ?
           ORDER BY permissions.page_id`,
        ).all(entry.id, actor.userId);
    const permissionsByPage = new Map<
      string,
      Array<PermissionRow<JournalPageAccessLevel>>
    >();
    for (const permission of permissionRows as unknown as Array<
      PermissionRow<JournalPageAccessLevel> & { page_id: string }
    >) {
      const pagePermissions = permissionsByPage.get(permission.page_id) ?? [];
      pagePermissions.push(permission);
      permissionsByPage.set(permission.page_id, pagePermissions);
    }
    return rows.flatMap((page) => {
      const pagePermissions = permissionsByPage.get(page.id) ?? [];
      const projected = this.projectPage(
        actor,
        page,
        rows.length,
        entryAccess,
        actor.kind === 'player' ? pagePermissions[0]?.access : undefined,
        actor.kind === 'gm'
          ? {
              allPlayers: page.default_access,
              overrides: pagePermissions.map(({ access, user_id }) => ({
                access,
                userId: user_id,
              })),
            }
          : null,
      );
      return projected ? [projected] : [];
    }).map((page, position) => ({ ...page, position }));
  }

  private content(row: PageRow): RichTextDocument {
    const parsed: unknown = JSON.parse(row.content_json);
    if (!isRichTextDocument(parsed)) {
      throw new Error('Journal page content is invalid.');
    }
    return parsed;
  }

  private titleStyle(value: string): JournalTitleStyle {
    const parsed: unknown = JSON.parse(value);
    if (!isJournalTitleStyle(parsed)) {
      throw new Error('Journal title style is invalid.');
    }
    return parsed;
  }

  private entryData(row: EntryRow): JsonValue {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data_json);
    } catch {
      throw new Error('Journal entry data is invalid.');
    }
    const data = parseJournalEntryData(
      this.system,
      row.type_id,
      parsed,
    );
    if (data === null) throw new Error('Journal entry data is invalid.');
    return data;
  }

  private entryGroupId(row: EntryRow): string {
    const definition = getJournalEntryTypeDefinition(this.system, row.type_id);
    if (!definition) throw new Error(`Unsupported Journal entry type ${row.type_id}.`);
    return definition.groupId;
  }

  private entries(): EntryRow[] {
    return this.database.connection.prepare(
       `SELECT id, type_id, position, name, name_style_json, default_access, revision,
               created_at, created_by, updated_at, updated_by, data_json
       FROM journal_entries ORDER BY position`,
    ).all() as unknown as EntryRow[];
  }

  private entry(entryId: string): EntryRow | null {
    return (this.database.connection.prepare(
      `SELECT id, type_id, position, name, name_style_json, default_access, revision,
               created_at, created_by, updated_at, updated_by, data_json
       FROM journal_entries WHERE id = ?`,
    ).get(entryId) as EntryRow | undefined) ?? null;
  }

  private pages(entryId: string): PageSummaryRow[] {
    return this.database.connection.prepare(
      `SELECT id, entry_id, position, title, title_style_json, default_access,
               revision, permission_revision,
              created_at, created_by, updated_at, updated_by
       FROM journal_pages WHERE entry_id = ? ORDER BY position`,
    ).all(entryId) as unknown as PageSummaryRow[];
  }

  private page(pageId: string): PageRow | null {
    return (this.database.connection.prepare(
      `SELECT id, entry_id, position, title, title_style_json, default_access,
               content_json, revision, permission_revision,
              created_at, created_by, updated_at, updated_by
       FROM journal_pages WHERE id = ?`,
    ).get(pageId) as PageRow | undefined) ?? null;
  }

  private manifestRevision(): number {
    const row = this.database.connection.prepare(
      'SELECT revision FROM journal_manifest WHERE singleton = 1',
    ).get() as { revision?: unknown } | undefined;
    if (!row || !Number.isInteger(row.revision) || Number(row.revision) < 0) {
      throw new Error('Journal manifest is invalid.');
    }
    return Number(row.revision);
  }

  private bumpManifest(): void {
    this.database.connection.exec(
      'UPDATE journal_manifest SET revision = revision + 1 WHERE singleton = 1',
    );
  }

  private bumpEntry(entryId: string, by: string, timestamp: string): void {
    this.database.connection.prepare(
      `UPDATE journal_entries
       SET revision = revision + 1, updated_at = ?, updated_by = ?
       WHERE id = ?`,
    ).run(timestamp, by, entryId);
  }

  private transaction(action: () => void): void {
    this.database.connection.exec('BEGIN IMMEDIATE');
    try {
      action();
      this.database.connection.exec('COMMIT');
    } catch (error) {
      this.database.connection.exec('ROLLBACK');
      throw error;
    }
  }

  private validPermissionConfiguration<TAccess extends string>(
    permissions: JournalPermissionConfiguration<TAccess>,
    allowed: readonly string[],
  ): boolean {
    if (!allowed.includes(permissions.allPlayers)) return false;
    const users = new Set(
      (this.database.connection.prepare('SELECT id FROM campaign_users').all() as Array<{ id?: unknown }>)
        .flatMap(({ id }) => typeof id === 'string' ? [id] : []),
    );
    const seen = new Set<string>();
    return permissions.overrides.every(({ access, userId }) => {
      if (!users.has(userId) || seen.has(userId) || !allowed.includes(access)) return false;
      seen.add(userId);
      return true;
    });
  }

  private replaceEntryOverrides(
    entryId: string,
    permissions: JournalPermissionConfiguration<JournalAccessLevel>,
  ): void {
    this.database.connection.prepare(
      'DELETE FROM journal_entry_permissions WHERE entry_id = ?',
    ).run(entryId);
    const insert = this.database.connection.prepare(
      `INSERT INTO journal_entry_permissions (entry_id, user_id, access)
       VALUES (?, ?, ?)`,
    );
    permissions.overrides.forEach(({ access, userId }) => insert.run(entryId, userId, access));
  }

  private replacePageOverrides(
    pageId: string,
    permissions: JournalPermissionConfiguration<JournalPageAccessLevel>,
  ): void {
    this.database.connection.prepare(
      'DELETE FROM journal_page_permissions WHERE page_id = ?',
    ).run(pageId);
    const insert = this.database.connection.prepare(
      `INSERT INTO journal_page_permissions (page_id, user_id, access)
       VALUES (?, ?, ?)`,
    );
    permissions.overrides.forEach(({ access, userId }) => insert.run(pageId, userId, access));
  }

  private replacePageAssets(pageId: string, assetIds: readonly string[]): void {
    this.database.connection.prepare(
      'DELETE FROM journal_page_assets WHERE page_id = ?',
    ).run(pageId);
    const insert = this.database.connection.prepare(
      'INSERT INTO journal_page_assets (page_id, asset_id) VALUES (?, ?)',
    );
    assetIds.forEach((assetId) => insert.run(pageId, assetId));
  }

  private assetsExist(assetIds: string[]): boolean {
    const find = this.database.connection.prepare('SELECT 1 AS found FROM assets WHERE id = ?');
    return assetIds.every((assetId) =>
      (find.get(assetId) as { found?: unknown } | undefined)?.found === 1,
    );
  }

  private removeExpiredLease(pageId: string): void {
    const lease = this.leases.get(pageId);
    if (lease && lease.expiresAt <= this.now().getTime()) this.leases.delete(pageId);
  }

  private activeLease(pageId: string): ActiveLease | null {
    this.removeExpiredLease(pageId);
    return this.leases.get(pageId) ?? null;
  }

  private toLease(lease: ActiveLease, page: JournalPage): PageEditLease {
    return {
      expiresAt: new Date(lease.expiresAt).toISOString(),
      holderName: lease.holderName,
      leaseId: lease.leaseId,
      page,
    };
  }

  private revokeUnauthorizedLeases(entryId: string): void {
    for (const page of this.pages(entryId)) this.revokeUnauthorizedLease(page.id);
  }

  private revokeUnauthorizedLease(pageId: string): void {
    const lease = this.activeLease(pageId);
    if (!lease || lease.actorKey === 'gm') return;
    const userId = lease.actorKey.replace(/^player:/u, '');
    const user = this.database.connection.prepare(
      'SELECT username FROM campaign_users WHERE id = ?',
    ).get(userId) as { username?: unknown } | undefined;
    const page = this.page(pageId);
    const entry = page ? this.entry(page.entry_id) : null;
    if (
      !page ||
      !entry ||
      typeof user?.username !== 'string' ||
      this.projectPages(
        { kind: 'player', userId, username: user.username },
        entry,
      ).find(({ id }) => id === pageId)?.capabilities.edit !== true
    ) this.leases.delete(pageId);
  }

  private sameIdSet(expected: readonly string[], actual: readonly string[]): boolean {
    return expected.length === actual.length &&
      new Set(actual).size === actual.length &&
      expected.every((id) => actual.includes(id));
  }

  private commitEntryOrder(ids: readonly string[]): void {
    const timestamp = this.now().toISOString();
    this.transaction(() => {
      this.database.connection.exec(
        `UPDATE journal_entries SET position = position + ${MAX_JOURNAL_ENTRIES + 1}`,
      );
      const update = this.database.connection.prepare(
        `UPDATE journal_entries
         SET position = ?, revision = revision + 1,
             updated_at = ?, updated_by = 'gm'
         WHERE id = ?`,
      );
      ids.forEach((id, position) => update.run(position, timestamp, id));
      this.bumpManifest();
    });
  }

  private commitEntryGroupOrder(
    rows: readonly EntryRow[],
    groupId: string,
    orderedGroupIds: readonly string[],
  ): void {
    let cursor = 0;
    const ids = rows.map((row) =>
      this.entryGroupId(row) === groupId ? orderedGroupIds[cursor++]! : row.id,
    );
    this.commitEntryOrder(ids);
  }

  private reorderablePageIds(actor: JournalActor, entry: EntryRow): string[] {
    return this.projectPages(actor, entry)
      .filter(({ capabilities }) => capabilities.reorder)
      .map(({ id }) => id);
  }

  private commitPageOrder(
    entryId: string,
    orderedEligibleIds: readonly string[],
    actor: JournalActor,
  ): void {
    const rows = this.pages(entryId);
    const eligible = new Set(orderedEligibleIds);
    let cursor = 0;
    const finalIds = rows.map((row) =>
      eligible.has(row.id) ? orderedEligibleIds[cursor++]! : row.id,
    );
    const timestamp = this.now().toISOString();
    const key = actorKey(actor);
    this.transaction(() => {
      this.database.connection.prepare(
        `UPDATE journal_pages SET position = position + ? WHERE entry_id = ?`,
      ).run(MAX_NOTE_PAGES + 1, entryId);
      const update = this.database.connection.prepare(
        `UPDATE journal_pages
         SET position = ?,
             updated_at = ?, updated_by = ?
         WHERE id = ?`,
      );
      finalIds.forEach((id, position) => update.run(position, timestamp, key, id));
      this.bumpEntry(entryId, key, timestamp);
      this.bumpManifest();
    });
  }

  private normalizeEntryPositions(): void {
    const rows = this.entries();
    this.database.connection.exec(
      `UPDATE journal_entries SET position = position + ${MAX_JOURNAL_ENTRIES + 1}`,
    );
    const update = this.database.connection.prepare('UPDATE journal_entries SET position = ? WHERE id = ?');
    rows.forEach(({ id }, position) => update.run(position, id));
  }

  private normalizePagePositions(entryId: string): void {
    const rows = this.pages(entryId);
    this.database.connection.prepare(
      'UPDATE journal_pages SET position = position + ? WHERE entry_id = ?',
    ).run(MAX_NOTE_PAGES + 1, entryId);
    const update = this.database.connection.prepare('UPDATE journal_pages SET position = ? WHERE id = ?');
    rows.forEach(({ id }, position) => update.run(position, id));
  }

  private authorizeDelete(
    actor: JournalActor,
    target: DeleteJournalTargetInput['target'],
  ): JournalResult<{ revision: number }> {
    const entry = this.entry(target.entryId);
    if (!entry) return failure('not_found', 'The note no longer exists.', { entryId: target.entryId });
    if (target.kind === 'note' || target.kind === 'entry') {
      return actor.kind === 'gm'
        ? { ok: true, value: { revision: entry.revision } }
        : failure('permission_denied', 'Only the Game Master can delete notes.', { entryId: target.entryId });
    }
    const page = this.page(target.pageId);
    if (!page || page.entry_id !== entry.id) {
      return failure('not_found', 'The page no longer exists.', { entryId: entry.id, pageId: target.pageId });
    }
    const projected = this.projectPages(actor, entry).find(({ id }) => id === page.id);
    return projected?.capabilities.delete
      ? { ok: true, value: { revision: page.revision } }
      : failure('permission_denied', 'You cannot delete this page.', { entryId: entry.id, pageId: page.id });
  }

  private targetAssetIds(target: DeleteJournalTargetInput['target']): string[] {
    const rows = target.kind === 'note' || target.kind === 'entry'
      ? this.database.connection.prepare(
          `SELECT DISTINCT references_.asset_id
           FROM journal_page_assets AS references_
           JOIN journal_pages AS pages ON pages.id = references_.page_id
           WHERE pages.entry_id = ?
           ORDER BY references_.asset_id`,
        ).all(target.entryId)
      : this.database.connection.prepare(
          `SELECT asset_id
           FROM journal_page_assets
           WHERE page_id = ?
           ORDER BY asset_id`,
        ).all(target.pageId);
    return (rows as Array<{ asset_id: string }>).map(({ asset_id }) => asset_id);
  }

  private async describeDeleteAssets(
    actor: JournalActor,
    target: DeleteJournalTargetInput['target'],
    assetIds: string[],
  ): Promise<JournalDeleteAsset[]> {
    const manifest = await this.assets.readManifest();
    const deletingPages = new Set(
      target.kind === 'note' || target.kind === 'entry'
        ? this.pages(target.entryId).map(({ id }) => id)
        : [target.pageId],
    );
    const results: JournalDeleteAsset[] = [];
    for (const assetId of assetIds) {
      const asset = manifest.assets.find(({ id }) => id === assetId);
      if (!asset) continue;
      const journalShared = (await this.findAssetDependents(assetId)).some(
        ({ pageId }) => !deletingPages.has(pageId),
      );
      const sceneResult = await this.scenes.findDependents(assetId);
      if (!sceneResult.ok) {
        throw new Error('Scene dependencies could not be checked.');
      }
      const sceneShared = sceneResult.value.length > 0;
      const owns = actor.kind === 'gm' || asset.createdBy === actor.userId;
      const cleanupAllowed = !journalShared && !sceneShared && owns;
      results.push({
        cleanupAllowed,
        displayName: asset.displayName,
        id: asset.id,
        reason: cleanupAllowed
          ? undefined
          : journalShared || sceneShared
            ? 'Used somewhere else in the campaign'
            : 'Only the importing player or Game Master may delete this asset',
      });
    }
    return results;
  }
}
