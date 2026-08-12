import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CollapsibleStateIcon } from '../../../components/ui/Collapsible';
import { DELETE_CONFIRMATION_TIMEOUT_MS } from '../../../components/ui/deleteConfirmation';
import { Dropdown, DropdownOption } from '../../../components/ui/Dropdown';
import { InlineInput } from '../../../components/ui/InlineInput';
import {
  ContextMenuController,
  type ContextMenuEntry,
} from '../../../components/ui/contextMenu';
import {
  DND5E_INVENTORY_CONTENTS_WEIGHT,
  formatDnd5eWeight,
  MAX_DND5E_CHARACTER_FIELD_CODE_UNITS,
  MAX_DND5E_CHARACTER_INVENTORY_DEPTH,
  MAX_DND5E_CHARACTER_INVENTORY_ENTRIES,
  parseDnd5eNonnegativeSafeInteger,
  parseDnd5eNonnegativeWeight,
  type Dnd5eCharacterInventory,
  type Dnd5eCharacterInventoryEntry,
  type Dnd5eCharacterInventoryMutation,
  type Dnd5eCurrencyDenomination,
  type Dnd5eDerivedInventoryValues,
} from '../characterData';
import { CharacterSheetAddEntryButton } from './CharacterSheetAddEntryButton';
import styles from './CharacterSheetModal.module.css';

interface CharacterInventoryPanelProps {
  canEdit: boolean;
  canSendToChat: boolean;
  derived: Dnd5eDerivedInventoryValues;
  inventory: Dnd5eCharacterInventory;
  onChange: (mutation: Dnd5eCharacterInventoryMutation) => boolean;
  onCommit: (mutation: Dnd5eCharacterInventoryMutation) => Promise<boolean>;
  onSave: () => Promise<boolean>;
  onSendToChat: (entry: Dnd5eCharacterInventoryEntry) => void;
}

interface InventoryLocation {
  depth: number;
  entry: Dnd5eCharacterInventoryEntry;
  index: number;
  parentId: string | null;
  siblings: readonly Dnd5eCharacterInventoryEntry[];
}

interface InventoryPlacement {
  beforeId: string | null;
  parentId: string | null;
}

interface InventoryReorderState {
  activeId: string;
  placement: InventoryPlacement;
  temporaryExpandedIds: readonly string[];
}

const CURRENCY: ReadonlyArray<{
  id: Dnd5eCurrencyDenomination;
  label: string;
}> = [
    { id: 'copper', label: 'Copper' },
    { id: 'silver', label: 'Silver' },
    { id: 'gold', label: 'Gold' },
    { id: 'platinum', label: 'Platinum' },
  ];

function entryLabel(entry: Dnd5eCharacterInventoryEntry): string {
  return entry.name.trim() || (entry.kind === 'container'
    ? 'Unnamed Container'
    : 'Unnamed Item');
}

function entryCount(entries: readonly Dnd5eCharacterInventoryEntry[]): number {
  return entries.reduce(
    (total, entry) => total + 1 + (entry.kind === 'container'
      ? entryCount(entry.contents)
      : 0),
    0,
  );
}

function containerCapacityWarnings(
  entries: readonly Dnd5eCharacterInventoryEntry[],
  derived: Dnd5eDerivedInventoryValues,
): string[] {
  const warnings: string[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'container') continue;
    if (derived.containers[entry.id]?.overCapacity) {
      warnings.push(`${entryLabel(entry)} is over capacity.`);
    }
    warnings.push(...containerCapacityWarnings(entry.contents, derived));
  }
  return warnings;
}

function subtreeHeight(entry: Dnd5eCharacterInventoryEntry): number {
  if (entry.kind === 'item' || entry.contents.length === 0) return 1;
  return 1 + Math.max(...entry.contents.map(subtreeHeight));
}

function descendantIds(entry: Dnd5eCharacterInventoryEntry): Set<string> {
  const ids = new Set<string>([entry.id]);
  if (entry.kind === 'container') {
    for (const child of entry.contents) {
      for (const id of descendantIds(child)) ids.add(id);
    }
  }
  return ids;
}

