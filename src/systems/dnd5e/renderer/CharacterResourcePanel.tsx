import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { InlineInput } from '../../../components/ui/InlineInput';
import { DELETE_CONFIRMATION_TIMEOUT_MS } from '../../../components/ui/deleteConfirmation';
import {
  ContextMenuController,
  type ContextMenuEntry,
} from '../../../components/ui/contextMenu';
import { OrderedCollectionController } from '../../../components/ui/orderedCollection';
import {
  MAX_DND5E_CHARACTER_FIELD_CODE_UNITS,
  MAX_DND5E_CHARACTER_RESOURCES,
  parseDnd5eSafeInteger,
  type Dnd5eCharacterResource,
  type Dnd5eCharacterResourceMutation,
} from '../characterData';
import { CharacterSheetAddEntryButton } from './CharacterSheetAddEntryButton';
import styles from './CharacterSheetModal.module.css';

interface CharacterResourcePanelProps {
  canEdit: boolean;
  onChange: (mutation: Dnd5eCharacterResourceMutation) => boolean;
  onCommit: (mutation: Dnd5eCharacterResourceMutation) => Promise<boolean>;
  onSave: () => Promise<boolean>;
  resources: readonly Dnd5eCharacterResource[];
}

interface ResourceReorderState {
  activeId: string;
  orderedIds: readonly string[];
  x: number;
  y: number;
}

function resourceLabel(resource: Dnd5eCharacterResource): string {
  return resource.name.trim() || 'Unnamed Resource';
}

