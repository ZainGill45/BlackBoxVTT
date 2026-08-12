import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Collapsible } from '../../../components/ui/Collapsible';
import { DELETE_CONFIRMATION_TIMEOUT_MS } from '../../../components/ui/deleteConfirmation';
import { Dropdown, DropdownOption } from '../../../components/ui/Dropdown';
import { InlineInput } from '../../../components/ui/InlineInput';
import {
  ContextMenuController,
  type ContextMenuEntry,
} from '../../../components/ui/contextMenu';
import { OrderedCollectionController } from '../../../components/ui/orderedCollection';
import {
  DND5E_CHARACTER_FEATURE_TYPES,
  MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS,
  MAX_DND5E_CHARACTER_FEATURES,
  MAX_DND5E_CHARACTER_FIELD_CODE_UNITS,
  type Dnd5eCharacterFeature,
  type Dnd5eCharacterFeatureMutation,
  type Dnd5eCharacterFeatureType,
} from '../characterData';
import { CharacterSheetAddEntryButton } from './CharacterSheetAddEntryButton';
import styles from './CharacterSheetModal.module.css';

interface CharacterFeaturePanelProps {
  canEdit: boolean;
  canSendToChat: boolean;
  features: readonly Dnd5eCharacterFeature[];
  onChange: (mutation: Dnd5eCharacterFeatureMutation) => boolean;
  onCommit: (mutation: Dnd5eCharacterFeatureMutation) => Promise<boolean>;
  onSave: () => Promise<boolean>;
  onSendToChat: (feature: Dnd5eCharacterFeature) => void;
}

interface FeatureReorderState {
  activeId: string;
  orderedIds: readonly string[];
  x: number;
  y: number;
}

const FEATURE_TYPE_LABELS = {
  feature: 'Feature',
  proficiency: 'Proficiency',
  trait: 'Trait',
  unknown: 'Unknown',
} as const satisfies Record<Dnd5eCharacterFeatureType, string>;

function featureLabel(feature: Dnd5eCharacterFeature): string {
  return feature.name.trim() || 'Unnamed Feature';
}

