import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { z } from 'zod';
import {
  isJournalTitleStyle,
  isRichTextDocument,
  journalIpcChannels,
  MAX_JOURNAL_CLEANUP_ASSETS,
  MAX_JOURNAL_ENTRIES,
  MAX_JOURNAL_PERMISSION_OVERRIDES,
  MAX_JOURNAL_TITLE_INPUT_CODE_UNITS,
  MAX_NOTE_PAGES,
  type JournalResult,
} from '../shared/journal';
import type { JournalManager } from './journalManager';

const campaign = z.object({ campaignId: z.string().uuid() }).strict();
const entry = campaign.extend({ entryId: z.string().uuid() });
const page = entry.extend({ pageId: z.string().uuid() });
const asset = campaign.extend({ assetId: z.string().uuid() });
const lease = page.extend({ leaseId: z.string().uuid() });
const revision = z.number().int().nonnegative();
const entryAccess = z.enum(['none', 'view', 'edit']);
const pageAccess = z.enum(['inherit', 'none', 'view', 'edit']);
const permissions = <T extends z.ZodTypeAny>(access: T) => z.object({
  allPlayers: access,
  overrides: z.array(z.object({ access, userId: z.string().uuid() }).strict())
    .max(MAX_JOURNAL_PERMISSION_OVERRIDES),
}).strict();
const deleteNoteTarget = z.object({ entryId: z.string().uuid(), kind: z.literal('note') }).strict();
const deleteEntryTarget = z.object({ entryId: z.string().uuid(), kind: z.literal('entry') }).strict();
const deletePageTarget = z.object({ entryId: z.string().uuid(), kind: z.literal('page'), pageId: z.string().uuid() }).strict();
const deleteTarget = z.discriminatedUnion('kind', [deleteEntryTarget, deleteNoteTarget, deletePageTarget]);

function invalid<T>(): JournalResult<T> {
  return { error: { code: 'invalid_input', message: 'The Journal request contains invalid input.' }, ok: false };
}

