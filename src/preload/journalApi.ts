import type { IpcRenderer } from 'electron';
import {
  journalIpcChannels,
  type JournalApi,
  type JournalChangedEvent,
} from '../shared/journal';

export function createJournalApi(ipc: Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener'>): JournalApi {
  return {
    acquireLease: (input) => ipc.invoke(journalIpcChannels.acquireLease, input),
    createNote: (input) => ipc.invoke(journalIpcChannels.createNote, input),
    createPage: (input) => ipc.invoke(journalIpcChannels.createPage, input),
    deleteTarget: (input) => ipc.invoke(
      input.target.kind === 'note' ? journalIpcChannels.deleteNote : journalIpcChannels.deletePage,
      input,
    ),
    detachAsset: (input) => ipc.invoke(journalIpcChannels.detachAsset, input),
    findAssetDependents: (input) => ipc.invoke(journalIpcChannels.findAssetDependents, input),
    getNote: (input) => ipc.invoke(journalIpcChannels.getNote, input),
    getPage: (input) => ipc.invoke(journalIpcChannels.getPage, input),
    list: (input) => ipc.invoke(journalIpcChannels.list, input),
    listUsers: (input) => ipc.invoke(journalIpcChannels.listUsers, input),
    moveNote: (input) => ipc.invoke(journalIpcChannels.moveNote, input),
    movePage: (input) => ipc.invoke(journalIpcChannels.movePage, input),
    onChanged: (listener) => {
      const handler = (_event: unknown, value: JournalChangedEvent) => listener(value);
      ipc.on(journalIpcChannels.changed, handler);
      return () => ipc.removeListener(journalIpcChannels.changed, handler);
    },
    prepareDelete: (input) => ipc.invoke(journalIpcChannels.prepareDelete, input),
    releaseLease: (input) => ipc.invoke(journalIpcChannels.releaseLease, input),
    reorderNotes: (input) => ipc.invoke(journalIpcChannels.reorderNotes, input),
    reorderPages: (input) => ipc.invoke(journalIpcChannels.reorderPages, input),
    renewLease: (input) => ipc.invoke(journalIpcChannels.renewLease, input),
    updateNote: (input) => ipc.invoke(journalIpcChannels.updateNote, input),
    updateNotePermissions: (input) => ipc.invoke(journalIpcChannels.updateNotePermissions, input),
    updatePage: (input) => ipc.invoke(journalIpcChannels.updatePage, input),
    updatePagePermissions: (input) => ipc.invoke(journalIpcChannels.updatePagePermissions, input),
  };
}
