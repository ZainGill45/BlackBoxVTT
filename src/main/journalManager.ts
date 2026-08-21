import { EventEmitter } from 'node:events';
import type { CampaignRuntimeRegistry } from './campaignRuntime';
import type {
  DeleteJournalTargetInput,
  JournalAssetInput,
  JournalAssetDependent,
  JournalChangedEvent,
  JournalContentSnapshot,
  JournalDeletePreview,
  JournalDeleteResult,
  JournalEntryInput,
  JournalEntry,
  CreateJournalEntryInput,
  JournalLeaseInput,
  JournalManifest,
  JournalPage,
  JournalPageInput,
  JournalResult,
  MoveJournalEntryInput,
  MoveJournalPageInput,
  NoteEntry,
  PageEditLease,
  PrepareJournalDeleteInput,
  ReorderJournalEntriesInput,
  ReorderJournalGroupInput,
  ReorderJournalPagesInput,
  UpdateJournalEntryDataInput,
  UpdateJournalNoteInput,
  UpdateJournalNotePermissionsInput,
  UpdateJournalEntryPermissionsInput,
  RenameJournalEntryInput,
  UpdateJournalPageInput,
  UpdateJournalPagePermissionsInput,
} from '../shared/journal';
import type {
  PermissionSubject,
} from '../shared/permissions';

function unavailable<T>(): JournalResult<T> {
  return {
    error: { code: 'unavailable', message: 'The campaign Journal is unavailable.' },
    ok: false,
  };
}

/**
 * Drops the routing key from a request before it reaches a runtime. Every IPC
 * input carries `campaignId` so the manager can resolve a runtime, but the
 * resolved runtime is already scoped to that campaign and a joined runtime
 * forwards what it is handed straight onto the wire, where the host rejects
 * unrecognized keys by closing the connection. The transports declare
 * `Omit<…, 'campaignId'>`, which describes the intent but cannot enforce it:
 * excess property checks do not apply to a value passed by reference.
 */
function forwarded<T extends { campaignId: string }>(
  input: T,
): Omit<T, 'campaignId'> {
  const request = { ...input } as Omit<T, 'campaignId'> & {
    campaignId?: string;
  };
  delete request.campaignId;
  return request;
}

const CONTENT_PREPARATION_INACTIVITY_MS = 30_000;

