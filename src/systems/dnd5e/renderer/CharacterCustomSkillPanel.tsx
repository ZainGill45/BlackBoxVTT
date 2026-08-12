import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Dropdown, DropdownOption } from '../../../components/ui/Dropdown';
import { InlineInput } from '../../../components/ui/InlineInput';
import { DELETE_CONFIRMATION_TIMEOUT_MS } from '../../../components/ui/deleteConfirmation';
import {
  ContextMenuController,
  type ContextMenuEntry,
} from '../../../components/ui/contextMenu';
import { OrderedCollectionController } from '../../../components/ui/orderedCollection';
import {
  calculateDnd5eOffsetForTotal,
  formatDnd5eSignedValue,
  MAX_DND5E_CHARACTER_CUSTOM_SKILLS,
  MAX_DND5E_CHARACTER_FIELD_CODE_UNITS,
  parseDnd5eSafeInteger,
  type Dnd5eCharacterCustomSkill,
  type Dnd5eCharacterCustomSkillMutation,
  type Dnd5eCustomSkillAbility,
  type Dnd5eSkillValues,
} from '../characterData';
import { CharacterSheetAddEntryButton } from './CharacterSheetAddEntryButton';
import { CharacterSkillTrainingButton } from './CharacterSkillTrainingButton';
import styles from './CharacterSheetModal.module.css';

interface CharacterCustomSkillPanelProps {
  canEdit: boolean;
  derived: Readonly<Record<string, Dnd5eSkillValues>>;
  onChange: (mutation: Dnd5eCharacterCustomSkillMutation) => boolean;
  onCommit: (mutation: Dnd5eCharacterCustomSkillMutation) => Promise<boolean>;
  onSave: () => Promise<boolean>;
  skills: readonly Dnd5eCharacterCustomSkill[];
}

interface SkillReorderState {
  activeId: string;
  orderedIds: readonly string[];
  x: number;
  y: number;
}

const ABILITY_OPTIONS = [
  { abbreviation: 'STR', id: 'strength', label: 'STR — Strength' },
  { abbreviation: 'DEX', id: 'dexterity', label: 'DEX — Dexterity' },
  { abbreviation: 'CON', id: 'constitution', label: 'CON — Constitution' },
  { abbreviation: 'INT', id: 'intelligence', label: 'INT — Intelligence' },
  { abbreviation: 'WIS', id: 'wisdom', label: 'WIS — Wisdom' },
  { abbreviation: 'CHA', id: 'charisma', label: 'CHA — Charisma' },
  { abbreviation: 'NON', id: 'none', label: 'NON — None' },
] as const satisfies readonly {
  abbreviation: string;
  id: Dnd5eCustomSkillAbility;
  label: string;
}[];

function skillLabel(skill: Dnd5eCharacterCustomSkill): string {
  return skill.name.trim() || 'Unnamed Skill';
}

