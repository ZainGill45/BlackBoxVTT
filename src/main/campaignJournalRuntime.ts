import type {
  DeleteJournalTargetInput,
  JournalDeletePreview,
  JournalDeleteResult,
  JournalAssetDependent,
  JournalManifest,
  JournalPage,
  JournalPermissionSubject,
  JournalResult,
  MoveJournalEntryInput,
  MoveJournalPageInput,
  NoteEntry,
  PageEditLease,
  ReorderJournalEntriesInput,
  ReorderJournalPagesInput,
  UpdateJournalNotePermissionsInput,
  UpdateJournalPagePermissionsInput,
} from '../shared/journal';
import type { LocalCampaignWorkspace } from './campaignWorkspace';

export interface JoinedJournalTransport {
  acquireLease(entryId: string, pageId: string): Promise<JournalResult<PageEditLease>>;
  createNote(): Promise<JournalResult<NoteEntry>>;
  createPage(entryId: string, expectedEntryRevision: number): Promise<JournalResult<JournalPage>>;
  deleteTarget(input: Omit<DeleteJournalTargetInput, 'campaignId'>): Promise<JournalResult<JournalDeleteResult>>;
  detachAsset(assetId: string): Promise<JournalResult<null>>;
  findAssetDependents(assetId: string): Promise<JournalResult<JournalAssetDependent[]>>;
  getNote(entryId: string): Promise<JournalResult<NoteEntry>>;
  getPage(entryId: string, pageId: string): Promise<JournalResult<JournalPage>>;
  list(): Promise<JournalResult<JournalManifest>>;
  listUsers(): Promise<JournalResult<JournalPermissionSubject[]>>;
  moveNote(input: Omit<MoveJournalEntryInput, 'campaignId'>): Promise<JournalResult<JournalManifest>>;
  movePage(input: Omit<MoveJournalPageInput, 'campaignId'>): Promise<JournalResult<NoteEntry>>;
  prepareDelete(target: DeleteJournalTargetInput['target']): Promise<JournalResult<JournalDeletePreview>>;
  releaseLease(entryId: string, pageId: string, leaseId: string): Promise<JournalResult<null>>;
  reorderNotes(input: Omit<ReorderJournalEntriesInput, 'campaignId'>): Promise<JournalResult<JournalManifest>>;
  reorderPages(input: Omit<ReorderJournalPagesInput, 'campaignId'>): Promise<JournalResult<NoteEntry>>;
  renewLease(entryId: string, pageId: string, leaseId: string): Promise<JournalResult<PageEditLease>>;
  updateNote(entryId: string, name: string, nameStyle: NoteEntry['nameStyle'], expectedRevision: number): Promise<JournalResult<NoteEntry>>;
  updateNotePermissions(input: Omit<UpdateJournalNotePermissionsInput, 'campaignId'>): Promise<JournalResult<NoteEntry>>;
  updatePage(
    entryId: string,
    pageId: string,
    leaseId: string,
    title: string,
    titleStyle: JournalPage['titleStyle'],
    content: JournalPage['content'],
    expectedRevision: number,
  ): Promise<JournalResult<JournalPage>>;
  updatePagePermissions(input: Omit<UpdateJournalPagePermissionsInput, 'campaignId'>): Promise<JournalResult<JournalPage>>;
}

export type CampaignJournalRuntime = JoinedJournalTransport;

export function createLocalJournalRuntime(
  workspace: LocalCampaignWorkspace,
): CampaignJournalRuntime {
  const repository = workspace.journalRepository;
  const actor = { kind: 'gm' } as const;
  return {
    acquireLease: (entryId, pageId) => repository.acquireLease(actor, entryId, pageId),
    createNote: () => repository.createNote(actor),
    createPage: (entryId, revision) => repository.createPage(actor, entryId, revision),
    deleteTarget: (input) => repository.deleteTarget(actor, input),
    detachAsset: (assetId) => repository.detachAsset(assetId, actor),
    findAssetDependents: async (assetId) => ({ ok: true, value: await repository.findAssetDependents(assetId, actor) }),
    getNote: (entryId) => repository.getNote(actor, entryId),
    getPage: (entryId, pageId) => repository.getPage(actor, entryId, pageId),
    list: () => repository.list(actor),
    listUsers: () => repository.listUsers(actor),
    moveNote: (input) => repository.moveNote(actor, input),
    movePage: (input) => repository.movePage(actor, input),
    prepareDelete: (target) => repository.prepareDelete(actor, target),
    releaseLease: (_entryId, pageId, leaseId) => repository.releaseLease(actor, pageId, leaseId),
    reorderNotes: (input) => repository.reorderNotes(actor, input),
    reorderPages: (input) => repository.reorderPages(actor, input),
    renewLease: (entryId, pageId, leaseId) => repository.renewLease(actor, entryId, pageId, leaseId),
    updateNote: (entryId, name, nameStyle, revision) => repository.updateNote(actor, entryId, name, nameStyle, revision),
    updateNotePermissions: (input) => repository.updateNotePermissions(actor, input),
    updatePage: (entryId, pageId, leaseId, title, titleStyle, content, revision) =>
      repository.updatePage(actor, entryId, pageId, leaseId, title, titleStyle, content, revision),
    updatePagePermissions: (input) => repository.updatePagePermissions(actor, input),
  };
}

export function createJoinedJournalRuntime(
  transport: JoinedJournalTransport,
): CampaignJournalRuntime {
  return transport;
}
