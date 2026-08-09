import { BookOpen, Check, FileText, FileUser, Trash2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { InlineRename } from '../../components/ui/InlineRename';
import { Modal } from '../../components/ui/Modal';
import {
  ContextMenuController,
  type ContextMenuEntry,
} from '../../components/ui/contextMenu';
import { OrderedCollectionController } from '../../components/ui/orderedCollection';
import type { AssetApi } from '../../shared/assets';
import type { CampaignSystemState } from '../../shared/gameSystems';
import {
  type JournalApi,
  type JournalDeletePreview,
  type JournalEntrySummary,
  type JournalManifest,
  type JournalPermissionSubject,
  MAX_JOURNAL_TITLE_INPUT_CODE_UNITS,
  type NoteEntry,
  type SystemJournalEntry,
  type SystemJournalEntrySummary,
} from '../../shared/journal';
import {
  createDefaultCampaignSystemState,
  listJournalEntryTypeDefinitions,
} from '../../systems/catalog';
import {
  hasSystemJournalEntryRenderer,
  SystemJournalEntryModal,
} from '../../systems/rendererRegistry';
import {
  DELETE_CONFIRMATION_TIMEOUT_MS,
  useDeleteConfirmation,
} from '../connection/useDeleteConfirmation';
import {
  SidebarCollectionGroup,
  SidebarCollectionPanel,
} from './SidebarCollectionPanel';
import { JournalEntryPermissionsModal } from './journal/JournalEntryPermissionsModal';
import { NoteModal } from './journal/NoteModal';
import styles from './JournalPanel.module.css';

interface JournalPanelProps {
  assetApi?: AssetApi;
  campaignId?: string;
  journalApi?: JournalApi;
  role?: 'gm' | 'player';
  system?: CampaignSystemState;
}

interface ReorderState {
  activeId: string;
  groupId: string;
  orderedIds: readonly string[];
  x: number;
  y: number;
}

interface JournalEntryRowProps {
  deleteArmed: boolean;
  detail: string;
  entry: JournalEntrySummary;
  onContextMenu: (event: MouseEvent) => void;
  onDelete: () => void;
  onOpen: () => void;
  onRename: (name: string) => Promise<boolean>;
  reordering: boolean;
}

function JournalEntryRow({
  deleteArmed,
  detail,
  entry,
  onContextMenu,
  onDelete,
  onOpen,
  onRename,
  reordering,
}: JournalEntryRowProps) {
  const Icon = entry.kind === 'note' ? FileText : FileUser;

  return (
    <li
      className={styles.entryRow}
      data-journal-group-id={entry.groupId}
      data-journal-order-id={entry.id}
      data-reordering={reordering}
      onContextMenu={onContextMenu}
    >
      <button
        aria-label={`Open ${entry.name}`}
        className={styles.entryIcon}
        type="button"
        onClick={onOpen}
      >
        <Icon aria-hidden size="1.625rem" strokeWidth={1.4} />
      </button>
      <InlineRename
        accessibleLabel={`Name for ${entry.name}`}
        detail={detail}
        disabled={!entry.capabilities.edit}
        maxLength={MAX_JOURNAL_TITLE_INPUT_CODE_UNITS}
        onRename={onRename}
        value={entry.name}
      />
      <Button
        aria-label={deleteArmed
          ? `Confirm deletion of ${entry.name}`
          : `Delete ${entry.name}`}
        aria-pressed={deleteArmed}
        className={styles.deleteButton}
        disabled={!entry.capabilities.delete}
        size="compact"
        variant="danger"
        onClick={onDelete}
      >
        {deleteArmed ? (
          <Check aria-hidden size="1.125rem" strokeWidth={1.75} />
        ) : (
          <Trash2 aria-hidden size="1.125rem" strokeWidth={1.75} />
        )}
      </Button>
    </li>
  );
}

export function JournalPanel({
  assetApi,
  campaignId = '',
  journalApi,
  role = 'gm',
  system,
}: JournalPanelProps = {}) {
  if (!assetApi || !journalApi || !campaignId) return <JournalEmptyShell />;
  return (
    <ConnectedJournalPanel
      assetApi={assetApi}
      campaignId={campaignId}
      journalApi={journalApi}
      role={role}
      system={system ?? createDefaultCampaignSystemState()!}
    />
  );
}

function JournalEmptyShell() {
  const [query, setQuery] = useState('');
  return (
    <SidebarCollectionPanel
      addLabel="Add journal entry"
      clearLabel="Clear journal search"
      emptyIcon={BookOpen}
      emptyIconId="journal"
      onAdd={() => undefined}
      onQueryChange={setQuery}
      query={query}
      searchLabel="Search journal"
      searchPlaceholder="Search journal"
      showEmpty
    />
  );
}

function ConnectedJournalPanel({
  assetApi,
  campaignId,
  journalApi,
  role,
  system,
}: Required<JournalPanelProps>) {
  const entryTypes = useMemo(
    () => listJournalEntryTypeDefinitions(system),
    [system],
  );
  const typeById = useMemo(
    () => new Map(entryTypes.map((definition) => [definition.id, definition])),
    [entryTypes],
  );
  const groups = useMemo(() => {
    const byId = new Map<string, { id: string; label: string; order: number }>();
    for (const definition of entryTypes) {
      byId.set(definition.groupId, {
        id: definition.groupId,
        label: definition.groupLabel,
        order: definition.groupOrder,
      });
    }
    return [...byId.values()].sort((left, right) =>
      left.order - right.order || left.label.localeCompare(right.label),
    );
  }, [entryTypes]);
  const [manifest, setManifest] = useState<JournalManifest | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedNote, setSelectedNote] = useState<{
    note: NoteEntry;
    pageId?: string;
    showPermissions?: boolean;
  } | null>(null);
  const [selectedSystemEntry, setSelectedSystemEntry] = useState<SystemJournalEntry | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<SystemJournalEntrySummary | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<{
    entry: JournalEntrySummary;
    preview: JournalDeletePreview;
  } | null>(null);
  const [cleanupIds, setCleanupIds] = useState<string[]>([]);
  const [users, setUsers] = useState<JournalPermissionSubject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reorderState, setReorderState] = useState<ReorderState | null>(null);
  const menu = useRef<ContextMenuController | null>(null);
  const refreshRequestRef = useRef(0);
  const rowsRefs = useRef(new Map<string, HTMLUListElement>());
  const reorder = useRef<OrderedCollectionController | null>(null);
  const {
    pendingId: pendingDeleteId,
    request: requestDeleteConfirmation,
  } = useDeleteConfirmation();

  const refresh = useCallback(async () => {
    const request = ++refreshRequestRef.current;
    const result = await journalApi.list({ campaignId });
    if (request !== refreshRequestRef.current) return;
    if (result.ok) {
      setManifest(result.value);
      setSelectedSystemEntry((current) => {
        if (!current) return current;
        const summary = result.value.entries.find(({ id }) => id === current.id);
        return summary?.kind === 'system' ? { ...current, ...summary } : null;
      });
    } else {
      setError(result.error.message);
    }
  }, [campaignId, journalApi]);

  const acceptUpdatedNote = useCallback((updated: NoteEntry | null) => {
    if (!updated) {
      void refresh();
      return;
    }
    setManifest((current) => current
      ? {
          ...current,
          entries: current.entries.map((entry) => entry.id === updated.id ? updated : entry),
        }
      : current);
  }, [refresh]);

  const acceptUpdatedEntry = useCallback((updated: SystemJournalEntry) => {
    setManifest((current) => current
      ? {
          ...current,
          entries: current.entries.map((entry) => entry.id === updated.id ? updated : entry),
        }
      : current);
    setSelectedSystemEntry((current) => current?.id === updated.id ? updated : current);
  }, []);

  useEffect(() => {
    let active = true;
    const remove = journalApi.onChanged((event) => {
      if (event.campaignId === campaignId) void refresh();
    });
    void Promise.resolve().then(async () => {
      if (active) await refresh();
    });
    if (role === 'gm') {
      void journalApi.listUsers({ campaignId }).then((result) => {
        if (active && result.ok) setUsers(result.value);
      });
    }
    return () => {
      active = false;
      remove();
    };
  }, [campaignId, journalApi, refresh, role]);

  useEffect(() => {
    menu.current = new ContextMenuController();
    return () => menu.current?.close();
  }, []);

  const filteredEntries = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    if (!search) return manifest?.entries ?? [];
    return (manifest?.entries ?? []).filter((entry) =>
      entry.name.toLocaleLowerCase().includes(search) ||
      (entry.kind === 'note' && entry.pages.some((page) =>
        page.title.toLocaleLowerCase().includes(search),
      )),
    );
  }, [manifest, query]);

  const entriesByGroup = useMemo(() => new Map(groups.map((group) => [
    group.id,
    filteredEntries.filter((entry) => entry.groupId === group.id),
  ])), [filteredEntries, groups]);

  const beginReorder = (entry: JournalEntrySummary, event: MouseEvent) => {
    setQuery('');
    setExpanded((current) => ({ ...current, [entry.groupId]: true }));
    const controller = new OrderedCollectionController(
      () => manifest?.entries
        .filter(({ groupId }) => groupId === entry.groupId)
        .map(({ id }) => id) ?? [],
      async (orderedIds) => {
        if (!manifest) return false;
        const result = await journalApi.reorderEntries({
          campaignId,
          expectedManifestRevision: manifest.revision,
          groupId: entry.groupId,
          orderedEntryIds: [...orderedIds],
        });
        if (!result.ok) {
          setError(result.error.message);
          return false;
        }
        setManifest(result.value);
        return true;
      },
    );
    reorder.current = controller;
    const snapshot = controller.begin(entry.id);
    if (snapshot) {
      setReorderState({
        activeId: entry.id,
        groupId: entry.groupId,
        orderedIds: snapshot.orderedIds,
        x: event.clientX,
        y: event.clientY,
      });
    }
  };

  useEffect(() => {
    if (!reorderState) return undefined;
    const list = rowsRefs.current.get(reorderState.groupId);
    const move = (event: PointerEvent) => {
      if (list) {
        const bounds = list.getBoundingClientRect();
        if (event.clientY < bounds.top + 30) list.scrollBy({ top: -20 });
        else if (event.clientY > bounds.bottom - 30) list.scrollBy({ top: 20 });
      }
      const target = (event.target as Element | null)?.closest<HTMLElement>('[data-journal-order-id]');
      let snapshot = reorder.current?.active;
      if (target && target.dataset.journalGroupId === reorderState.groupId) {
        const index = snapshot?.orderedIds.indexOf(target.dataset.journalOrderId!) ?? 0;
        const after = event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
        snapshot = reorder.current?.placeAt(index + (after ? 1 : 0));
      }
      if (snapshot) {
        setReorderState((current) => current ? {
          ...current,
          orderedIds: snapshot!.orderedIds,
          x: event.clientX,
          y: event.clientY,
        } : current);
      }
    };
    const down = (event: PointerEvent) => {
      if (event.button === 2 || !list?.contains(event.target as Node)) {
        reorder.current?.cancel();
        setReorderState(null);
      } else if (event.button === 0) {
        event.preventDefault();
        void reorder.current?.commit().then(() => setReorderState(null));
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        reorder.current?.cancel();
        setReorderState(null);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const snapshot = reorder.current?.step(event.key === 'ArrowUp' ? 'up' : 'down');
        if (snapshot) setReorderState((current) => current ? { ...current, orderedIds: snapshot.orderedIds } : current);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void reorder.current?.commit().then(() => setReorderState(null));
      }
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [reorderState]);

  const deletePreparedEntry = async (
    entry: JournalEntrySummary,
    preview: JournalDeletePreview,
    selectedCleanupIds: string[],
  ) => {
    const result = await journalApi.deleteTarget({
      campaignId,
      cleanupAssetIds: selectedCleanupIds,
      expectedRevision: entry.revision,
      target: preview.target,
    });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setDeleteRequest(null);
    setSelectedNote((current) => current?.note.id === entry.id ? null : current);
    setSelectedSystemEntry((current) => current?.id === entry.id ? null : current);
    await refresh();
    if (result.value.cleanupFailures.length > 0) {
      setError('The entry was deleted, but some selected assets could not be moved to trash.');
    }
  };

  const requestEntryDelete = async (entry: JournalEntrySummary) => {
    const result = await journalApi.prepareDelete({
      campaignId,
      target: { entryId: entry.id, kind: entry.kind === 'note' ? 'note' : 'entry' },
    });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (result.value.assets.length === 0) {
      await deletePreparedEntry(entry, result.value, []);
      return;
    }
    setCleanupIds([]);
    setDeleteRequest({ entry, preview: result.value });
  };

  const openSystemEntry = async (entry: SystemJournalEntrySummary) => {
    const result = await journalApi.getEntry({ campaignId, entryId: entry.id });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (result.value.kind !== 'system' || !hasSystemJournalEntryRenderer(result.value.typeId)) {
      setError('This Journal entry does not have an available renderer.');
      return;
    }
    setSelectedSystemEntry(result.value);
  };

  const renameEntry = async (entry: JournalEntrySummary, name: string) => {
    const result = await journalApi.renameEntry({
      campaignId,
      entryId: entry.id,
      expectedRevision: entry.revision,
      name,
    });
    if (!result.ok) {
      setError(result.error.message);
      return false;
    }
    if (result.value.kind === 'note') acceptUpdatedNote(result.value);
    else acceptUpdatedEntry(result.value);
    return true;
  };

  const openContext = (event: MouseEvent, entry: JournalEntrySummary) => {
    event.preventDefault();
    const definition = typeById.get(entry.typeId);
    const label = definition?.label ?? 'Entry';
    const groupEntries = manifest?.entries.filter(({ groupId }) => groupId === entry.groupId) ?? [];
    const groupIndex = groupEntries.findIndex(({ id }) => id === entry.id);
    const entries: ContextMenuEntry[] = [];
    /* Scoped to this opening of the menu, so arming never carries over from a
       menu the user dismissed. Independent of the row's own trash button,
       which arms through useDeleteConfirmation. */
    let deleteArmedUntil = 0;
    if (entry.capabilities.managePermissions) {
      entries.push({
        kind: 'action',
        label: 'Edit Permissions',
        onSelect: () => entry.kind === 'note'
          ? setSelectedNote({ note: entry, pageId: entry.pages[0]?.id, showPermissions: true })
          : setEditingPermissions(entry),
      });
    }
    if (entry.capabilities.reorder) {
      entries.push(
        {
          disabled: groupIndex === 0,
          kind: 'action',
          label: `Move ${label} Up`,
          onSelect: () => {
            if (!manifest) return;
            void journalApi.moveEntry({
              campaignId,
              direction: 'up',
              entryId: entry.id,
              expectedManifestRevision: manifest.revision,
            }).then((result) => result.ok ? setManifest(result.value) : setError(result.error.message));
          },
        },
        {
          disabled: groupIndex === groupEntries.length - 1,
          kind: 'action',
          label: `Move ${label} Down`,
          onSelect: () => {
            if (!manifest) return;
            void journalApi.moveEntry({
              campaignId,
              direction: 'down',
              entryId: entry.id,
              expectedManifestRevision: manifest.revision,
            }).then((result) => result.ok ? setManifest(result.value) : setError(result.error.message));
          },
        },
        { kind: 'action', label: `Reorder ${label} Freely`, onSelect: () => beginReorder(entry, event) },
      );
    }
    if (entry.capabilities.delete) {
      /* Guarded because permissions and reorder are both conditional: with
         delete as the only available action the menu would otherwise open on
         a separator. */
      if (entries.length > 0) entries.push({ kind: 'divider' });
      entries.push({
        danger: true,
        kind: 'action',
        label: `Delete ${label}`,
        onSelect: (button) => {
          const now = Date.now();
          if (now > deleteArmedUntil) {
            deleteArmedUntil = now + DELETE_CONFIRMATION_TIMEOUT_MS;
            const armedUntil = deleteArmedUntil;
            button.textContent = `Confirm Delete ${label}`;
            button.setAttribute('aria-label', `Confirm deletion of ${entry.name}`);
            button.setAttribute('aria-pressed', 'true');
            window.setTimeout(() => {
              if (
                button.isConnected &&
                deleteArmedUntil === armedUntil &&
                Date.now() >= armedUntil
              ) {
                button.textContent = `Delete ${label}`;
                button.removeAttribute('aria-label');
                button.setAttribute('aria-pressed', 'false');
              }
            }, DELETE_CONFIRMATION_TIMEOUT_MS);
            return false;
          }
          void requestEntryDelete(entry);
        },
      });
    }
    if (entries.length === 0) return;
    menu.current?.open(event.clientX, event.clientY, `${entry.name} actions`, entries, () =>
      document.querySelector<HTMLElement>(`[data-journal-order-id="${entry.id}"] button`)?.focus(),
    );
  };

  const createEntry = async (typeId: string) => {
    const result = await journalApi.createEntry({ campaignId, typeId });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await refresh();
    setExpanded((current) => ({ ...current, [result.value.groupId]: true }));
    if (result.value.kind === 'note') {
      setSelectedNote({ note: result.value, pageId: result.value.pages[0]?.id });
    } else if (hasSystemJournalEntryRenderer(result.value.typeId)) {
      setSelectedSystemEntry(result.value);
    }
  };

  const openTypeMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const trigger = event.currentTarget;
    const bounds = trigger.getBoundingClientRect();
    menu.current?.open(
      bounds.left,
      bounds.bottom + 4,
      'Choose journal entry type',
      entryTypes.map((definition) => ({
        kind: 'action' as const,
        label: definition.label,
        onSelect: () => void createEntry(definition.id),
      })),
      () => trigger.focus(),
    );
  };

  return (
    <>
      <SidebarCollectionPanel
        addDisabled={role !== 'gm'}
        addHasPopup="menu"
        addLabel="Add journal entry"
        clearLabel="Clear journal search"
        emptyIcon={BookOpen}
        emptyIconId="journal"
        onAdd={openTypeMenu}
        onQueryChange={setQuery}
        query={query}
        searchLabel="Search journal"
        searchPlaceholder="Search journal"
        showEmpty={(manifest?.entries.length ?? 0) === 0}
      >
        {groups.map((group) => {
          const groupEntries = entriesByGroup.get(group.id) ?? [];
          if (groupEntries.length === 0) return null;
          const visibleEntries = reorderState?.groupId === group.id
            ? reorderState.orderedIds.flatMap((id) => groupEntries.find((entry) => entry.id === id) ?? [])
            : groupEntries;
          return (
            <SidebarCollectionGroup
              expanded={Boolean(query.trim()) || Boolean(expanded[group.id])}
              key={group.id}
              label={group.label}
              onExpandedChange={(next) => setExpanded((current) => ({ ...current, [group.id]: next }))}
            >
              <ul
                className={styles.entryList}
                ref={(node) => {
                  if (node) rowsRefs.current.set(group.id, node);
                  else rowsRefs.current.delete(group.id);
                }}
              >
                {visibleEntries.map((entry) => {
                  const search = query.trim().toLocaleLowerCase();
                  const matchingPageId = entry.kind === 'note' && search
                    ? entry.pages.find((page) => page.title.toLocaleLowerCase().includes(search))?.id
                    : undefined;
                  return (
                    <JournalEntryRow
                      deleteArmed={pendingDeleteId === entry.id}
                      detail={entry.kind === 'note'
                        ? `${entry.pages.length} ${entry.pages.length === 1 ? 'page' : 'pages'}`
                        : `${typeById.get(entry.typeId)?.label ?? 'Entry'} Sheet`}
                      entry={entry}
                      key={`${entry.id}:${entry.revision}`}
                      reordering={reorderState?.activeId === entry.id}
                      onContextMenu={(event) => openContext(event, entry)}
                      onDelete={() => {
                        if (requestDeleteConfirmation(entry.id)) {
                          void requestEntryDelete(entry);
                        }
                      }}
                      onOpen={() => {
                        if (reorderState) return;
                        if (entry.kind === 'note') setSelectedNote({ note: entry, pageId: matchingPageId });
                        else void openSystemEntry(entry);
                      }}
                      onRename={(name) => renameEntry(entry, name)}
                    />
                  );
                })}
              </ul>
            </SidebarCollectionGroup>
          );
        })}
      </SidebarCollectionPanel>

      {reorderState ? (
        <div className={styles.reorderGhost} style={{ left: reorderState.x + 12, top: reorderState.y + 12 }}>
          Move {manifest?.entries.find(({ id }) => id === reorderState.activeId)?.name}
        </div>
      ) : null}

      {selectedNote ? (
        <NoteModal
          assetApi={assetApi}
          campaignId={campaignId}
          initialPageId={selectedNote.pageId}
          initialShowPermissions={selectedNote.showPermissions}
          journalApi={journalApi}
          note={selectedNote.note}
          onClose={() => setSelectedNote(null)}
          onUpdated={acceptUpdatedNote}
          users={users}
        />
      ) : null}

      {selectedSystemEntry ? (
        <SystemJournalEntryModal
          campaignId={campaignId}
          entry={selectedSystemEntry}
          journalApi={journalApi}
          onDismiss={() => setSelectedSystemEntry(null)}
          onUpdated={acceptUpdatedEntry}
          system={system}
        />
      ) : null}

      {editingPermissions?.permissions ? (
        <JournalEntryPermissionsModal
          entry={editingPermissions}
          onDismiss={() => setEditingPermissions(null)}
          onSave={async (permissions) => {
            const result = await journalApi.updateEntryPermissions({
              campaignId,
              entryId: editingPermissions.id,
              expectedRevision: editingPermissions.revision,
              permissions,
            });
            if (!result.ok) return result.error.message;
            if (result.value.kind === 'system') acceptUpdatedEntry(result.value);
            return null;
          }}
          users={users}
        />
      ) : null}

      <ConfirmModal
        confirmLabel={cleanupIds.length ? 'Delete and clean up' : 'Delete'}
        isOpen={deleteRequest !== null}
        message={`“${deleteRequest?.entry.name ?? 'This entry'}” contains embedded Storage images. Select any images that should also be moved to trash. Unselected images stay in Storage.`}
        title="Delete entry with embedded images?"
        onCancel={() => setDeleteRequest(null)}
        onConfirm={() => {
          if (deleteRequest) void deletePreparedEntry(deleteRequest.entry, deleteRequest.preview, cleanupIds);
        }}
      >
        <div className={styles.cleanupList}>
          {deleteRequest?.preview.assets.map((asset) => (
            <Checkbox
              checked={cleanupIds.includes(asset.id)}
              disabled={!asset.cleanupAllowed}
              key={asset.id}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setCleanupIds((ids) => checked ? [...ids, asset.id] : ids.filter((id) => id !== asset.id));
              }}
            >
              <span>{asset.displayName}{asset.reason ? ` — ${asset.reason}` : ''}</span>
            </Checkbox>
          ))}
        </div>
      </ConfirmModal>

      <Modal accessibleLabel="Journal error" isOpen={Boolean(error)} onDismiss={() => setError(null)}>
        <h2>Journal</h2>
        <p role="alert">{error}</p>
        <Button onClick={() => setError(null)}>Close</Button>
      </Modal>
    </>
  );
}
