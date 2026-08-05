import { BookOpen } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { Button } from '../../components/ui/Button';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { Modal } from '../../components/ui/Modal';
import {
  ContextMenuController,
  type ContextMenuEntry,
} from '../../components/ui/contextMenu';
import { OrderedCollectionController } from '../../components/ui/orderedCollection';
import type { AssetApi } from '../../shared/assets';
import type {
  JournalApi,
  JournalDeletePreview,
  JournalEntrySummary,
  JournalManifest,
  JournalPermissionSubject,
} from '../../shared/journal';
import { DELETE_CONFIRMATION_TIMEOUT_MS } from '../connection/useDeleteConfirmation';
import {
  SidebarCollectionGroup,
  SidebarCollectionPanel,
} from './SidebarCollectionPanel';
import { NoteModal } from './journal/NoteModal';
import styles from './JournalPanel.module.css';

interface JournalPanelProps {
  assetApi?: AssetApi;
  campaignId?: string;
  journalApi?: JournalApi;
  role?: 'gm' | 'player';
}

export function JournalPanel({
  assetApi,
  campaignId = '',
  journalApi,
  role = 'gm',
}: JournalPanelProps = {}) {
  if (!assetApi || !journalApi || !campaignId) {
    return <JournalEmptyShell />;
  }
  return (
    <ConnectedJournalPanel
      assetApi={assetApi}
      campaignId={campaignId}
      journalApi={journalApi}
      role={role}
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
}: Required<JournalPanelProps>) {
  const [manifest, setManifest] = useState<JournalManifest | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [selected, setSelected] = useState<{
    note: JournalEntrySummary;
    pageId?: string;
    showPermissions?: boolean;
  } | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<{
    note: JournalEntrySummary;
    preview: JournalDeletePreview;
  } | null>(null);
  const [cleanupIds, setCleanupIds] = useState<string[]>([]);
  const [users, setUsers] = useState<JournalPermissionSubject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reorderState, setReorderState] = useState<{
    activeId: string;
    orderedIds: readonly string[];
    x: number;
    y: number;
  } | null>(null);
  const menu = useRef<ContextMenuController | null>(null);
  const refreshRequestRef = useRef(0);
  const rowsRef = useRef<HTMLUListElement>(null);
  const reorder = useRef<OrderedCollectionController | null>(null);

  const refresh = useCallback(async () => {
    const request = ++refreshRequestRef.current;
    const result = await journalApi.list({ campaignId });
    if (request !== refreshRequestRef.current) return;
    if (result.ok) setManifest(result.value);
    else setError(result.error.message);
  }, [campaignId, journalApi]);

  const acceptUpdatedNote = useCallback((updated: JournalEntrySummary | null) => {
    if (!updated) {
      void refresh();
      return;
    }
    setManifest((current) => current
      ? {
          ...current,
          entries: current.entries.map((entry) =>
            entry.id === updated.id ? updated : entry,
          ),
        }
      : current);
  }, [refresh]);

  useEffect(() => {
    let active = true;
    const remove = journalApi.onChanged((event) => {
      if (event.campaignId === campaignId) void refresh();
    });
    void Promise.resolve().then(() => {
      if (active) return refresh();
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
    menu.current = new ContextMenuController({
      deleteItem: styles.contextDelete,
      divider: styles.contextDivider,
      item: styles.contextItem,
      menu: styles.contextMenu,
    });
    return () => menu.current?.close();
  }, []);

  const notes = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    if (!search) return manifest?.entries ?? [];
    return (manifest?.entries ?? []).filter(
      (note) =>
        note.name.toLocaleLowerCase().includes(search) ||
        note.pages.some((page) =>
          page.title.toLocaleLowerCase().includes(search),
        ),
    );
  }, [manifest, query]);

  const beginReorder = (note: JournalEntrySummary, event: MouseEvent) => {
    setQuery('');
    setExpanded(true);
    const controller = new OrderedCollectionController(
      () => manifest?.entries.map(({ id }) => id) ?? [],
      async (orderedIds) => {
        if (!manifest) return false;
        const result = await journalApi.reorderNotes({
          campaignId,
          expectedManifestRevision: manifest.revision,
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
    const snapshot = controller.begin(note.id);
    if (snapshot) {
      setReorderState({
        activeId: note.id,
        orderedIds: snapshot.orderedIds,
        x: event.clientX,
        y: event.clientY,
      });
    }
  };

  useEffect(() => {
    if (!reorderState) return undefined;
    const move = (event: PointerEvent) => {
      const list = rowsRef.current;
      if (list) {
        const bounds = list.getBoundingClientRect();
        if (event.clientY < bounds.top + 30) {
          list.scrollBy({ top: -20 });
        } else if (event.clientY > bounds.bottom - 30) {
          list.scrollBy({ top: 20 });
        }
      }
      const target = (event.target as Element | null)?.closest<HTMLElement>(
        '[data-journal-order-id]',
      );
      let snapshot = reorder.current?.active;
      if (target) {
        const index =
          snapshot?.orderedIds.indexOf(target.dataset.journalOrderId!) ?? 0;
        const after =
          event.clientY >
          target.getBoundingClientRect().top + target.offsetHeight / 2;
        snapshot = reorder.current?.placeAt(index + (after ? 1 : 0));
      }
      if (snapshot) {
        setReorderState({
          activeId: snapshot.activeId,
          orderedIds: snapshot.orderedIds,
          x: event.clientX,
          y: event.clientY,
        });
      }
    };
    const down = (event: PointerEvent) => {
      if (
        event.button === 2 ||
        !rowsRef.current?.contains(event.target as Node)
      ) {
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
        const snapshot = reorder.current?.step(
          event.key === 'ArrowUp' ? 'up' : 'down',
        );
        if (snapshot) {
          setReorderState((current) =>
            current ? { ...current, orderedIds: snapshot.orderedIds } : current,
          );
        }
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

  const deletePreparedNote = async (
    note: JournalEntrySummary,
    preview: JournalDeletePreview,
    selectedCleanupIds: string[],
  ) => {
    const result = await journalApi.deleteTarget({
      campaignId,
      cleanupAssetIds: selectedCleanupIds,
      expectedRevision: note.revision,
      target: preview.target,
    });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setDeleteRequest(null);
    setSelected((current) =>
      current?.note.id === note.id ? null : current,
    );
    setManifest((current) =>
      current
        ? {
            ...current,
            entries: current.entries
              .filter((entry) => entry.id !== note.id)
              .map((entry, position) => ({ ...entry, position })),
            revision: current.revision + 1,
          }
        : current,
    );
    if (result.value.cleanupFailures.length > 0) {
      setError(
        'The note was deleted, but some selected assets could not be moved to trash.',
      );
    }
  };

  const requestNoteDelete = async (note: JournalEntrySummary) => {
    const result = await journalApi.prepareDelete({
      campaignId,
      target: { entryId: note.id, kind: 'note' },
    });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (result.value.assets.length === 0) {
      await deletePreparedNote(note, result.value, []);
      return;
    }
    setCleanupIds([]);
    setDeleteRequest({ note, preview: result.value });
  };

  const openContext = (event: MouseEvent, note: JournalEntrySummary) => {
    event.preventDefault();
    const entries: ContextMenuEntry[] = [];
    if (note.capabilities.managePermissions) {
      entries.push({
        kind: 'action',
        label: 'Edit Permissions',
        onSelect: () =>
          setSelected({
            note,
            pageId: note.pages[0]?.id,
            showPermissions: true,
          }),
      });
    }
    if (note.capabilities.reorder) {
      entries.push(
        {
          disabled: note.position === 0,
          kind: 'action',
          label: 'Move Note Up',
          onSelect: () => {
            if (!manifest) return;
            void journalApi
              .moveNote({
                campaignId,
                direction: 'up',
                entryId: note.id,
                expectedManifestRevision: manifest.revision,
              })
              .then(refresh);
          },
        },
        {
          disabled: note.position === (manifest?.entries.length ?? 0) - 1,
          kind: 'action',
          label: 'Move Note Down',
          onSelect: () => {
            if (!manifest) return;
            void journalApi
              .moveNote({
                campaignId,
                direction: 'down',
                entryId: note.id,
                expectedManifestRevision: manifest.revision,
              })
              .then(refresh);
          },
        },
        {
          kind: 'action',
          label: 'Reorder Note Freely',
          onSelect: () => beginReorder(note, event),
        },
      );
    }
    if (note.capabilities.delete) {
      let deleteArmedUntil = 0;
      entries.push({
        danger: true,
        kind: 'action',
        label: 'Delete Note',
        onSelect: (button) => {
          const now = Date.now();
          if (now > deleteArmedUntil) {
            deleteArmedUntil = now + DELETE_CONFIRMATION_TIMEOUT_MS;
            const armedUntil = deleteArmedUntil;
            button.textContent = 'Confirm Delete Note';
            button.setAttribute('aria-label', `Confirm deletion of ${note.name}`);
            button.setAttribute('aria-pressed', 'true');
            window.setTimeout(() => {
              if (
                button.isConnected &&
                deleteArmedUntil === armedUntil &&
                Date.now() >= armedUntil
              ) {
                button.textContent = 'Delete Note';
                button.removeAttribute('aria-label');
                button.setAttribute('aria-pressed', 'false');
              }
            }, DELETE_CONFIRMATION_TIMEOUT_MS);
            return false;
          }
          void requestNoteDelete(note);
        },
      });
    }
    if (entries.length === 0) return;
    menu.current?.open(
      event.clientX,
      event.clientY,
      `${note.name} actions`,
      entries,
      () =>
        document
          .querySelector<HTMLElement>(
            `[data-journal-order-id="${note.id}"] button`,
          )
          ?.focus(),
    );
  };

  const orderedNotes = reorderState
    ? reorderState.orderedIds.flatMap(
        (id) => notes.find((note) => note.id === id) ?? [],
      )
    : notes;

  return (
    <>
      <SidebarCollectionPanel
        addDisabled={role !== 'gm'}
        addLabel="Add journal entry"
        clearLabel="Clear journal search"
        emptyIcon={BookOpen}
        emptyIconId="journal"
        onAdd={async () => {
          const result = await journalApi.createNote({ campaignId });
          if (!result.ok) {
            setError(result.error.message);
            return;
          }
          setManifest((current) =>
            current
              ? {
                  ...current,
                  entries: [...current.entries, result.value],
                  revision: current.revision + 1,
                }
              : current,
          );
          setSelected({
            note: result.value,
            pageId: result.value.pages[0]?.id,
          });
        }}
        onQueryChange={setQuery}
        query={query}
        searchLabel="Search journal"
        searchPlaceholder="Search journal"
        showEmpty={(manifest?.entries.length ?? 0) === 0}
      >
        {(manifest?.entries.length ?? 0) > 0 ? (
          <SidebarCollectionGroup
            expanded={expanded}
            label="Notes"
            onExpandedChange={setExpanded}
          >
            <ul className={styles.noteList} ref={rowsRef}>
              {orderedNotes.map((note) => {
                const match = query.trim().toLocaleLowerCase();
                const matchingPageId = match
                  ? note.pages.find((page) =>
                      page.title.toLocaleLowerCase().includes(match),
                    )?.id
                  : undefined;
                return (
                  <li
                    data-journal-order-id={note.id}
                    data-reordering={reorderState?.activeId === note.id}
                    key={note.id}
                    onContextMenu={(event) => openContext(event, note)}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        !reorderState &&
                        setSelected({ note, pageId: matchingPageId })
                      }
                    >
                      <BookOpen aria-hidden size="1rem" />
                      <span>{note.name}</span>
                      <small>
                        {note.pages.length}{' '}
                        {note.pages.length === 1 ? 'page' : 'pages'}
                      </small>
                    </button>
                  </li>
                );
              })}
            </ul>
          </SidebarCollectionGroup>
        ) : null}
      </SidebarCollectionPanel>

      {reorderState ? (
        <div
          className={styles.reorderGhost}
          style={{ left: reorderState.x + 12, top: reorderState.y + 12 }}
        >
          Move{' '}
          {
            manifest?.entries.find(({ id }) => id === reorderState.activeId)
              ?.name
          }
        </div>
      ) : null}

      {selected ? (
        <NoteModal
          assetApi={assetApi}
          campaignId={campaignId}
          initialPageId={selected.pageId}
          initialShowPermissions={selected.showPermissions}
          journalApi={journalApi}
          note={selected.note}
          onClose={() => setSelected(null)}
          onUpdated={acceptUpdatedNote}
          users={users}
        />
      ) : null}

      <ConfirmModal
        confirmLabel={cleanupIds.length ? 'Delete and clean up' : 'Delete'}
        isOpen={deleteRequest !== null}
        message={`“${deleteRequest?.note.name ?? 'This note'}” contains embedded Storage images. Select any images that should also be moved to trash. Unselected images stay in Storage.`}
        title="Delete note with embedded images?"
        onCancel={() => setDeleteRequest(null)}
        onConfirm={() => {
          if (deleteRequest) {
            void deletePreparedNote(
              deleteRequest.note,
              deleteRequest.preview,
              cleanupIds,
            );
          }
        }}
      >
        <div className={styles.cleanupList}>
          {deleteRequest?.preview.assets.map((asset) => (
            <label key={asset.id}>
              <input
                checked={cleanupIds.includes(asset.id)}
                disabled={!asset.cleanupAllowed}
                type="checkbox"
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setCleanupIds((ids) =>
                    checked
                      ? [...ids, asset.id]
                      : ids.filter((id) => id !== asset.id),
                  );
                }}
              />
              <span>
                {asset.displayName}
                {asset.reason ? ` — ${asset.reason}` : ''}
              </span>
            </label>
          ))}
        </div>
      </ConfirmModal>

      <Modal
        accessibleLabel="Journal error"
        isOpen={Boolean(error)}
        onDismiss={() => setError(null)}
      >
        <h2>Journal</h2>
        <p role="alert">{error}</p>
        <Button onClick={() => setError(null)}>Close</Button>
      </Modal>
    </>
  );
}