function findEntry(
  entries: readonly Dnd5eCharacterInventoryEntry[],
  id: string,
  parentId: string | null = null,
  depth = 1,
): InventoryLocation | null {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.id === id) {
      return { depth, entry, index, parentId, siblings: entries };
    }
    if (entry.kind === 'container') {
      const nested = findEntry(entry.contents, id, entry.id, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function containerPath(
  entries: readonly Dnd5eCharacterInventoryEntry[],
  id: string,
  path: readonly string[] = [],
): readonly string[] {
  for (const entry of entries) {
    if (entry.kind !== 'container') continue;
    const nextPath = [...path, entry.id];
    if (entry.id === id) return nextPath;
    const nested = containerPath(entry.contents, id, nextPath);
    if (nested.length > 0) return nested;
  }
  return [];
}

function samePlacement(left: InventoryPlacement, right: InventoryPlacement): boolean {
  return left.beforeId === right.beforeId && left.parentId === right.parentId;
}

function placementOptions(
  inventory: Dnd5eCharacterInventory,
  activeId: string,
): InventoryPlacement[] {
  const active = findEntry(inventory.entries, activeId);
  if (!active) return [];
  const excluded = descendantIds(active.entry);
  const height = subtreeHeight(active.entry);
  const placements: InventoryPlacement[] = [];

  const visit = (
    entries: readonly Dnd5eCharacterInventoryEntry[],
    parentId: string | null,
    parentDepth: number,
  ) => {
    if (parentDepth + height > MAX_DND5E_CHARACTER_INVENTORY_DEPTH) return;
    const siblings = entries.filter(({ id }) => id !== activeId);
    for (const entry of siblings) {
      placements.push({ beforeId: entry.id, parentId });
    }
    placements.push({ beforeId: null, parentId });
    for (const entry of siblings) {
      if (entry.kind === 'container' && !excluded.has(entry.id)) {
        visit(entry.contents, entry.id, parentDepth + 1);
      }
    }
  };

  visit(inventory.entries, null, 0);
  return placements;
}

function parentAttribute(parentId: string | null): string {
  return parentId ?? 'root';
}

function parseParentAttribute(value: string | undefined): string | null {
  return !value || value === 'root' ? null : value;
}

function reorderGhostTransform(x: number, y: number): string {
  return `translate3d(${x + 12}px, ${y + 12}px, 0)`;
}

function removeEntryForPreview(
  entries: readonly Dnd5eCharacterInventoryEntry[],
  activeId: string,
): Dnd5eCharacterInventoryEntry[] {
  const next: Dnd5eCharacterInventoryEntry[] = [];
  for (const entry of entries) {
    if (entry.id === activeId) continue;
    next.push(entry.kind === 'item'
      ? entry
      : {
        ...entry,
        contents: removeEntryForPreview(entry.contents, activeId),
      });
  }
  return next;
}

function insertEntryForPreview(
  entries: readonly Dnd5eCharacterInventoryEntry[],
  entry: Dnd5eCharacterInventoryEntry,
  placement: InventoryPlacement,
): { entries: Dnd5eCharacterInventoryEntry[]; inserted: boolean } {
  if (placement.parentId === null) {
    const next = [...entries];
    const beforeIndex = placement.beforeId === null
      ? -1
      : next.findIndex(({ id }) => id === placement.beforeId);
    next.splice(beforeIndex < 0 ? next.length : beforeIndex, 0, entry);
    return { entries: next, inserted: true };
  }

  let inserted = false;
  const next = entries.map((candidate) => {
    if (candidate.kind === 'item' || inserted) return candidate;
    if (candidate.id === placement.parentId) {
      const contents = [...candidate.contents];
      const beforeIndex = placement.beforeId === null
        ? -1
        : contents.findIndex(({ id }) => id === placement.beforeId);
      contents.splice(beforeIndex < 0 ? contents.length : beforeIndex, 0, entry);
      inserted = true;
      return { ...candidate, contents };
    }
    const nested = insertEntryForPreview(candidate.contents, entry, placement);
    if (!nested.inserted) return candidate;
    inserted = true;
    return { ...candidate, contents: nested.entries };
  });
  return { entries: next, inserted };
}

function previewInventoryPlacement(
  entries: readonly Dnd5eCharacterInventoryEntry[],
  activeId: string,
  placement: InventoryPlacement,
): readonly Dnd5eCharacterInventoryEntry[] {
  const active = findEntry(entries, activeId);
  if (!active) return entries;
  const previewEntry = active.parentId === placement.parentId
    ? active.entry
    : { ...active.entry, equipped: true };
  const preview = insertEntryForPreview(
    removeEntryForPreview(entries, activeId),
    previewEntry,
    placement,
  );
  return preview.inserted ? preview.entries : entries;
}

export function CharacterInventoryPanel({
  canEdit,
  canSendToChat,
  derived,
  inventory,
  onChange,
  onCommit,
  onSave,
  onSendToChat,
}: CharacterInventoryPanelProps) {
  const [numericBuffers, setNumericBuffers] = useState<Readonly<Record<string, string>>>({});
  const [focusEntryId, setFocusEntryId] = useState<string | null>(null);
  const [reorderState, setReorderState] = useState<InventoryReorderState | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const reorderGhostRef = useRef<HTMLDivElement | null>(null);
  const reorderPointerRef = useRef({ x: 0, y: 0 });
  const menuRef = useRef<ContextMenuController | null>(null);
  const setReorderGhostRef = useCallback((element: HTMLDivElement | null) => {
    reorderGhostRef.current = element;
    if (!element) return;
    element.style.transform = reorderGhostTransform(
      reorderPointerRef.current.x,
      reorderPointerRef.current.y,
    );
  }, []);
  const totalEntries = useMemo(() => entryCount(inventory.entries), [inventory.entries]);
  const placements = useMemo(
    () => reorderState ? placementOptions(inventory, reorderState.activeId) : [],
    [inventory, reorderState],
  );
  const displayedEntries = useMemo(
    () => reorderState
      ? previewInventoryPlacement(
        inventory.entries,
        reorderState.activeId,
        reorderState.placement,
      )
      : inventory.entries,
    [inventory.entries, reorderState],
  );

  useEffect(() => {
    menuRef.current = new ContextMenuController();
    return () => menuRef.current?.close();
  }, []);

  useEffect(() => {
    if (!focusEntryId) return;
    const input = treeRef.current?.querySelector<HTMLInputElement>(
      `[data-inventory-entry-id="${focusEntryId}"] [data-inventory-name]`,
    );
    if (!input) return;
    input.focus();
    input.select();
    setFocusEntryId(null);
  }, [focusEntryId, inventory]);

  const commitReorder = useCallback((state: InventoryReorderState) => {
    void onCommit({
      beforeId: state.placement.beforeId,
      id: state.activeId,
      kind: 'place',
      parentId: state.placement.parentId,
    }).then((saved) => {
      if (saved) setReorderState(null);
    });
  }, [onCommit]);

  useEffect(() => {
    if (!reorderState) return undefined;
    const positionGhost = (x: number, y: number) => {
      reorderPointerRef.current = { x, y };
      if (!reorderGhostRef.current) return;
      reorderGhostRef.current.style.transform = reorderGhostTransform(x, y);
    };
    const setPlacement = (
      placement: InventoryPlacement,
      expandId?: string,
    ) => {
      if (!placements.some((candidate) => samePlacement(candidate, placement))) return;
      if (
        samePlacement(reorderState.placement, placement) &&
        (!expandId || reorderState.temporaryExpandedIds.includes(expandId))
      ) return;
      setReorderState((current) => {
        if (!current) return current;
        const shouldExpand = expandId && !current.temporaryExpandedIds.includes(expandId);
        if (samePlacement(current.placement, placement) && !shouldExpand) return current;
        return {
          ...current,
          placement,
          temporaryExpandedIds: shouldExpand
            ? [...current.temporaryExpandedIds, expandId]
            : current.temporaryExpandedIds,
        };
      });
    };
    const move = (event: PointerEvent) => {
      positionGhost(event.clientX, event.clientY);
      const target = event.target as Element | null;
      const row = target?.closest<HTMLElement>('[data-inventory-reorder-row]');
      const rowEntry = row?.closest<HTMLElement>('[data-inventory-entry-id]');
      const list = target?.closest<HTMLElement>('[data-inventory-list-parent]');
      const viewport = treeRef.current?.closest<HTMLElement>(
        '[data-character-sheet-viewport]',
      );
      if (viewport && typeof viewport.scrollBy === 'function') {
        const bounds = viewport.getBoundingClientRect();
        if (event.clientY < bounds.top + 30) viewport.scrollBy({ top: -20 });
        else if (event.clientY > bounds.bottom - 30) viewport.scrollBy({ top: 20 });
      }
      if (list && (!row || !list.contains(row))) {
        setPlacement(
          {
            beforeId: null,
            parentId: parseParentAttribute(list.dataset.inventoryListParent),
          },
        );
        return;
      }
      if (row && rowEntry) {
        const targetId = rowEntry.dataset.inventoryEntryId!;
        const targetEntry = findEntry(inventory.entries, targetId);
        const active = findEntry(inventory.entries, reorderState.activeId);
        if (!targetEntry || !active || descendantIds(active.entry).has(targetId)) return;
        const siblings = targetEntry.siblings.filter(({ id }) => id !== active.entry.id);
        const targetIndex = siblings.findIndex(({ id }) => id === targetId);
        const after = event.clientY >
          row.getBoundingClientRect().top + row.offsetHeight / 2;
        const beforeId = after ? siblings[targetIndex + 1]?.id ?? null : targetId;
        const expandId = targetEntry.entry.kind === 'container' &&
          targetEntry.entry.collapsed
          ? targetEntry.entry.id
          : undefined;
        setPlacement(
          { beforeId, parentId: targetEntry.parentId },
          expandId,
        );
        return;
      }
      if (!list) return;
      setPlacement(
        {
          beforeId: null,
          parentId: parseParentAttribute(list.dataset.inventoryListParent),
        },
      );
    };
    const down = (event: PointerEvent) => {
      if (event.button === 2 || !treeRef.current?.contains(event.target as Node)) {
        setReorderState(null);
      } else if (event.button === 0) {
        event.preventDefault();
        commitReorder(reorderState);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setReorderState(null);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const currentIndex = placements.findIndex((placement) =>
          samePlacement(placement, reorderState.placement),
        );
        if (placements.length === 0) return;
        const nextIndex = Math.max(
          0,
          Math.min(
            placements.length - 1,
            currentIndex + (event.key === 'ArrowDown' ? 1 : -1),
          ),
        );
        const placement = placements[nextIndex];
        const expanded = placement.parentId === null
          ? []
          : containerPath(inventory.entries, placement.parentId);
        setReorderState((current) => current
          ? {
            ...current,
            placement,
            temporaryExpandedIds: [...new Set([
              ...current.temporaryExpandedIds,
              ...expanded,
            ])],
          }
          : current);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        commitReorder(reorderState);
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
  }, [commitReorder, inventory, placements, reorderState]);

  const beginReorder = (
    entry: Dnd5eCharacterInventoryEntry,
    x: number,
    y: number,
  ) => {
    const location = findEntry(inventory.entries, entry.id);
    if (!location) return;
    reorderPointerRef.current = { x, y };
    setReorderState({
      activeId: entry.id,
      placement: {
        beforeId: location.siblings[location.index + 1]?.id ?? null,
        parentId: location.parentId,
      },
      temporaryExpandedIds: [],
    });
  };

  const openContextMenu = (
    entry: Dnd5eCharacterInventoryEntry,
    position: { clientX: number; clientY: number },
    returnFocus: () => void,
    mount?: HTMLElement,
  ) => {
    if (!canEdit && !canSendToChat) return;
    const location = findEntry(inventory.entries, entry.id);
    if (!location) return;
    const typeLabel = entry.kind === 'container' ? 'Container' : 'Item';
    let deleteArmedUntil = 0;
    const entries: ContextMenuEntry[] = [
      {
        disabled: !canSendToChat,
        kind: 'action',
        label: 'Send To Chat',
        onSelect: () => onSendToChat(entry),
      },
    ];
    if (canEdit) entries.push(
      {
        disabled: location.index <= 0,
        kind: 'action',
        label: `Move ${typeLabel} Up`,
        onSelect: () => void onCommit({
          direction: 'up',
          id: entry.id,
          kind: 'move',
        }),
      },
      {
        disabled: location.index === location.siblings.length - 1,
        kind: 'action',
        label: `Move ${typeLabel} Down`,
        onSelect: () => void onCommit({
          direction: 'down',
          id: entry.id,
          kind: 'move',
        }),
      },
      {
        kind: 'action',
        label: `Reorder ${typeLabel} Freely`,
        onSelect: () => beginReorder(
          entry,
          position.clientX,
          position.clientY,
        ),
      },
      { kind: 'divider' },
      {
        danger: true,
        kind: 'action',
        label: `Delete ${typeLabel}`,
        onSelect: (button) => {
          const now = Date.now();
          if (now > deleteArmedUntil) {
            deleteArmedUntil = now + DELETE_CONFIRMATION_TIMEOUT_MS;
            const armedUntil = deleteArmedUntil;
            button.textContent = `Confirm Delete ${typeLabel}`;
            button.setAttribute('aria-label', `Confirm deletion of ${entryLabel(entry)}`);
            button.setAttribute('aria-pressed', 'true');
            window.setTimeout(() => {
              if (
                button.isConnected &&
                deleteArmedUntil === armedUntil &&
                Date.now() >= armedUntil
              ) {
                button.textContent = `Delete ${typeLabel}`;
                button.removeAttribute('aria-label');
                button.setAttribute('aria-pressed', 'false');
              }
            }, DELETE_CONFIRMATION_TIMEOUT_MS);
            return false;
          }
          void onCommit({ id: entry.id, kind: 'delete' });
        },
      },
    );
    menuRef.current?.open(
      position.clientX,
      position.clientY,
      `${entryLabel(entry)} actions`,
      entries,
      returnFocus,
      mount,
    );
  };

  const clearNumericBuffer = (key: string) => {
    setNumericBuffers((current) => {
      if (!Object.hasOwn(current, key)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const commitEntryNumber = (
    entry: Dnd5eCharacterInventoryEntry,
    field: 'capacity' | 'quantity' | 'weight',
  ) => {
    const key = `${entry.id}.${field}`;
    const buffered = numericBuffers[key];
    if (buffered === undefined) {
      void onSave();
      return;
    }
    clearNumericBuffer(key);
    const value = field === 'capacity' && buffered.trim() === ''
      ? null
      : buffered.trim() === ''
        ? 0
        : field === 'weight'
          ? parseDnd5eNonnegativeWeight(buffered)
          : parseDnd5eNonnegativeSafeInteger(buffered);
    if (value === null && !(field === 'capacity' && buffered.trim() === '')) return;
    if (!onChange({ changes: { [field]: value }, id: entry.id, kind: 'update' })) return;
    void onSave();
  };

  const commitCurrency = (denomination: Dnd5eCurrencyDenomination) => {
    const key = `currency.${denomination}`;
    const buffered = numericBuffers[key];
    if (buffered === undefined) {
      void onSave();
      return;
    }
    clearNumericBuffer(key);
    const value = buffered.trim() === ''
      ? 0
      : parseDnd5eNonnegativeSafeInteger(buffered);
    if (value === null || !onChange({
      denomination,
      kind: 'set-currency',
      value,
    })) return;
    void onSave();
  };

  const addEntry = (parentId: string | null, kind: 'container' | 'item') => {
    if (totalEntries >= MAX_DND5E_CHARACTER_INVENTORY_ENTRIES) return;
    const common = {
      equipped: true,
      id: crypto.randomUUID(),
      name: kind === 'container' ? 'New Container' : 'New Item',
      weight: 0,
    };
    const entry: Dnd5eCharacterInventoryEntry = kind === 'container'
      ? {
        ...common,
        capacity: null,
        collapsed: false,
        contents: [],
        contentsWeight: 'normal',
        kind,
      }
      : { ...common, kind, quantity: 1 };
    if (!onChange({ entry, kind: 'add', parentId })) return;
    setFocusEntryId(entry.id);
    void onSave();
  };

  const temporaryExpanded = new Set(reorderState?.temporaryExpandedIds ?? []);
  const renderEntries = (
    entries: readonly Dnd5eCharacterInventoryEntry[],
    parentId: string | null,
    depth: number,
  ) => {
    return (
      <div
        aria-label={parentId === null ? 'Character inventory entries' : undefined}
        className={styles.inventoryList}
        data-inventory-list-parent={parentAttribute(parentId)}
        role="list"
      >
        {entries.map((entry) => {
          const label = entryLabel(entry);
          const containerValues = entry.kind === 'container'
            ? derived.containers[entry.id]
            : null;
          const expanded = entry.kind === 'container' &&
            (!entry.collapsed || temporaryExpanded.has(entry.id));
          const weightKey = `${entry.id}.weight`;
          const weightValue = numericBuffers[weightKey] ?? String(entry.weight);
          const quantityKey = `${entry.id}.quantity`;
          const quantityValue = entry.kind === 'item'
            ? numericBuffers[quantityKey] ?? String(entry.quantity)
            : '';
          return (
            <div
              className={styles.inventoryEntry}
              data-inventory-entry-id={entry.id}
              data-reordering={reorderState?.activeId === entry.id || undefined}
              key={entry.id}
              role="listitem"
            >
              <div
                className={styles.inventoryEntryRow}
                data-inventory-reorder-row
                data-kind={entry.kind}
                data-nested={depth > 1 || undefined}
                onContextMenu={(event) => {
                  if (!canEdit && !canSendToChat) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const focused = event.target instanceof HTMLElement
                    ? event.target
                    : null;
                  openContextMenu(
                    entry,
                    event,
                    () => focused?.focus(),
                    event.currentTarget.closest('dialog') ?? undefined,
                  );
                }}
                onKeyDown={(event) => {
                  if (
                    event.key !== 'ContextMenu' &&
                    !(event.shiftKey && event.key === 'F10')
                  ) return;
                  event.preventDefault();
                  const focused = event.target instanceof HTMLElement
                    ? event.target
                    : null;
                  const bounds = event.currentTarget.getBoundingClientRect();
                  openContextMenu(
                    entry,
                    { clientX: bounds.left + 24, clientY: bounds.bottom },
                    () => focused?.focus(),
                    event.currentTarget.closest('dialog') ?? undefined,
                  );
                }}
              >
                {depth === 1 ? (
                  <button
                    aria-label={`${label} equipped`}
                    aria-pressed={entry.equipped}
                    className={styles.inventoryEquipped}
                    disabled={!canEdit}
                    title={entry.equipped ? `Unequip ${label}` : `Equip ${label}`}
                    type="button"
                    onClick={() => void onCommit({
                      changes: { equipped: !entry.equipped },
                      id: entry.id,
                      kind: 'update',
                    })}
                  >
                    <svg aria-hidden viewBox="0 0 8 8">
                      <circle cx="4" cy="4" r="3" />
                    </svg>
                  </button>
                ) : <span className={styles.inventoryControlSpacer} />}
                {entry.kind === 'container' ? (
                  <button
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
                    className={styles.inventoryCollapse}
                    disabled={!canEdit}
                    type="button"
                    onClick={() => void onCommit({
                      changes: { collapsed: expanded },
                      id: entry.id,
                      kind: 'update',
                    })}
                  >
                    <CollapsibleStateIcon expanded={expanded} />
                  </button>
                ) : <span className={styles.inventoryControlSpacer} />}
                <InlineInput
                  aria-label={`${label} name`}
                  autoComplete="off"
                  className={styles.inventoryNameInput}
                  data-inventory-name
                  maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                  readOnly={!canEdit}
                  title="Name"
                  value={entry.name}
                  onBlur={() => void onSave()}
                  onChange={(event) => onChange({
                    changes: { name: event.currentTarget.value },
                    id: entry.id,
                    kind: 'update',
                  })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
                {entry.kind === 'item' ? (
                  <InlineInput
                    aria-label={`${label} quantity`}
                    autoComplete="off"
                    className={styles.inventoryQuantityInput}
                    inputMode="numeric"
                    maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                    readOnly={!canEdit}
                    size={Math.max(1, quantityValue.length)}
                    title="Quantity"
                    value={quantityValue}
                    onBlur={() => commitEntryNumber(entry, 'quantity')}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setNumericBuffers((current) => ({
                        ...current,
                        [quantityKey]: value,
                      }));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                  />
                ) : null}
                <InlineInput
                  aria-label={`${label} weight in pounds`}
                  autoComplete="off"
                  className={styles.inventoryWeightInput}
                  inputMode="decimal"
                  maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                  readOnly={!canEdit}
                  size={Math.max(1, weightValue.length)}
                  title="Weight"
                  value={weightValue}
                  onBlur={() => commitEntryNumber(entry, 'weight')}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setNumericBuffers((current) => ({
                      ...current,
                      [weightKey]: value,
                    }));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
                {containerValues ? (
                  <output
                    aria-label={`${label} capacity usage`}
                    className={styles.inventoryCapacityOutput}
                    data-over-capacity={containerValues.overCapacity || undefined}
                  >
                    {formatDnd5eWeight(containerValues.usedWeightHundredths)}
                    {containerValues.capacityHundredths === null
                      ? null
                      : `/${formatDnd5eWeight(containerValues.capacityHundredths)}`}
                  </output>
                ) : <span className={styles.inventoryCapacityOutput} />}
              </div>
              {entry.kind === 'container' && expanded ? (
                <div
                  aria-label={`${label} contents`}
                  className={styles.inventoryContainerBody}
                  role="group"
                >
                  <div className={styles.inventoryContainerSettings}>
                    <label className={styles.inventoryContainerField}>
                      <span>Contents Weight</span>
                      <Dropdown
                        accessibleLabel={`${label} contents weight`}
                        className={styles.inventoryContentsDropdown}
                        disabled={!canEdit}
                        label={entry.contentsWeight === 'normal' ? 'Normal' : 'Weightless'}
                        panelLabel={`${label} contents weight options`}
                      >
                        {DND5E_INVENTORY_CONTENTS_WEIGHT.map((option) => (
                          <DropdownOption
                            active={entry.contentsWeight === option}
                            key={option}
                            label={option === 'normal' ? 'Normal' : 'Weightless'}
                            onSelect={() => void onCommit({
                              changes: { contentsWeight: option },
                              id: entry.id,
                              kind: 'update',
                            })}
                          />
                        ))}
                      </Dropdown>
                    </label>
                    <label className={styles.inventoryContainerField}>
                      <span>Capacity</span>
                      <InlineInput
                        aria-label={`${label} capacity in pounds`}
                        autoComplete="off"
                        className={styles.inventoryCapacityInput}
                        inputMode="numeric"
                        maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                        placeholder="Unlimited"
                        readOnly={!canEdit}
                        value={numericBuffers[`${entry.id}.capacity`] ??
                          (entry.capacity === null ? '' : String(entry.capacity))}
                        onBlur={() => commitEntryNumber(entry, 'capacity')}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setNumericBuffers((current) => ({
                            ...current,
                            [`${entry.id}.capacity`]: value,
                          }));
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                      />
                    </label>
                  </div>
                  {renderEntries(entry.contents, entry.id, depth + 1)}
                  <div className={styles.inventoryAddRow}>
                    <CharacterSheetAddEntryButton
                      disabled={!canEdit ||
                        depth >= MAX_DND5E_CHARACTER_INVENTORY_DEPTH ||
                        totalEntries >= MAX_DND5E_CHARACTER_INVENTORY_ENTRIES}
                      label="Add Item"
                      onClick={() => addEntry(entry.id, 'item')}
                    />
                    <CharacterSheetAddEntryButton
                      disabled={!canEdit ||
                        depth >= MAX_DND5E_CHARACTER_INVENTORY_DEPTH ||
                        totalEntries >= MAX_DND5E_CHARACTER_INVENTORY_ENTRIES}
                      label="Add Container"
                      onClick={() => addEntry(entry.id, 'container')}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  const summary = inventory.variantEncumbrance
    ? [
      { label: 'Current', value: derived.currentWeightHundredths },
      { label: 'L Encumbered', value: derived.encumberedAtHundredths! },
      { label: 'H Encumbered', value: derived.heavilyEncumberedAtHundredths! },
    ]
    : [
      { label: 'Current', value: derived.currentWeightHundredths },
      { label: 'Carrying Capacity', value: derived.carryingCapacityHundredths },
    ];
  const statusText = derived.status === 'over-capacity'
    ? 'Over Capacity: carried weight exceeds carrying capacity.'
    : derived.status === 'heavily-encumbered'
      ? 'Heavily Encumbered: carried weight exceeds the heavy encumbrance threshold.'
      : derived.status === 'encumbered'
        ? 'Encumbered: carried weight exceeds the encumbrance threshold.'
        : null;
  const warnings = [
    ...(statusText ? [statusText] : []),
    ...containerCapacityWarnings(inventory.entries, derived),
  ];

  return (
    <div className={styles.inventoryPanelBody} ref={treeRef}>
      {warnings.length > 0 ? (
        <section
          aria-label="Inventory warnings"
          className={styles.inventoryWarningPanel}
          role="alert"
        >
          <strong>{warnings.length === 1 ? 'Inventory Warning' : 'Inventory Warnings'}</strong>
          <ul>
            {warnings.map((warning, index) => (
              <li key={`${index}:${warning}`}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <div
        aria-label="Inventory weight summary"
        className={styles.inventorySummary}
        data-columns={summary.length}
        role="group"
      >
        {summary.map(({ label, value }) => (
          <div className={styles.inventorySummaryValue} key={label}>
            <span>{label}</span>
            <output aria-label={`${label} weight`}>{formatDnd5eWeight(value)}</output>
          </div>
        ))}
      </div>
      <div aria-label="Character currency" className={styles.inventoryCurrency} role="group">
        {CURRENCY.map(({ id, label }) => {
          const key = `currency.${id}`;
          return (
            <label className={styles.inventoryCurrencyField} key={id}>
              <span>{label}</span>
              <InlineInput
                aria-label={label}
                autoComplete="off"
                inputMode="numeric"
                maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                readOnly={!canEdit}
                value={numericBuffers[key] ?? String(inventory.currency[id])}
                onBlur={() => commitCurrency(id)}
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
            </label>
          );
        })}
      </div>
      {renderEntries(displayedEntries, null, 1)}
      <div className={styles.inventoryAddRow}>
        <CharacterSheetAddEntryButton
          disabled={!canEdit || totalEntries >= MAX_DND5E_CHARACTER_INVENTORY_ENTRIES}
          label="Add Item"
          onClick={() => addEntry(null, 'item')}
        />
        <CharacterSheetAddEntryButton
          disabled={!canEdit || totalEntries >= MAX_DND5E_CHARACTER_INVENTORY_ENTRIES}
          label="Add Container"
          onClick={() => addEntry(null, 'container')}
        />
      </div>
      {reorderState && findEntry(inventory.entries, reorderState.activeId) ? (
        <div
          className={`${styles.reorderGhost} ${styles.inventoryReorderGhost}`}
          ref={setReorderGhostRef}
        >
          Move {entryLabel(findEntry(inventory.entries, reorderState.activeId)!.entry)}
        </div>
      ) : null}
    </div>
  );
}