export function registerJournalIpcHandlers(
  ipc: IpcMain,
  manager: JournalManager,
  isAllowedSender: (sender: WebContents) => boolean,
  getAllowedWebContents: () => WebContents[],
) {
  const channels = Object.values(journalIpcChannels).filter(
    (channel) => channel !== journalIpcChannels.changed,
  );
  for (const channel of channels) ipc.removeHandler(channel);
  const handle = (channel: string, listener: (input: unknown) => unknown) => {
    ipc.handle(channel, (event: IpcMainInvokeEvent, input: unknown) => {
      if (!isAllowedSender(event.sender)) return invalid();
      return listener(input);
    });
  };
  handle(journalIpcChannels.list, (input) => {
    const parsed = campaign.safeParse(input);
    return parsed.success ? manager.list(parsed.data.campaignId) : invalid();
  });
  handle(journalIpcChannels.listUsers, (input) => {
    const parsed = campaign.safeParse(input);
    return parsed.success ? manager.listUsers(parsed.data.campaignId) : invalid();
  });
  handle(journalIpcChannels.getNote, (input) => {
    const parsed = entry.safeParse(input);
    return parsed.success ? manager.getNote(parsed.data) : invalid();
  });
  handle(journalIpcChannels.getEntry, (input) => {
    const parsed = entry.safeParse(input);
    return parsed.success ? manager.getEntry(parsed.data) : invalid();
  });
  handle(journalIpcChannels.getPage, (input) => {
    const parsed = page.safeParse(input);
    return parsed.success ? manager.getPage(parsed.data) : invalid();
  });
  handle(journalIpcChannels.createNote, (input) => {
    const parsed = campaign.safeParse(input);
    return parsed.success ? manager.createNote(parsed.data.campaignId) : invalid();
  });
  handle(journalIpcChannels.createEntry, (input) => {
    const parsed = campaign.extend({ typeId: z.string().min(1).max(128) }).safeParse(input);
    return parsed.success ? manager.createEntry(parsed.data) : invalid();
  });
  handle(journalIpcChannels.findAssetDependents, (input) => {
    const parsed = asset.safeParse(input);
    return parsed.success ? manager.findAssetDependents(parsed.data) : invalid();
  });
  handle(journalIpcChannels.detachAsset, (input) => {
    const parsed = asset.safeParse(input);
    return parsed.success ? manager.detachAsset(parsed.data) : invalid();
  });
  handle(journalIpcChannels.updateNote, (input) => {
    const parsed = entry.extend({
      expectedRevision: revision,
      name: z.string().max(MAX_JOURNAL_TITLE_INPUT_CODE_UNITS),
      nameStyle: z.unknown(),
    }).safeParse(input);
    return parsed.success && isJournalTitleStyle(parsed.data.nameStyle)
      ? manager.updateNote({ ...parsed.data, nameStyle: parsed.data.nameStyle })
      : invalid();
  });
  handle(journalIpcChannels.updateNotePermissions, (input) => {
    const parsed = entry.extend({
      expectedPermissionRevision: revision,
      permissions: permissions(entryAccess),
    }).safeParse(input);
    return parsed.success ? manager.updateNotePermissions(parsed.data) : invalid();
  });
  handle(journalIpcChannels.renameEntry, (input) => {
    const parsed = entry.extend({
      expectedRevision: revision,
      name: z.string().max(MAX_JOURNAL_TITLE_INPUT_CODE_UNITS),
    }).safeParse(input);
    return parsed.success ? manager.renameEntry(parsed.data) : invalid();
  });
  handle(journalIpcChannels.updateEntryData, (input) => {
    const parsed = entry.extend({
      data: z.json(),
      expectedRevision: revision,
    }).safeParse(input);
    return parsed.success ? manager.updateEntryData(parsed.data) : invalid();
  });
  handle(journalIpcChannels.updateEntryPermissions, (input) => {
    const parsed = entry.extend({
      expectedPermissionRevision: revision,
      permissions: permissions(entryAccess),
    }).safeParse(input);
    return parsed.success ? manager.updateEntryPermissions(parsed.data) : invalid();
  });
  handle(journalIpcChannels.createPage, (input) => {
    const parsed = entry.extend({ expectedEntryRevision: revision }).safeParse(input);
    return parsed.success ? manager.createPage(parsed.data) : invalid();
  });
  handle(journalIpcChannels.updatePage, (input) => {
    const parsed = page.extend({
      content: z.unknown(),
      expectedRevision: revision,
      leaseId: z.string().uuid(),
      title: z.string().max(MAX_JOURNAL_TITLE_INPUT_CODE_UNITS),
      titleStyle: z.unknown(),
    }).safeParse(input);
    return parsed.success && isRichTextDocument(parsed.data.content) && isJournalTitleStyle(parsed.data.titleStyle)
      ? manager.updatePage({ ...parsed.data, content: parsed.data.content, titleStyle: parsed.data.titleStyle })
      : invalid();
  });
  handle(journalIpcChannels.updatePagePermissions, (input) => {
    const parsed = page.extend({
      expectedPermissionRevision: revision,
      permissions: permissions(pageAccess),
    }).safeParse(input);
    return parsed.success ? manager.updatePagePermissions(parsed.data) : invalid();
  });
  handle(journalIpcChannels.acquireLease, (input) => {
    const parsed = page.safeParse(input);
    return parsed.success ? manager.acquireLease(parsed.data) : invalid();
  });
  handle(journalIpcChannels.renewLease, (input) => {
    const parsed = lease.safeParse(input);
    return parsed.success ? manager.renewLease(parsed.data) : invalid();
  });
  handle(journalIpcChannels.releaseLease, (input) => {
    const parsed = lease.safeParse(input);
    return parsed.success ? manager.releaseLease(parsed.data) : invalid();
  });
  handle(journalIpcChannels.moveNote, (input) => {
    const parsed = entry.extend({ direction: z.enum(['up', 'down']), expectedManifestRevision: revision }).safeParse(input);
    return parsed.success ? manager.moveNote(parsed.data) : invalid();
  });
  handle(journalIpcChannels.moveEntry, (input) => {
    const parsed = entry.extend({ direction: z.enum(['up', 'down']), expectedManifestRevision: revision }).safeParse(input);
    return parsed.success ? manager.moveEntry(parsed.data) : invalid();
  });
  handle(journalIpcChannels.reorderNotes, (input) => {
    const parsed = campaign.extend({ expectedManifestRevision: revision, orderedEntryIds: z.array(z.string().uuid()).max(MAX_JOURNAL_ENTRIES) }).safeParse(input);
    return parsed.success ? manager.reorderNotes(parsed.data) : invalid();
  });
  handle(journalIpcChannels.reorderEntries, (input) => {
    const parsed = campaign.extend({
      expectedManifestRevision: revision,
      groupId: z.string().min(1).max(128),
      orderedEntryIds: z.array(z.string().uuid()).max(MAX_JOURNAL_ENTRIES),
    }).safeParse(input);
    return parsed.success ? manager.reorderEntries(parsed.data) : invalid();
  });
  handle(journalIpcChannels.movePage, (input) => {
    const parsed = page.extend({ direction: z.enum(['up', 'down']), expectedEntryRevision: revision }).safeParse(input);
    return parsed.success ? manager.movePage(parsed.data) : invalid();
  });
  handle(journalIpcChannels.reorderPages, (input) => {
    const parsed = entry.extend({ expectedEntryRevision: revision, orderedPageIds: z.array(z.string().uuid()).max(MAX_NOTE_PAGES) }).safeParse(input);
    return parsed.success ? manager.reorderPages(parsed.data) : invalid();
  });
  handle(journalIpcChannels.prepareDelete, (input) => {
    const parsed = campaign.extend({ target: deleteTarget }).safeParse(input);
    return parsed.success ? manager.prepareDelete(parsed.data) : invalid();
  });
  handle(journalIpcChannels.deleteNote, (input) => {
    const parsed = campaign.extend({ cleanupAssetIds: z.array(z.string().uuid()).max(MAX_JOURNAL_CLEANUP_ASSETS), expectedRevision: revision, target: deleteNoteTarget }).safeParse(input);
    return parsed.success ? manager.deleteTarget(parsed.data) : invalid();
  });
  handle(journalIpcChannels.deleteEntry, (input) => {
    const parsed = campaign.extend({ cleanupAssetIds: z.array(z.string().uuid()).max(MAX_JOURNAL_CLEANUP_ASSETS), expectedRevision: revision, target: deleteEntryTarget }).safeParse(input);
    return parsed.success ? manager.deleteTarget(parsed.data) : invalid();
  });
  // Page and note deletion share the same explicit manager operation, but retain
  // separate IPC channels so neither becomes an open-ended command dispatcher.
  handle(journalIpcChannels.deletePage, (input) => {
    const parsed = campaign.extend({ cleanupAssetIds: z.array(z.string().uuid()).max(MAX_JOURNAL_CLEANUP_ASSETS), expectedRevision: revision, target: deletePageTarget }).safeParse(input);
    return parsed.success ? manager.deleteTarget(parsed.data) : invalid();
  });
  const onChanged = (event: unknown) => {
    for (const contents of getAllowedWebContents()) {
      if (isAllowedSender(contents) && !contents.isDestroyed()) {
        contents.send(journalIpcChannels.changed, event);
      }
    }
  };
  manager.on('changed', onChanged);
  return () => {
    for (const channel of channels) ipc.removeHandler(channel);
    manager.off('changed', onChanged);
  };
}