export function CharacterCustomSkillPanel({
  canEdit,
  derived,
  onChange,
  onCommit,
  onSave,
  skills,
}: CharacterCustomSkillPanelProps) {
  const [focusSkillId, setFocusSkillId] = useState<string | null>(null);
  const [numericBuffers, setNumericBuffers] = useState<Readonly<Record<string, string>>>({});
  const [reorderState, setReorderState] = useState<SkillReorderState | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<ContextMenuController | null>(null);
  const orderRef = useRef<OrderedCollectionController | null>(null);

  useEffect(() => {
    menuRef.current = new ContextMenuController();
    return () => menuRef.current?.close();
  }, []);

  useEffect(() => {
    if (!focusSkillId) return;
    const input = listRef.current?.querySelector<HTMLInputElement>(
      `[data-custom-skill-order-id="${focusSkillId}"] [data-custom-skill-name]`,
    );
    if (!input) return;
    input.focus();
    input.select();
    setFocusSkillId(null);
  }, [focusSkillId, skills]);

  const displayedSkills = useMemo(() => {
    if (!reorderState) return skills;
    const ordered = reorderState.orderedIds.flatMap((id) =>
      skills.find((skill) => skill.id === id) ?? [],
    );
    const orderedIds = new Set(ordered.map(({ id }) => id));
    return [...ordered, ...skills.filter(({ id }) => !orderedIds.has(id))];
  }, [reorderState, skills]);

  const beginReorder = (
    skill: Dnd5eCharacterCustomSkill,
    x: number,
    y: number,
  ) => {
    const controller = new OrderedCollectionController(
      () => skills.map(({ id }) => id),
      (orderedIds) => onCommit({ kind: 'reorder', orderedIds }),
    );
    orderRef.current = controller;
    const snapshot = controller.begin(skill.id);
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
        '[data-custom-skill-order-id]',
      );
      let snapshot = orderRef.current?.active;
      if (list) {
        const bounds = list.getBoundingClientRect();
        if (event.clientY < bounds.top + 30) list.scrollBy({ top: -20 });
        else if (event.clientY > bounds.bottom - 30) list.scrollBy({ top: 20 });
      }
      if (target) {
        const index = snapshot?.orderedIds.indexOf(target.dataset.customSkillOrderId!) ?? 0;
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
    skill: Dnd5eCharacterCustomSkill,
  ) => {
    if (!canEdit) return;
    event.preventDefault();
    const index = skills.findIndex(({ id }) => id === skill.id);
    let deleteArmedUntil = 0;
    const entries: ContextMenuEntry[] = [
      {
        disabled: index <= 0,
        kind: 'action',
        label: 'Move Custom Skill Up',
        onSelect: () => void onCommit({ direction: 'up', id: skill.id, kind: 'move' }),
      },
      {
        disabled: index === skills.length - 1,
        kind: 'action',
        label: 'Move Custom Skill Down',
        onSelect: () => void onCommit({ direction: 'down', id: skill.id, kind: 'move' }),
      },
      {
        kind: 'action',
        label: 'Reorder Custom Skill Freely',
        onSelect: () => beginReorder(skill, event.clientX, event.clientY),
      },
      { kind: 'divider' },
      {
        danger: true,
        kind: 'action',
        label: 'Delete Custom Skill',
        onSelect: (button) => {
          const now = Date.now();
          if (now > deleteArmedUntil) {
            deleteArmedUntil = now + DELETE_CONFIRMATION_TIMEOUT_MS;
            const armedUntil = deleteArmedUntil;
            button.textContent = 'Confirm Delete Custom Skill';
            button.setAttribute(
              'aria-label',
              `Confirm deletion of ${skillLabel(skill)}`,
            );
            button.setAttribute('aria-pressed', 'true');
            window.setTimeout(() => {
              if (
                button.isConnected &&
                deleteArmedUntil === armedUntil &&
                Date.now() >= armedUntil
              ) {
                button.textContent = 'Delete Custom Skill';
                button.removeAttribute('aria-label');
                button.setAttribute('aria-pressed', 'false');
              }
            }, DELETE_CONFIRMATION_TIMEOUT_MS);
            return false;
          }
          void onCommit({ id: skill.id, kind: 'delete' });
        },
      },
    ];
    menuRef.current?.open(
      event.clientX,
      event.clientY,
      `${skillLabel(skill)} actions`,
      entries,
      () => listRef.current
        ?.querySelector<HTMLElement>(
          `[data-custom-skill-order-id="${skill.id}"] [data-custom-skill-name]`,
        )
        ?.focus(),
      listRef.current?.closest('dialog') ?? undefined,
    );
  };

  const commitTotal = (
    skill: Dnd5eCharacterCustomSkill,
    field: 'bonusOffset' | 'passiveOffset',
  ) => {
    const key = `${skill.id}.${field}`;
    const input = numericBuffers[key];
    if (input === undefined) {
      void onSave();
      return;
    }
    setNumericBuffers((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    const desiredTotal = input.trim() === '' ? null : parseDnd5eSafeInteger(input);
    if (input.trim() !== '' && desiredTotal === null) return;
    const currentTotal = field === 'bonusOffset'
      ? derived[skill.id].bonus
      : derived[skill.id].passive;
    const nextOffset = desiredTotal === null
      ? 0
      : calculateDnd5eOffsetForTotal(currentTotal, skill[field], desiredTotal);
    if (nextOffset === null || !onChange({
      changes: { [field]: nextOffset },
      id: skill.id,
      kind: 'update',
    })) return;
    void onSave();
  };

  return (
    <>
      <div
        aria-label="Character custom skills"
        className={styles.customSkillList}
        ref={listRef}
        role="list"
      >
        {displayedSkills.map((skill) => {
          const label = skillLabel(skill);
          const ability = ABILITY_OPTIONS.find(({ id }) => id === skill.ability)!;
          const values = derived[skill.id];
          const bonusKey = `${skill.id}.bonusOffset`;
          const passiveKey = `${skill.id}.passiveOffset`;
          const displayedBonus = numericBuffers[bonusKey] ??
            formatDnd5eSignedValue(values.bonus);
          const displayedPassive = numericBuffers[passiveKey] ?? String(values.passive);
          return (
            <div
              className={styles.skillRow}
              data-custom-skill-order-id={skill.id}
              data-reordering={reorderState?.activeId === skill.id}
              key={skill.id}
              onContextMenu={(event) => openContextMenu(event, skill)}
              role="listitem"
            >
              <CharacterSkillTrainingButton
                disabled={!canEdit}
                label={label}
                training={skill.training}
                onChange={(training) => void onCommit({
                  changes: { training },
                  id: skill.id,
                  kind: 'update',
                })}
              />
              <span className={styles.skillLabel}>
                <Dropdown
                  accessibleLabel={`${label} ability`}
                  className={styles.customSkillAbilityDropdown}
                  disabled={!canEdit}
                  label={ability.abbreviation}
                  panelLabel={`${label} ability options`}
                  showIndicator={false}
                >
                  {ABILITY_OPTIONS.map((option) => (
                    <DropdownOption
                      active={skill.ability === option.id}
                      key={option.id}
                      label={option.label}
                      onSelect={() => void onCommit({
                        changes: { ability: option.id },
                        id: skill.id,
                        kind: 'update',
                      })}
                    />
                  ))}
                </Dropdown>
                <InlineInput
                  aria-label={`${label} name`}
                  autoComplete="off"
                  className={styles.customSkillNameInput}
                  data-custom-skill-name
                  maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                  readOnly={!canEdit}
                  value={skill.name}
                  onBlur={() => void onSave()}
                  onChange={(event) => onChange({
                    changes: { name: event.currentTarget.value },
                    id: skill.id,
                    kind: 'update',
                  })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
              </span>
              <span className={styles.skillValues}>
                <InlineInput
                  aria-label={`${label} bonus`}
                  autoComplete="off"
                  className={styles.skillValueInput}
                  inputMode="numeric"
                  maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                  readOnly={!canEdit}
                  size={Math.max(1, displayedBonus.length)}
                  value={displayedBonus}
                  onBlur={() => commitTotal(skill, 'bonusOffset')}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setNumericBuffers((current) => ({
                      ...current,
                      [bonusKey]: value,
                    }));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
                <span aria-hidden>/</span>
                <InlineInput
                  aria-label={`${label} passive score`}
                  autoComplete="off"
                  className={styles.skillValueInput}
                  inputMode="numeric"
                  maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                  readOnly={!canEdit}
                  size={Math.max(1, displayedPassive.length)}
                  value={displayedPassive}
                  onBlur={() => commitTotal(skill, 'passiveOffset')}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setNumericBuffers((current) => ({
                      ...current,
                      [passiveKey]: value,
                    }));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
              </span>
            </div>
          );
        })}
      </div>
      <div className={styles.skillAddRow}>
        <CharacterSheetAddEntryButton
          disabled={!canEdit || skills.length >= MAX_DND5E_CHARACTER_CUSTOM_SKILLS}
          label="Add Custom Skill"
          onClick={() => {
            const skill: Dnd5eCharacterCustomSkill = {
              ability: 'none',
              bonusOffset: 0,
              id: crypto.randomUUID(),
              name: 'New Skill',
              passiveOffset: 0,
              training: 'untrained',
            };
            if (!onChange({ kind: 'add', skill })) return;
            setFocusSkillId(skill.id);
            void onSave();
          }}
        />
      </div>
      {reorderState ? (
        <div
          className={styles.reorderGhost}
          style={{ left: reorderState.x + 12, top: reorderState.y + 12 }}
        >
          Move {skillLabel(
            skills.find(({ id }) => id === reorderState.activeId) ?? {
              ability: 'none',
              bonusOffset: 0,
              id: reorderState.activeId,
              name: 'Skill',
              passiveOffset: 0,
              training: 'untrained',
            },
          )}
        </div>
      ) : null}
    </>
  );
}