export function CharacterFeaturePanel({
  canEdit,
  canSendToChat,
  features,
  onChange,
  onCommit,
  onSave,
  onSendToChat,
}: CharacterFeaturePanelProps) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [focusFeatureId, setFocusFeatureId] = useState<string | null>(null);
  const [reorderState, setReorderState] = useState<FeatureReorderState | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<ContextMenuController | null>(null);
  const orderRef = useRef<OrderedCollectionController | null>(null);

  useEffect(() => {
    menuRef.current = new ContextMenuController();
    return () => menuRef.current?.close();
  }, []);

  useEffect(() => {
    if (!focusFeatureId) return;
    const input = listRef.current?.querySelector<HTMLInputElement>(
      `[data-feature-order-id="${focusFeatureId}"] [data-feature-name]`,
    );
    if (!input) return;
    input.focus();
    input.select();
    setFocusFeatureId(null);
  }, [expandedIds, features, focusFeatureId]);

  const displayedFeatures = useMemo(() => {
    if (!reorderState) return features;
    const ordered = reorderState.orderedIds.flatMap((id) =>
      features.find((feature) => feature.id === id) ?? [],
    );
    const orderedIds = new Set(ordered.map(({ id }) => id));
    return [...ordered, ...features.filter(({ id }) => !orderedIds.has(id))];
  }, [features, reorderState]);

  const beginReorder = (
    feature: Dnd5eCharacterFeature,
    x: number,
    y: number,
  ) => {
    const controller = new OrderedCollectionController(
      () => features.map(({ id }) => id),
      (orderedIds) => onCommit({ kind: 'reorder', orderedIds }),
    );
    orderRef.current = controller;
    const snapshot = controller.begin(feature.id);
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
      const target = (event.target as Element | null)?.closest<HTMLElement>(
        '[data-feature-order-id]',
      );
      const viewport = listRef.current?.closest<HTMLElement>(
        '[data-character-sheet-viewport]',
      );
      let snapshot = orderRef.current?.active;
      if (viewport) {
        const bounds = viewport.getBoundingClientRect();
        if (event.clientY < bounds.top + 30) viewport.scrollBy({ top: -20 });
        else if (event.clientY > bounds.bottom - 30) viewport.scrollBy({ top: 20 });
      }
      if (target) {
        const index = snapshot?.orderedIds.indexOf(target.dataset.featureOrderId!) ?? 0;
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
    feature: Dnd5eCharacterFeature,
    position: { clientX: number; clientY: number },
    returnFocus: () => void,
    mount?: HTMLElement,
  ) => {
    if (!canEdit && !canSendToChat) return;
    const index = features.findIndex(({ id }) => id === feature.id);
    let deleteArmedUntil = 0;
    const entries: ContextMenuEntry[] = [
      {
        disabled: !canSendToChat,
        kind: 'action',
        label: 'Send To Chat',
        onSelect: () => onSendToChat(feature),
      },
    ];
    if (canEdit) entries.push(
      {
        disabled: index <= 0,
        kind: 'action',
        label: 'Move Feature Up',
        onSelect: () => void onCommit({ direction: 'up', id: feature.id, kind: 'move' }),
      },
      {
        disabled: index === features.length - 1,
        kind: 'action',
        label: 'Move Feature Down',
        onSelect: () => void onCommit({ direction: 'down', id: feature.id, kind: 'move' }),
      },
      {
        kind: 'action',
        label: 'Reorder Feature Freely',
        onSelect: () => beginReorder(
          feature,
          position.clientX,
          position.clientY,
        ),
      },
      { kind: 'divider' },
      {
        danger: true,
        kind: 'action',
        label: 'Delete Feature',
        onSelect: (button) => {
          const now = Date.now();
          if (now > deleteArmedUntil) {
            deleteArmedUntil = now + DELETE_CONFIRMATION_TIMEOUT_MS;
            const armedUntil = deleteArmedUntil;
            button.textContent = 'Confirm Delete Feature';
            button.setAttribute(
              'aria-label',
              `Confirm deletion of ${featureLabel(feature)}`,
            );
            button.setAttribute('aria-pressed', 'true');
            window.setTimeout(() => {
              if (
                button.isConnected &&
                deleteArmedUntil === armedUntil &&
                Date.now() >= armedUntil
              ) {
                button.textContent = 'Delete Feature';
                button.removeAttribute('aria-label');
                button.setAttribute('aria-pressed', 'false');
              }
            }, DELETE_CONFIRMATION_TIMEOUT_MS);
            return false;
          }
          void onCommit({ id: feature.id, kind: 'delete' });
        },
      },
    );
    menuRef.current?.open(
      position.clientX,
      position.clientY,
      `${featureLabel(feature)} actions`,
      entries,
      returnFocus,
      mount,
    );
  };

  const updateFeature = (
    feature: Dnd5eCharacterFeature,
    changes: Partial<Pick<
      Dnd5eCharacterFeature,
      'description' | 'name' | 'source' | 'sourceType' | 'type'
    >>,
  ) => onChange({ changes, id: feature.id, kind: 'update' });

  return (
    <>
      <div className={styles.featurePanelBody}>
        <div
          aria-label="Character features"
          className={styles.featureList}
          ref={listRef}
          role="list"
        >
          {displayedFeatures.map((feature) => {
            const label = featureLabel(feature);
            const expanded = expandedIds.has(feature.id);
            return (
              <div
                className={styles.featureCardWrapper}
                data-feature-order-id={feature.id}
                data-reordering={reorderState?.activeId === feature.id}
                key={feature.id}
                onContextMenu={(event) => {
                  if (!canEdit && !canSendToChat) return;
                  event.preventDefault();
                  const focused = event.target instanceof HTMLElement
                    ? event.target
                    : null;
                  openContextMenu(
                    feature,
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
                    feature,
                    { clientX: bounds.left + 24, clientY: bounds.bottom },
                    () => focused?.focus(),
                    event.currentTarget.closest('dialog') ?? undefined,
                  );
                }}
                role="listitem"
              >
                <Collapsible
                  className={styles.featureCard}
                  contentClassName={styles.featureCardContent}
                  expanded={expanded}
                  label={label}
                  onExpandedChange={(nextExpanded) => {
                    setExpandedIds((current) => {
                      const next = new Set(current);
                      if (nextExpanded) next.add(feature.id);
                      else next.delete(feature.id);
                      return next;
                    });
                  }}
                >
                  <div className={styles.featureFieldGrid}>
                    <label className={styles.featureField}>
                      <InlineInput
                        aria-label={`${label} name`}
                        autoComplete="off"
                        className={styles.featureInput}
                        data-feature-name
                        maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                        placeholder="Name"
                        readOnly={!canEdit}
                        value={feature.name}
                        onBlur={() => void onSave()}
                        onChange={(event) => updateFeature(feature, {
                          name: event.currentTarget.value,
                        })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                      />
                    </label>
                    <div className={styles.featureField}>
                      <Dropdown
                        accessibleLabel={`${label} type`}
                        className={styles.featureTypeDropdown}
                        disabled={!canEdit}
                        label={FEATURE_TYPE_LABELS[feature.type]}
                        panelLabel={`${label} type options`}
                      >
                        {DND5E_CHARACTER_FEATURE_TYPES.map((type) => (
                          <DropdownOption
                            active={feature.type === type}
                            key={type}
                            label={FEATURE_TYPE_LABELS[type]}
                            onSelect={() => void onCommit({
                              changes: { type },
                              id: feature.id,
                              kind: 'update',
                            })}
                          />
                        ))}
                      </Dropdown>
                    </div>
                    <label className={styles.featureField}>
                      <InlineInput
                        aria-label={`${label} source`}
                        autoComplete="off"
                        className={styles.featureInput}
                        maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                        placeholder="Source"
                        readOnly={!canEdit}
                        value={feature.source}
                        onBlur={() => void onSave()}
                        onChange={(event) => updateFeature(feature, {
                          source: event.currentTarget.value,
                        })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                      />
                    </label>
                    <label className={styles.featureField}>
                      <InlineInput
                        aria-label={`${label} source type`}
                        autoComplete="off"
                        className={styles.featureInput}
                        maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                        placeholder="Source type"
                        readOnly={!canEdit}
                        value={feature.sourceType}
                        onBlur={() => void onSave()}
                        onChange={(event) => updateFeature(feature, {
                          sourceType: event.currentTarget.value,
                        })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                        }}
                      />
                    </label>
                    <label className={`${styles.featureField} ${styles.featureDescriptionField}`}>
                      <textarea
                        aria-label={`${label} description`}
                        className={styles.featureDescription}
                        maxLength={MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS}
                        placeholder="Description"
                        readOnly={!canEdit}
                        rows={4}
                        value={feature.description}
                        onBlur={() => void onSave()}
                        onChange={(event) => updateFeature(feature, {
                          description: event.currentTarget.value,
                        })}
                      />
                    </label>
                  </div>
                </Collapsible>
              </div>
            );
          })}
        </div>
        <div className={styles.panelAddRow}>
          <CharacterSheetAddEntryButton
            disabled={!canEdit || features.length >= MAX_DND5E_CHARACTER_FEATURES}
            label="Add Feature"
            onClick={() => {
              const feature: Dnd5eCharacterFeature = {
                description: '',
                id: crypto.randomUUID(),
                name: 'New Feature',
                source: '',
                sourceType: '',
                type: 'unknown',
              };
              if (!onChange({ feature, kind: 'add' })) return;
              setExpandedIds((current) => new Set(current).add(feature.id));
              setFocusFeatureId(feature.id);
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
          Move {featureLabel(
            features.find(({ id }) => id === reorderState.activeId) ?? {
              description: '',
              id: reorderState.activeId,
              name: 'Feature',
              source: '',
              sourceType: '',
              type: 'unknown',
            },
          )}
        </div>
      ) : null}
    </>
  );
}