async function settleContentRead<T>(
  operation: Promise<T>,
): Promise<T | undefined> {
  return new Promise((resolve) => {
    let active = true;
    const finish = (value: T | undefined) => {
      if (!active) return;
      active = false;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(
      () => finish(undefined),
      CONTENT_PREPARATION_INACTIVITY_MS,
    );
    void operation.then(
      (value) => finish(value),
      () => finish(undefined),
    );
  });
}

export class JournalManager extends EventEmitter {
  private readonly contentGenerations = new Map<string, number>();
  private readonly contentCaches = new Map<
    string,
    {
      entries: Map<string, JournalEntry>;
      pages: Map<string, JournalPage>;
      runtime: object;
    }
  >();

  constructor(private readonly runtimes: CampaignRuntimeRegistry) {
    super();
  }

  async list(campaignId: string): Promise<JournalResult<JournalManifest>> {
    const runtime = await this.runtimes.resolve(campaignId);
    return runtime ? runtime.journal.list() : unavailable();
  }

  async listUsers(campaignId: string): Promise<JournalResult<PermissionSubject[]>> {
    const runtime = await this.runtimes.resolve(campaignId);
    return runtime ? runtime.journal.listUsers() : unavailable();
  }

  async getNote(input: JournalEntryInput): Promise<JournalResult<NoteEntry>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    return runtime ? runtime.journal.getNote(input.entryId) : unavailable();
  }

  async getEntry(input: JournalEntryInput): Promise<JournalResult<JournalEntry>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    if (!runtime) return unavailable();
    const cache = this.contentCache(input.campaignId, runtime);
    const cached = cache.entries.get(input.entryId);
    if (cached) return { ok: true, value: structuredClone(cached) };
    const generation = this.contentGeneration(input.campaignId);
    const result = await runtime.journal.getEntry(input.entryId);
    if (
      result.ok &&
      generation === this.contentGeneration(input.campaignId) &&
      this.contentCaches.get(input.campaignId) === cache
    ) {
      cache.entries.set(input.entryId, structuredClone(result.value));
    }
    return result;
  }

  async getPage(input: JournalPageInput): Promise<JournalResult<JournalPage>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    if (!runtime) return unavailable();
    const cache = this.contentCache(input.campaignId, runtime);
    const cached = cache.pages.get(input.pageId);
    if (cached && cached.entryId === input.entryId) {
      return { ok: true, value: structuredClone(cached) };
    }
    const generation = this.contentGeneration(input.campaignId);
    const result = await runtime.journal.getPage(input.entryId, input.pageId);
    if (
      result.ok &&
      generation === this.contentGeneration(input.campaignId) &&
      this.contentCaches.get(input.campaignId) === cache
    ) {
      cache.pages.set(input.pageId, structuredClone(result.value));
    }
    return result;
  }

  async prepareContent(
    campaignId: string,
  ): Promise<JournalResult<JournalContentSnapshot>> {
    const runtime = await this.runtimes.resolve(campaignId);
    if (!runtime) return unavailable();
    const generation = this.contentGeneration(campaignId);
    const manifest = await settleContentRead(runtime.journal.list());
    if (!manifest) {
      return { ok: true, value: { entries: [], pages: [] } };
    }
    if (!manifest.ok) return manifest;
    const cache = this.contentCache(campaignId, runtime);
    const entries: JournalEntry[] = [];
    const pages: JournalPage[] = [];
    const jobs: Array<{ name: string; run: () => Promise<void> }> = [];
    for (const entry of manifest.value.entries) {
      if (entry.kind === 'system') {
        jobs.push({
          name: entry.name,
          run: async () => {
            const result = await settleContentRead(
              runtime.journal.getEntry(entry.id),
            );
            if (
              result?.ok &&
              result.value.kind === 'system' &&
              generation === this.contentGeneration(campaignId) &&
              this.contentCaches.get(campaignId) === cache
            ) {
              cache.entries.set(entry.id, structuredClone(result.value));
              entries.push(result.value);
            }
          },
        });
      } else {
        for (const page of entry.pages) {
          jobs.push({
            name: page.title,
            run: async () => {
              const result = await settleContentRead(
                runtime.journal.getPage(entry.id, page.id),
              );
              if (
                result?.ok &&
                generation === this.contentGeneration(campaignId) &&
                this.contentCaches.get(campaignId) === cache
              ) {
                cache.pages.set(page.id, structuredClone(result.value));
                pages.push(result.value);
              }
            },
          });
        }
      }
    }
    const queue = [...jobs];
    let completedItems = 0;
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        try {
          await job.run();
        } catch {
          // A broken body is absent from the best-effort snapshot.
        } finally {
          completedItems += 1;
          this.emit('preparation-progress', {
            campaignId,
            completedItems,
            currentName: job.name,
            totalItems: jobs.length,
          });
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (
      generation !== this.contentGeneration(campaignId) ||
      this.contentCaches.get(campaignId) !== cache
    ) {
      return { ok: true, value: { entries: [], pages: [] } };
    }
    return {
      ok: true,
      value: {
        entries: entries.filter(
          (entry): entry is Extract<JournalEntry, { kind: 'system' }> =>
            entry.kind === 'system',
        ),
        pages,
      },
    };
  }

  async createNote(campaignId: string): Promise<JournalResult<NoteEntry>> {
    const runtime = await this.runtimes.resolve(campaignId);
    const result = runtime ? await runtime.journal.createNote() : unavailable<NoteEntry>();
    if (result.ok) this.changed({ campaignId, entryId: result.value.id, type: 'structure' });
    return result;
  }

  async createEntry(input: CreateJournalEntryInput): Promise<JournalResult<JournalEntry>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime
      ? await runtime.journal.createEntry(input.typeId)
      : unavailable<JournalEntry>();
    if (result.ok) this.changed({ campaignId: input.campaignId, entryId: result.value.id, type: 'structure' });
    return result;
  }

  async renameEntry(input: RenameJournalEntryInput): Promise<JournalResult<JournalEntry>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime
      ? await runtime.journal.renameEntry(input.entryId, input.name, input.expectedRevision)
      : unavailable<JournalEntry>();
    if (result.ok) this.changed({ campaignId: input.campaignId, entryId: input.entryId, type: 'structure' });
    return result;
  }

  async updateEntryData(input: UpdateJournalEntryDataInput): Promise<JournalResult<JournalEntry>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime
      ? await runtime.journal.updateEntryData(forwarded(input))
      : unavailable<JournalEntry>();
    if (result.ok) this.changed({ campaignId: input.campaignId, entryId: input.entryId, type: 'content' });
    return result;
  }

  async updateEntryPermissions(input: UpdateJournalEntryPermissionsInput): Promise<JournalResult<JournalEntry>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime
      ? await runtime.journal.updateEntryPermissions(forwarded(input))
      : unavailable<JournalEntry>();
    if (result.ok) this.changed({ campaignId: input.campaignId, entryId: input.entryId, type: 'permissions' });
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
      ? await runtime.journal.updateNotePermissions(forwarded(input))
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
      ? await runtime.journal.updatePagePermissions(forwarded(input))
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
    const result = runtime ? await runtime.journal.moveNote(forwarded(input)) : unavailable<JournalManifest>();
    if (result.ok) this.changed({ campaignId: input.campaignId, type: 'structure' });
    return result;
  }

  async moveEntry(input: MoveJournalEntryInput): Promise<JournalResult<JournalManifest>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime ? await runtime.journal.moveEntry(forwarded(input)) : unavailable<JournalManifest>();
    if (result.ok) this.changed({ campaignId: input.campaignId, type: 'structure' });
    return result;
  }

  async reorderNotes(input: ReorderJournalEntriesInput): Promise<JournalResult<JournalManifest>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime ? await runtime.journal.reorderNotes(forwarded(input)) : unavailable<JournalManifest>();
    if (result.ok) this.changed({ campaignId: input.campaignId, type: 'structure' });
    return result;
  }

  async reorderEntries(input: ReorderJournalGroupInput): Promise<JournalResult<JournalManifest>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime ? await runtime.journal.reorderEntries(forwarded(input)) : unavailable<JournalManifest>();
    if (result.ok) this.changed({ campaignId: input.campaignId, type: 'structure' });
    return result;
  }

  async movePage(input: MoveJournalPageInput): Promise<JournalResult<NoteEntry>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime ? await runtime.journal.movePage(forwarded(input)) : unavailable<NoteEntry>();
    if (result.ok) this.changed({ campaignId: input.campaignId, entryId: input.entryId, type: 'structure' });
    return result;
  }

  async reorderPages(input: ReorderJournalPagesInput): Promise<JournalResult<NoteEntry>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime ? await runtime.journal.reorderPages(forwarded(input)) : unavailable<NoteEntry>();
    if (result.ok) this.changed({ campaignId: input.campaignId, entryId: input.entryId, type: 'structure' });
    return result;
  }

  async prepareDelete(input: PrepareJournalDeleteInput): Promise<JournalResult<JournalDeletePreview>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    return runtime ? runtime.journal.prepareDelete(input.target) : unavailable();
  }

  async deleteTarget(input: DeleteJournalTargetInput): Promise<JournalResult<JournalDeleteResult>> {
    const runtime = await this.runtimes.resolve(input.campaignId);
    const result = runtime ? await runtime.journal.deleteTarget(forwarded(input)) : unavailable<JournalDeleteResult>();
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
    this.invalidateContent(event);
    this.emit('changed', event);
  }

  releaseCampaign(campaignId: string): void {
    this.contentGenerations.set(
      campaignId,
      this.contentGeneration(campaignId) + 1,
    );
    this.contentCaches.delete(campaignId);
  }

  private changed(event: JournalChangedEvent): void {
    this.invalidateContent(event);
    this.emit('changed', event);
    this.emit('local-changed', event);
  }

  private contentCache(campaignId: string, runtime: object) {
    const current = this.contentCaches.get(campaignId);
    if (current?.runtime === runtime) return current;
    const next = {
      entries: new Map<string, JournalEntry>(),
      pages: new Map<string, JournalPage>(),
      runtime,
    };
    this.contentCaches.set(campaignId, next);
    return next;
  }

  private contentGeneration(campaignId: string): number {
    return this.contentGenerations.get(campaignId) ?? 0;
  }

  private invalidateContent(event: JournalChangedEvent): void {
    this.contentGenerations.set(
      event.campaignId,
      this.contentGeneration(event.campaignId) + 1,
    );
    const cache = this.contentCaches.get(event.campaignId);
    if (!cache) return;
    if (!event.entryId) {
      this.contentCaches.delete(event.campaignId);
      return;
    }
    cache.entries.delete(event.entryId);
    if (event.pageId) {
      cache.pages.delete(event.pageId);
      return;
    }
    for (const [pageId, page] of cache.pages) {
      if (page.entryId === event.entryId) cache.pages.delete(pageId);
    }
  }
}
