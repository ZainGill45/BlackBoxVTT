import { EventEmitter } from 'node:events';
import type { CampaignRuntimeRegistry } from './campaignRuntime';
import type {
  DeleteJournalTargetInput,
  JournalAssetInput,
  JournalAssetDependent,
  JournalChangedEvent,
  JournalDeletePreview,
  JournalDeleteResult,
  JournalEntryInput,
  JournalLeaseInput,
  JournalManifest,
  JournalPage,
  JournalPageInput,
  JournalPermissionSubject,
  JournalResult,
  MoveJournalEntryInput,
  MoveJournalPageInput,
  NoteEntry,
  PageEditLease,
  PrepareJournalDeleteInput,
  ReorderJournalEntriesInput,
  ReorderJournalPagesInput,
  UpdateJournalNoteInput,
  UpdateJournalNotePermissionsInput,
  UpdateJournalPageInput,
  UpdateJournalPagePermissionsInput,
} from '../shared/journal';

function unavailable<T>(): JournalResult<T> {
  return {
    error: { code: 'unavailable', message: 'The campaign Journal is unavailable.' },
    ok: false,
  };
}

export class JournalManager extends EventEmitter {
  constructor(private readonly runtimes: CampaignRuntimeRegistry) {
    super();
  }

  async list(campaignId: string): Promise<JournalResult<JournalManifest>> {
    const runtime = await this.runtimes.resolve(campaignId);
    return runtime ? runtime.journal.list() : unavailable();
  }

  async listUsers(campaignId: string): Promise<JournalResult<JournalPermissionSubject[]>> {
    const runtime = await this.runtimes.resolve(campaignId);
    return runtime ? runtime.journal.listUsers() : unavailable();
  }

  async getNote(input: JournalEntryInput): Promise<JournalResult<NoteEntry>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    return runtime ? runtime.journal.getNote(input.entryId) : unavailable();
  }

  async getPage(input: JournalPageInput): Promise<JournalResult<JournalPage>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    return runtime ? runtime.journal.getPage(input.entryId, input.pageId) : unavailable();
  }

  async createNote(campaignId: string): Promise<JournalResult<NoteEntry>> {
    const runtime = await this.runtimes.resolve(campaignId);
    const result = runtime ? await runtime.journal.createNote() : unavailable<NoteEntry>();
    if (result.ok) this.changed({ campaignId, entryId: result.value.id, type: 'structure' });
    return result;
  }

  async updateNote(input: UpdateJournalNoteInput): Promise<JournalResult<NoteEntry>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime
      ? await runtime.journal.updateNote(input.entryId, input.name, input.nameStyle, input.expectedRevision)
      : unavailable<NoteEntry>();
    if (result.ok) this.changed({ campaignId: input.campaignId, entryId: input.entryId, type: 'structure' });
    return result;
  }

  async updateNotePermissions(input: UpdateJournalNotePermissionsInput): Promise<JournalResult<NoteEntry>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime
      ? await runtime.journal.updateNotePermissions(input)
      : unavailable<NoteEntry>();
    if (result.ok) this.changed({ campaignId: input.campaignId, entryId: input.entryId, type: 'permissions' });
    return result;
  }

  async createPage(input: { campaignId: string; entryId: string; expectedEntryRevision: number }): Promise<JournalResult<JournalPage>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime
      ? await runtime.journal.createPage(input.entryId, input.expectedEntryRevision)
      : unavailable<JournalPage>();
    if (result.ok) this.changed({ campaignId: input.campaignId, entryId: input.entryId, pageId: result.value.id, type: 'structure' });
    return result;
  }

  async updatePage(input: UpdateJournalPageInput): Promise<JournalResult<JournalPage>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime
      ? await runtime.journal.updatePage(
          input.entryId,
          input.pageId,
          input.leaseId,
          input.title,
          input.titleStyle,
          input.content,
          input.expectedRevision,
        )
      : unavailable<JournalPage>();
    if (result.ok) this.changed({ campaignId: input.campaignId, entryId: input.entryId, pageId: input.pageId, type: 'content' });
    return result;
  }

  async updatePagePermissions(input: UpdateJournalPagePermissionsInput): Promise<JournalResult<JournalPage>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime
      ? await runtime.journal.updatePagePermissions(input)
      : unavailable<JournalPage>();
    if (result.ok) this.changed({ campaignId: input.campaignId, entryId: input.entryId, pageId: input.pageId, type: 'permissions' });
    return result;
  }

  async acquireLease(input: JournalPageInput): Promise<JournalResult<PageEditLease>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    return runtime ? runtime.journal.acquireLease(input.entryId, input.pageId) : unavailable();
  }

  async renewLease(input: JournalLeaseInput): Promise<JournalResult<PageEditLease>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    return runtime
      ? runtime.journal.renewLease(input.entryId, input.pageId, input.leaseId)
      : unavailable();
  }

  async releaseLease(input: JournalLeaseInput): Promise<JournalResult<null>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    return runtime ? runtime.journal.releaseLease(input.entryId, input.pageId, input.leaseId) : unavailable();
  }

  async moveNote(input: MoveJournalEntryInput): Promise<JournalResult<JournalManifest>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime ? await runtime.journal.moveNote(input) : unavailable<JournalManifest>();
    if (result.ok) this.changed({ campaignId: input.campaignId, type: 'structure' });
    return result;
  }

  async reorderNotes(input: ReorderJournalEntriesInput): Promise<JournalResult<JournalManifest>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime ? await runtime.journal.reorderNotes(input) : unavailable<JournalManifest>();
    if (result.ok) this.changed({ campaignId: input.campaignId, type: 'structure' });
    return result;
  }

  async movePage(input: MoveJournalPageInput): Promise<JournalResult<NoteEntry>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime ? await runtime.journal.movePage(input) : unavailable<NoteEntry>();
    if (result.ok) this.changed({ campaignId: input.campaignId, entryId: input.entryId, type: 'structure' });
    return result;
  }

  async reorderPages(input: ReorderJournalPagesInput): Promise<JournalResult<NoteEntry>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime ? await runtime.journal.reorderPages(input) : unavailable<NoteEntry>();
    if (result.ok) this.changed({ campaignId: input.campaignId, entryId: input.entryId, type: 'structure' });
    return result;
  }

  async prepareDelete(input: PrepareJournalDeleteInput): Promise<JournalResult<JournalDeletePreview>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    return runtime ? runtime.journal.prepareDelete(input.target) : unavailable();
  }

  async deleteTarget(input: DeleteJournalTargetInput): Promise<JournalResult<JournalDeleteResult>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime ? await runtime.journal.deleteTarget(input) : unavailable<JournalDeleteResult>();
    if (result.ok) {
      this.changed({
        campaignId: input.campaignId,
        entryId: input.target.entryId,
        pageId: input.target.kind === 'page' ? input.target.pageId : undefined,
        type: 'deleted',
      });
    }
    return result;
  }

  async findAssetDependents(input: JournalAssetInput): Promise<JournalResult<JournalAssetDependent[]>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    return runtime ? runtime.journal.findAssetDependents(input.assetId) : unavailable();
  }

  async detachAsset(input: JournalAssetInput): Promise<JournalResult<null>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime ? await runtime.journal.detachAsset(input.assetId) : unavailable<null>();
    if (result.ok) this.changed({ campaignId: input.campaignId, type: 'content' });
    return result;
  }

  notifyRemoteChanged(event: JournalChangedEvent): void {
    this.emit('changed', event);
  }

  private changed(event: JournalChangedEvent): void {
    this.emit('changed', event);
    this.emit('local-changed', event);
  }
}
