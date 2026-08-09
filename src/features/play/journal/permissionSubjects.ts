import type { PermissionsModalSubject } from '../../../components/ui/PermissionsModal';
import {
  permissionAccessFor,
  type PermissionSubject,
} from '../../../shared/permissions';
import type {
  JournalAccessLevel,
  JournalApi,
  JournalEntry,
  JournalEntrySummary,
  JournalPageAccessLevel,
  JournalPageSummary,
  NoteEntry,
} from '../../../shared/journal';

const ENTRY_LEVELS: readonly JournalAccessLevel[] = ['none', 'view', 'edit'];
const PAGE_LEVELS: readonly JournalPageAccessLevel[] = [
  'inherit',
  'none',
  'view',
  'edit',
];

const ACCESS_LABELS: Record<JournalPageAccessLevel, string> = {
  edit: 'Edit',
  inherit: 'Inherit note default',
  none: 'No access',
  view: 'View',
};

/**
 * What a Journal entry's access governs, in the reader's terms rather than the
 * schema's.
 */
function entryDescription(entry: JournalEntrySummary): string {
  return entry.kind === 'note'
    ? `Access to “${entry.name}”. Pages can inherit this or set their own.`
    : `Access to “${entry.name}”.`;
}

export function journalEntryPermissionSubject({
  campaignId,
  entry,
  journalApi,
  onUpdated,
  users,
}: {
  campaignId: string;
  entry: JournalEntrySummary;
  journalApi: JournalApi;
  onUpdated: (updated: JournalEntry) => void;
  users: readonly PermissionSubject[];
}): PermissionsModalSubject<JournalAccessLevel> {
  return {
    async commit(permissions, revision) {
      const input = {
        campaignId,
        entryId: entry.id,
        expectedPermissionRevision: revision,
        permissions,
      };
      const result = entry.kind === 'note'
        ? await journalApi.updateNotePermissions(input)
        : await journalApi.updateEntryPermissions(input);
      if (result.ok) {
        onUpdated(result.value);
        return { kind: 'ok' };
      }
      if (result.error.code !== 'conflict') {
        return { kind: 'failed', message: result.error.message };
      }
      const fresh = await journalApi.getEntry({ campaignId, entryId: entry.id });
      if (!fresh.ok) return { kind: 'failed', message: fresh.error.message };
      onUpdated(fresh.value);
      return { kind: 'stale', revision: fresh.value.permissionRevision };
    },
    configuration: entry.permissions!,
    description: entryDescription(entry),
    levelLabel: (level) => ACCESS_LABELS[level],
    levels: ENTRY_LEVELS,
    revision: entry.permissionRevision,
    users,
  };
}

export function journalPagePermissionSubject({
  campaignId,
  journalApi,
  note,
  onUpdated,
  page,
  users,
}: {
  campaignId: string;
  journalApi: JournalApi;
  note: NoteEntry;
  onUpdated: (updated: NoteEntry) => void;
  page: JournalPageSummary;
  users: readonly PermissionSubject[];
}): PermissionsModalSubject<JournalPageAccessLevel> {
  return {
    async commit(permissions, revision) {
      const result = await journalApi.updatePagePermissions({
        campaignId,
        entryId: note.id,
        expectedPermissionRevision: revision,
        pageId: page.id,
        permissions,
      });
      const fresh = await journalApi.getNote({ campaignId, entryId: note.id });
      if (fresh.ok) onUpdated(fresh.value);
      if (result.ok) return { kind: 'ok' };
      if (result.error.code !== 'conflict') {
        return { kind: 'failed', message: result.error.message };
      }
      if (!fresh.ok) return { kind: 'failed', message: fresh.error.message };
      const refreshed = fresh.value.pages.find(({ id }) => id === page.id);
      return refreshed
        ? { kind: 'stale', revision: refreshed.permissionRevision }
        : { kind: 'failed', message: 'This page no longer exists.' };
    },
    configuration: page.permissions!,
    description: `Access to “${page.title}”. Inheriting follows “${note.name}”.`,
    /* Inheriting is the only level whose meaning lives somewhere else, so it
       says where it landed rather than making the reader go and look. */
    levelLabel: (level, userId) =>
      level === 'inherit' && note.permissions
        ? `${ACCESS_LABELS.inherit} (${
          ACCESS_LABELS[permissionAccessFor(note.permissions, userId)]
        })`
        : ACCESS_LABELS[level],
    levels: PAGE_LEVELS,
    revision: page.permissionRevision,
    users,
  };
}