export function CharacterResourcePanel({
  canEdit,
  onChange,
  onCommit,
  onSave,
  resources,
}: CharacterResourcePanelProps) {
  const [numericBuffers, setNumericBuffers] = useState<Readonly<Record<string, string>>>({});
  const [focusResourceId, setFocusResourceId] = useState<string | null>(null);
  const [reorderState, setReorderState] = useState<ResourceReorderState | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<ContextMenuController | null>(null);
  const orderRef = useRef<OrderedCollectionController | null>(null);

  useEffect(() => {
    menuRef.current = new ContextMenuController({
      deleteItem: styles.contextMenuDelete,
      divider: styles.contextMenuDivider,
      item: styles.contextMenuItem,
      menu: styles.contextMenu,
    });
    return () => menuRef.current?.close();
  }, []);

  useEffect(() => {
    if (!focusResourceId) return;
    const input = listRef.current?.querySelector<HTMLInputElement>(
      `[data-resource-order-id="${focusResourceId}"] [data-resource-name]`,
    );
    if (!input) return;
    input.focus();
    input.select();
    setFocusResourceId(null);
  }, [focusResourceId, resources]);

  const displayedResources = useMemo(() => {
    if (!reorderState) return resources;
    const ordered = reorderState.orderedIds.flatMap((id) =>
      resources.find((resource) => resource.id === id) ?? [],
    );
    const orderedIds = new Set(ordered.map(({ id }) => id));
    return [...ordered, ...resources.filter(({ id }) => !orderedIds.has(id))];
  }, [reorderState, resources]);

  const beginReorder = (
    resource: Dnd5eCharacterResource,
    x: number,
    y: number,
  ) => {
    const controller = new OrderedCollectionController(
      () => resources.map(({ id }) => id),
      (orderedIds) => onCommit({ kind: 'reorder', orderedIds }),
    );
    orderRef.current = controller;
    const snapshot = controller.begin(resource.id);
    if (snapshot) {
      setReorderState({
        activeId: snapshot.activeId,
        orderedIds: snapshot.orderedIds,
        x,
        y,
      });
    }
  };

  useEffect(() => {
    if (!reorderState) return undefined;
    const move = (event: PointerEvent) => {
      const list = listRef.current;
      const target = (event.target as Element | null)?.closest<HTMLElement>(
        '[data-resource-order-id]',
      );
      let snapshot = orderRef.current?.active;
      if (list) {
        const bounds = list.getBoundingClientRect();
        if (event.clientY < bounds.top + 30) list.scrollBy({ top: -20 });
        else if (event.clientY > bounds.bottom - 30) list.scrollBy({ top: 20 });
      }
      if (target) {
        const index = snapshot?.orderedIds.indexOf(target.dataset.resourceOrderId!) ?? 0;
        const after = event.clientY >
          target.getBoundingClientRect().top + target.offsetHeight / 2;
        snapshot = orderRef.current?.placeAt(index + (after ? 1 : 0));
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
      if (event.button === 2 || !listRef.current?.contains(event.target as Node)) {
        orderRef.current?.cancel();
        setReorderState(null);
      } else if (event.button === 0) {
        event.preventDefault();
        void orderRef.current?.commit().then(() => setReorderState(null));
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        orderRef.current?.cancel();
        setReorderState(null);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const snapshot = orderRef.current?.step(event.key === 'ArrowUp' ? 'up' : 'down');
        if (snapshot) {
          setReorderState((current) => current
            ? { ...current, orderedIds: snapshot.orderedIds }
            : current);
        }
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void orderRef.current?.commit().then(() => setReorderState(null));
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

  const openContextMenu = (
    event: ReactMouseEvent,
    resource: Dnd5eCharacterResource,
  ) => {
    if (!canEdit) return;
    event.preventDefault();
    const index = resources.findIndex(({ id }) => id === resource.id);
    let deleteArmedUntil = 0;
    const entries: ContextMenuEntry[] = [
      {
        disabled: index <= 0,
        kind: 'action',
        label: 'Move Resource Up',
        onSelect: () => void onCommit({ direction: 'up', id: resource.id, kind: 'move' }),
      },
      {
        disabled: index === resources.length - 1,
        kind: 'action',
        label: 'Move Resource Down',
        onSelect: () => void onCommit({ direction: 'down', id: resource.id, kind: 'move' }),
      },
      {
        kind: 'action',
        label: 'Reorder Resource Freely',
        onSelect: () => beginReorder(resource, event.clientX, event.clientY),
      },
      { kind: 'divider' },
      {
        danger: true,
        kind: 'action',
        label: 'Delete Resource',
        onSelect: (button) => {
          const now = Date.now();
          if (now > deleteArmedUntil) {
            deleteArmedUntil = now + DELETE_CONFIRMATION_TIMEOUT_MS;
            const armedUntil = deleteArmedUntil;
            button.textContent = 'Confirm Delete Resource';
            button.setAttribute(
              'aria-label',
              `Confirm deletion of ${resourceLabel(resource)}`,
            );
            button.setAttribute('aria-pressed', 'true');
            window.setTimeout(() => {
              if (
                button.isConnected &&
                deleteArmedUntil === armedUntil &&
                Date.now() >= armedUntil
              ) {
                button.textContent = 'Delete Resource';
                button.removeAttribute('aria-label');
                button.setAttribute('aria-pressed', 'false');
              }
            }, DELETE_CONFIRMATION_TIMEOUT_MS);
            return false;
          }
          void onCommit({ id: resource.id, kind: 'delete' });
        },
      },
    ];
    menuRef.current?.open(
      event.clientX,
      event.clientY,
      `${resourceLabel(resource)} actions`,
      entries,
      () => listRef.current
        ?.querySelector<HTMLElement>(`[data-resource-order-id="${resource.id}"] input`)
        ?.focus(),
      listRef.current?.closest('dialog') ?? undefined,
    );
  };

  const commitNumeric = (
    resource: Dnd5eCharacterResource,
    field: 'current' | 'maximum',
  ) => {
    const key = `${resource.id}.${field}`;
    const buffered = numericBuffers[key];
    if (buffered === undefined) {
      void onSave();
      return;
    }
    setNumericBuffers((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    const value = buffered.trim() === '' ? 0 : parseDnd5eSafeInteger(buffered);
    if (value === null || !onChange({
      changes: { [field]: value },
      id: resource.id,
      kind: 'update',
    })) {
      return;
    }
    void onSave();
  };

  return (
    <>
      <div className={styles.resourcePanelBody}>
        <div
          aria-label="Character resources"
          className={styles.resourceList}
          ref={listRef}
          role="list"
        >
          {displayedResources.map((resource) => {
            const label = resourceLabel(resource);
            return (
              <div
                className={styles.resourceRow}
                data-reordering={reorderState?.activeId === resource.id}
                data-resource-order-id={resource.id}
                key={resource.id}
                onContextMenu={(event) => openContextMenu(event, resource)}
                role="listitem"
              >
                <InlineInput
                  aria-label={`${label} name`}
                  autoComplete="off"
                  className={styles.resourceNameInput}
                  data-resource-name
                  maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                  readOnly={!canEdit}
                  value={resource.name}
                  onBlur={() => void onSave()}
                  onChange={(event) => onChange({
                    changes: { name: event.currentTarget.value },
                    id: resource.id,
                    kind: 'update',
                  })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
                <div className={styles.resourceValues} data-resource-values>
                  {(['current', 'maximum'] as const).map((field, index) => {
                    const key = `${resource.id}.${field}`;
                    const displayedValue = numericBuffers[key] ?? String(resource[field]);
                    return (
                      <span className={styles.resourceValueSlot} key={field}>
                        {index === 1 ? <span aria-hidden>/</span> : null}
                        <InlineInput
                          aria-label={`${label} ${field}`}
                          autoComplete="off"
                          className={styles.resourceValueInput}
                          inputMode="numeric"
                          maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                          readOnly={!canEdit}
                          size={Math.max(1, displayedValue.length)}
                          value={displayedValue}
                          onBlur={() => commitNumeric(resource, field)}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setNumericBuffers((current) => ({
                              ...current,
                              [key]: value,
                            }));
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                          }}
                        />
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className={styles.panelAddRow}>
          <CharacterSheetAddEntryButton
            disabled={!canEdit || resources.length >= MAX_DND5E_CHARACTER_RESOURCES}
            label="Add Resource"
            onClick={() => {
              const resource: Dnd5eCharacterResource = {
                current: 0,
                id: crypto.randomUUID(),
                maximum: 0,
                name: 'New Resource',
              };
              if (!onChange({ kind: 'add', resource })) return;
              setFocusResourceId(resource.id);
              void onSave();
            }}
          />
        </div>
      </div>
      {reorderState ? (
        <div
          className={styles.reorderGhost}
          style={{ left: reorderState.x + 12, top: reorderState.y + 12 }}
        >
          Move {resourceLabel(
            resources.find(({ id }) => id === reorderState.activeId) ?? {
              current: 0,
              id: reorderState.activeId,
              maximum: 0,
              name: 'Resource',
            },
          )}
        </div>
      ) : null}
    </>
  );
}
