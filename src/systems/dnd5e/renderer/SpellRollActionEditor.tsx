import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Button } from '../../../components/ui/Button';
import { Collapsible } from '../../../components/ui/Collapsible';
import {
  ContextMenuController,
  type ContextMenuEntry,
} from '../../../components/ui/contextMenu';
import { DELETE_CONFIRMATION_TIMEOUT_MS } from '../../../components/ui/deleteConfirmation';
import { Dropdown, DropdownOption } from '../../../components/ui/Dropdown';
import { TextInput } from '../../../components/ui/FormField';
import { OrderedCollectionController } from '../../../components/ui/orderedCollection';
import {
  DND5E_ABILITIES,
  DND5E_ACTION_STEP_PURPOSES,
  DND5E_DAMAGE_TYPES,
  type Dnd5eActionStepPurpose,
} from '../characterData';
import {
  DND5E_SPELL_SCALING_MODES,
  MAX_DND5E_SPELL_DESCRIPTION_CODE_UNITS,
  MAX_DND5E_SPELL_FIELD_CODE_UNITS,
  MAX_DND5E_SPELL_ROLL_STEPS,
  MAX_DND5E_SPELL_ROLL_TERMS,
  analyzeDnd5eSpellRollStep,
  createDefaultDnd5eSpellRollStep,
  createDefaultDnd5eSpellValueTerm,
  type Dnd5eSpellDiceTier,
  type Dnd5eSpellLevel,
  type Dnd5eSpellRollStep,
  type Dnd5eSpellRollStepMutation,
  type Dnd5eSpellValueTerm,
} from '../spellData';
import { CharacterSheetAddEntryButton } from './CharacterSheetAddEntryButton';
import { RollEditorField, RollNumericField } from './RollEditorControls';
import styles from './SpellRollActionEditor.module.css';

interface SpellRollActionEditorProps {
  canEdit: boolean;
  level: Dnd5eSpellLevel;
  onChange: (mutation: Dnd5eSpellRollStepMutation) => boolean;
  onCommit: (mutation: Dnd5eSpellRollStepMutation) => Promise<boolean>;
  onError: (message: string) => void;
  onSave: () => Promise<boolean>;
  steps: readonly Dnd5eSpellRollStep[];
}

interface ReorderState {
  activeId: string;
  orderedIds: readonly string[];
  x: number;
  y: number;
}

const PURPOSE_LABELS: Record<Dnd5eActionStepPurpose, string> = {
  attack: 'Attack',
  damage: 'Damage',
  effect: 'Effect',
  healing: 'Healing',
  roll: 'General Roll',
  save: 'Save Prompt',
};

const TERM_LABELS: Record<Dnd5eSpellValueTerm['kind'], string> = {
  'cast-level': 'Cast Level',
  'caster-level': 'Caster Level',
  dice: 'Dice',
  flat: 'Flat Value',
  'spellcasting-modifier': 'Spellcasting Modifier',
};

const TERM_KINDS = [
  'dice',
  'flat',
  'spellcasting-modifier',
  'caster-level',
  'cast-level',
] as const satisfies readonly Dnd5eSpellValueTerm['kind'][];

function stepLabel(step: Dnd5eSpellRollStep): string {
  return step.label.trim() || `Unnamed ${PURPOSE_LABELS[step.purpose]}`;
}

function mutationTarget(mutation: Dnd5eSpellRollStepMutation): string | null {
  return mutation.kind === 'reorder' || mutation.kind === 'add'
    ? null
    : mutation.id;
}

function TermEditor({
  canEdit,
  level,
  onChange,
  terms,
}: {
  canEdit: boolean;
  level: Dnd5eSpellLevel;
  onChange: (terms: Dnd5eSpellValueTerm[]) => void;
  terms: readonly Dnd5eSpellValueTerm[];
}) {
  const update = (index: number, term: Dnd5eSpellValueTerm) =>
    onChange(terms.map((candidate, currentIndex) =>
      currentIndex === index ? term : candidate));
  const remove = (index: number) => onChange(
    terms.filter((_, currentIndex) => currentIndex !== index),
  );

  return (
    <div className={styles.termEditor}>
      {terms.map((term, index) => (
        <div
          className={styles.termRow}
          data-term-kind={term.kind}
          key={`${term.kind}:${index}`}
        >
          <div className={styles.termHeader}>
            {canEdit ? (
              <Button
                aria-label={`Remove ${TERM_LABELS[term.kind]} term ${index + 1}`}
                className={styles.termRemove}
                size="compact"
                onClick={() => remove(index)}
              >
                Remove
              </Button>
            ) : null}
          </div>
          <div className={styles.termControls}>
            {term.kind === 'dice' ? (
              <div className={styles.diceControls}>
                <RollEditorField label="Count">
                  <RollNumericField
                    accessibleLabel={`Dice term ${index + 1} count`}
                    maximum={1_000}
                    minimum={1}
                    readOnly={!canEdit}
                    value={term.count}
                    onCommit={(count) => update(index, { ...term, count })}
                  />
                </RollEditorField>
                <span aria-hidden className={styles.diceSeparator}>d</span>
                <RollEditorField label="Sides">
                  <RollNumericField
                    accessibleLabel={`Dice term ${index + 1} sides`}
                    minimum={2}
                    readOnly={!canEdit}
                    value={term.sides}
                    onCommit={(sides) => update(index, { ...term, sides })}
                  />
                </RollEditorField>
              </div>
            ) : term.kind === 'flat' ? (
              <RollEditorField label="Flat value">
                <RollNumericField
                  accessibleLabel={`Flat value term ${index + 1}`}
                  readOnly={!canEdit}
                  value={term.value}
                  onCommit={(value) => update(index, { ...term, value })}
                />
              </RollEditorField>
            ) : (
              <RollEditorField label={TERM_LABELS[term.kind]}>
                <span className={styles.termValue}>{TERM_LABELS[term.kind]}</span>
              </RollEditorField>
            )}
          </div>
          {term.kind === 'dice' ? (
            <>
              <div className={styles.scaleToggle}>
                <RollEditorField label="Scaling">
                  <Dropdown
                    disabled={!canEdit}
                    label={term.scaling === 'fixed'
                      ? 'Fixed Dice'
                      : term.scaling === 'caster-level'
                        ? 'Caster-Level Dice'
                        : 'Cast-Level Dice'}
                    panelLabel="Dice scaling options"
                  >
                    {DND5E_SPELL_SCALING_MODES.map((scaling) => (
                      <DropdownOption
                        active={scaling === term.scaling}
                        disabled={scaling === 'cast-level' && level === 0}
                        key={scaling}
                        label={scaling === 'fixed'
                          ? 'Fixed Dice'
                          : scaling === 'caster-level'
                            ? 'Caster-Level Dice'
                            : 'Cast-Level Dice'}
                        onSelect={() => update(index, {
                          ...term,
                          scaling,
                          tiers: [],
                        })}
                      />
                    ))}
                  </Dropdown>
                </RollEditorField>
              </div>
              {term.scaling !== 'fixed' ? (
                <DiceTierEditor
                  canEdit={canEdit}
                  level={level}
                  scaling={term.scaling}
                  sides={term.sides}
                  tiers={term.tiers}
                  onChange={(tiers) => update(index, { ...term, tiers })}
                />
              ) : null}
            </>
          ) : null}
        </div>
      ))}
      {canEdit && terms.length < MAX_DND5E_SPELL_ROLL_TERMS ? (
        <RollEditorField className={styles.addTermField} label="Add term">
          <Dropdown
            className={styles.addTerm}
            label="Choose term type"
            panelLabel="Spell value term types"
          >
            {TERM_KINDS.map((kind) => (
              <DropdownOption
                disabled={kind === 'cast-level' && level === 0}
                key={kind}
                label={TERM_LABELS[kind]}
                onSelect={() => onChange([
                  ...terms,
                  createDefaultDnd5eSpellValueTerm(kind),
                ])}
              />
            ))}
          </Dropdown>
        </RollEditorField>
      ) : null}
    </div>
  );
}

function DiceTierEditor({
  canEdit,
  level,
  onChange,
  scaling,
  sides,
  tiers,
}: {
  canEdit: boolean;
  level: Dnd5eSpellLevel;
  onChange: (tiers: Dnd5eSpellDiceTier[]) => void;
  scaling: 'cast-level' | 'caster-level';
  sides: number;
  tiers: readonly Dnd5eSpellDiceTier[];
}) {
  const minimum = scaling === 'caster-level' ? 1 : Math.max(1, level);
  const maximum = scaling === 'caster-level' ? 20 : 9;
  const addMinimum = Math.max(minimum, (tiers.at(-1)?.minimum ?? minimum - 1) + 1);
  return (
    <div
      aria-label={scaling === 'caster-level' ? 'Caster level tiers' : 'Cast level tiers'}
      className={styles.tierList}
    >
      {tiers.map((tier, index) => {
        const previous = tiers[index - 1]?.minimum ?? minimum - 1;
        const next = tiers[index + 1]?.minimum ?? maximum + 1;
        return (
          <div className={styles.tierRow} key={`${tier.minimum}:${index}`}>
            <span>{scaling === 'caster-level' ? 'Lv' : 'Cast'}</span>
            <RollNumericField
              accessibleLabel={`Tier ${index + 1} minimum ${scaling}`}
              maximum={next - 1}
              minimum={previous + 1}
              readOnly={!canEdit}
              value={tier.minimum}
              onCommit={(value) => onChange(tiers.map((candidate, currentIndex) =>
                currentIndex === index ? { ...candidate, minimum: value } : candidate))}
            />
            <span aria-hidden>→</span>
            <RollNumericField
              accessibleLabel={`Tier ${index + 1} dice count`}
              maximum={1_000}
              minimum={1}
              readOnly={!canEdit}
              value={tier.count}
              onCommit={(count) => onChange(tiers.map((candidate, currentIndex) =>
                currentIndex === index ? { ...candidate, count } : candidate))}
            />
            <span>d{sides}</span>
            {canEdit ? (
              <Button
                aria-label={`Remove tier ${index + 1}`}
                size="compact"
                onClick={() => onChange(
                  tiers.filter((_, currentIndex) => currentIndex !== index),
                )}
              >
                Remove
              </Button>
            ) : null}
          </div>
        );
      })}
      {canEdit && tiers.length < 20 && addMinimum <= maximum ? (
        <Button
          size="compact"
          onClick={() => onChange([
            ...tiers,
            { count: tiers.at(-1)?.count ?? 1, minimum: addMinimum },
          ])}
        >
          Add Tier
        </Button>
      ) : null}
    </div>
  );
}

function StepEditor({
  canEdit,
  level,
  onChange,
  onCommit,
  onSave,
  step,
  steps,
}: {
  canEdit: boolean;
  level: Dnd5eSpellLevel;
  onChange: (step: Dnd5eSpellRollStep) => void;
  onCommit: (step: Dnd5eSpellRollStep) => void;
  onSave: () => void;
  step: Dnd5eSpellRollStep;
  steps: readonly Dnd5eSpellRollStep[];
}) {
  const attacks = steps.filter((candidate) => candidate.purpose === 'attack');
  const updateTerms = (terms: Dnd5eSpellValueTerm[]) => {
    if (!('terms' in step)) return;
    onCommit({ ...step, terms });
  };
  return (
    <div className={styles.stepEditor}>
      <div className={styles.stepGrid}>
        <RollEditorField label="Step name">
          <TextInput
            aria-label={`${stepLabel(step)} label`}
            maxLength={MAX_DND5E_SPELL_FIELD_CODE_UNITS}
            readOnly={!canEdit}
            value={step.label}
            onBlur={onSave}
            onChange={(event) => onChange({ ...step, label: event.currentTarget.value })}
          />
        </RollEditorField>
        <RollEditorField label="Purpose">
          <Dropdown
            disabled={!canEdit}
            label={PURPOSE_LABELS[step.purpose]}
            panelLabel="Roll action purposes"
          >
            {DND5E_ACTION_STEP_PURPOSES.map((purpose) => (
              <DropdownOption
                active={purpose === step.purpose}
                key={purpose}
                label={PURPOSE_LABELS[purpose]}
                onSelect={() => onCommit(createDefaultDnd5eSpellRollStep(purpose, step.id))}
              />
            ))}
          </Dropdown>
        </RollEditorField>
      </div>
      {step.purpose === 'attack' ? (
        <div className={styles.stepGrid}>
          <RollEditorField label="Attack Source">
            <Dropdown
              disabled={!canEdit}
              label={step.attackBonus.kind === 'spell-attack-bonus'
                ? 'Spell Attack Bonus'
                : 'Fixed Modifier'}
            >
              <DropdownOption
                active={step.attackBonus.kind === 'spell-attack-bonus'}
                label="Spell Attack Bonus"
                onSelect={() => onCommit({
                  ...step,
                  attackBonus: { kind: 'spell-attack-bonus' },
                })}
              />
              <DropdownOption
                active={step.attackBonus.kind === 'fixed'}
                label="Fixed Modifier"
                onSelect={() => onCommit({
                  ...step,
                  attackBonus: { kind: 'fixed', modifier: 0 },
                })}
              />
            </Dropdown>
          </RollEditorField>
          {step.attackBonus.kind === 'fixed' ? (
            <RollEditorField label="Modifier">
              <RollNumericField
                accessibleLabel="Fixed spell attack modifier"
                readOnly={!canEdit}
                value={step.attackBonus.modifier}
                onCommit={(modifier) => onCommit({
                  ...step,
                  attackBonus: { kind: 'fixed', modifier },
                })}
              />
            </RollEditorField>
          ) : null}
        </div>
      ) : step.purpose === 'save' ? (
        <>
          <div className={styles.stepGrid}>
            <RollEditorField label="Target Ability">
              <Dropdown disabled={!canEdit} label={step.ability}>
                {DND5E_ABILITIES.map((ability) => (
                  <DropdownOption
                    active={ability === step.ability}
                    key={ability}
                    label={ability}
                    onSelect={() => onCommit({ ...step, ability })}
                  />
                ))}
              </Dropdown>
            </RollEditorField>
            <RollEditorField label="Save DC Source">
              <Dropdown
                disabled={!canEdit}
                label={step.dc.kind === 'spell-save-dc' ? 'Spell Save DC' : 'Fixed DC'}
              >
                <DropdownOption
                  active={step.dc.kind === 'spell-save-dc'}
                  label="Spell Save DC"
                  onSelect={() => onCommit({ ...step, dc: { kind: 'spell-save-dc' } })}
                />
                <DropdownOption
                  active={step.dc.kind === 'fixed'}
                  label="Fixed DC"
                  onSelect={() => onCommit({ ...step, dc: { dc: 10, kind: 'fixed' } })}
                />
              </Dropdown>
            </RollEditorField>
            {step.dc.kind === 'fixed' ? (
              <RollEditorField label="DC">
                <RollNumericField
                  accessibleLabel="Fixed spell save DC"
                  minimum={0}
                  readOnly={!canEdit}
                  value={step.dc.dc}
                  onCommit={(dc) => onCommit({ ...step, dc: { dc, kind: 'fixed' } })}
                />
              </RollEditorField>
            ) : null}
          </div>
          <div className={styles.stepGrid}>
            <RollEditorField label="On Success">
              <textarea
                aria-label={`${stepLabel(step)} success`}
                className={styles.compactTextarea}
                maxLength={MAX_DND5E_SPELL_DESCRIPTION_CODE_UNITS}
                readOnly={!canEdit}
                rows={2}
                value={step.success}
                onBlur={onSave}
                onChange={(event) => onChange({ ...step, success: event.currentTarget.value })}
              />
            </RollEditorField>
            <RollEditorField label="On Failure">
              <textarea
                aria-label={`${stepLabel(step)} failure`}
                className={styles.compactTextarea}
                maxLength={MAX_DND5E_SPELL_DESCRIPTION_CODE_UNITS}
                readOnly={!canEdit}
                rows={2}
                value={step.failure}
                onBlur={onSave}
                onChange={(event) => onChange({ ...step, failure: event.currentTarget.value })}
              />
            </RollEditorField>
          </div>
        </>
      ) : step.purpose === 'effect' ? (
        <RollEditorField label="Effect">
          <textarea
            aria-label={`${stepLabel(step)} effect`}
            className={styles.compactTextarea}
            maxLength={MAX_DND5E_SPELL_DESCRIPTION_CODE_UNITS}
            readOnly={!canEdit}
            rows={2}
            value={step.text}
            onBlur={onSave}
            onChange={(event) => onChange({ ...step, text: event.currentTarget.value })}
          />
        </RollEditorField>
      ) : (
        <>
          {step.purpose === 'damage' ? (
            <div className={styles.stepGrid}>
              <RollEditorField label="Damage Type">
                <Dropdown
                  disabled={!canEdit}
                  label={step.damageType ?? 'No Damage Type'}
                >
                  <DropdownOption
                    active={step.damageType === null}
                    label="No Damage Type"
                    onSelect={() => onCommit({ ...step, damageType: null })}
                  />
                  {DND5E_DAMAGE_TYPES.map((damageType) => (
                    <DropdownOption
                      active={step.damageType === damageType}
                      key={damageType}
                      label={damageType}
                      onSelect={() => onCommit({ ...step, damageType })}
                    />
                  ))}
                </Dropdown>
              </RollEditorField>
              <RollEditorField label="Critical Attack">
                <Dropdown
                  disabled={!canEdit}
                  label={attacks.find(({ id }) => id === step.criticalSourceStepId)?.label ||
                    'No Critical Link'}
                >
                  <DropdownOption
                    active={step.criticalSourceStepId === null}
                    label="No Critical Link"
                    onSelect={() => onCommit({ ...step, criticalSourceStepId: null })}
                  />
                  {attacks.map((attack) => (
                    <DropdownOption
                      active={step.criticalSourceStepId === attack.id}
                      key={attack.id}
                      label={stepLabel(attack)}
                      onSelect={() => onCommit({
                        ...step,
                        criticalSourceStepId: attack.id,
                      })}
                    />
                  ))}
                </Dropdown>
              </RollEditorField>
            </div>
          ) : null}
          <TermEditor
            canEdit={canEdit}
            level={level}
            terms={step.terms}
            onChange={updateTerms}
          />
        </>
      )}
    </div>
  );
}

export function SpellRollActionEditor({
  canEdit,
  level,
  onChange,
  onCommit,
  onError,
  onSave,
  steps,
}: SpellRollActionEditorProps) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const [reorderState, setReorderState] = useState<ReorderState | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<ContextMenuController | null>(null);
  const orderRef = useRef<OrderedCollectionController | null>(null);

  useEffect(() => {
    menuRef.current = new ContextMenuController();
    return () => menuRef.current?.close();
  }, []);

  const displayedSteps = useMemo(() => {
    if (!reorderState) return steps;
    const ordered = reorderState.orderedIds.flatMap((id) =>
      steps.find((step) => step.id === id) ?? []);
    const orderedIds = new Set(ordered.map(({ id }) => id));
    return [...ordered, ...steps.filter(({ id }) => !orderedIds.has(id))];
  }, [reorderState, steps]);

  const changeStep = (step: Dnd5eSpellRollStep) => {
    if (!onChange({ id: step.id, kind: 'update', step })) {
      onError('The Roll Action could not be updated.');
    }
  };
  const commitStep = (step: Dnd5eSpellRollStep) => {
    void onCommit({ id: step.id, kind: 'update', step });
  };

  const beginReorder = (step: Dnd5eSpellRollStep, position: { clientX: number; clientY: number }) => {
    const controller = new OrderedCollectionController(
      () => steps.map(({ id }) => id),
      (orderedIds) => onCommit({ kind: 'reorder', orderedIds }),
    );
    orderRef.current = controller;
    const snapshot = controller.begin(step.id);
    if (snapshot) setReorderState({
      activeId: step.id,
      orderedIds: snapshot.orderedIds,
      x: position.clientX,
      y: position.clientY,
    });
  };

  useEffect(() => {
    if (!reorderState) return undefined;
    const movePointer = (event: PointerEvent) => {
      const target = (event.target as Element | null)
        ?.closest<HTMLElement>('[data-spell-roll-step-order-id]');
      let snapshot = orderRef.current?.active;
      if (target && listRef.current?.contains(target)) {
        const id = target.dataset.spellRollStepOrderId ?? '';
        const index = snapshot?.orderedIds.indexOf(id) ?? 0;
        const after = event.clientY >
          target.getBoundingClientRect().top + target.offsetHeight / 2;
        snapshot = orderRef.current?.placeAt(index + (after ? 1 : 0));
      }
      if (snapshot) setReorderState((current) => current ? {
        ...current,
        orderedIds: snapshot!.orderedIds,
        x: event.clientX,
        y: event.clientY,
      } : current);
    };
    const finish = (event: PointerEvent) => {
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
        if (snapshot) setReorderState((current) => current
          ? { ...current, orderedIds: snapshot.orderedIds }
          : current);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void orderRef.current?.commit().then(() => setReorderState(null));
      }
    };
    document.addEventListener('pointermove', movePointer, true);
    document.addEventListener('pointerdown', finish, true);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointermove', movePointer, true);
      document.removeEventListener('pointerdown', finish, true);
      window.removeEventListener('keydown', key);
    };
  }, [reorderState]);

  const armDelete = (step: Dnd5eSpellRollStep): ContextMenuEntry => {
    let armedUntil = 0;
    return {
      danger: true,
      kind: 'action',
      label: 'Delete',
      onSelect: (button) => {
        const now = Date.now();
        if (now > armedUntil) {
          armedUntil = now + DELETE_CONFIRMATION_TIMEOUT_MS;
          const expected = armedUntil;
          button.textContent = 'Confirm Delete';
          button.setAttribute('aria-label', `Confirm deletion of ${stepLabel(step)}`);
          button.setAttribute('aria-pressed', 'true');
          window.setTimeout(() => {
            if (button.isConnected && armedUntil === expected && Date.now() >= expected) {
              button.textContent = 'Delete';
              button.setAttribute('aria-pressed', 'false');
            }
          }, DELETE_CONFIRMATION_TIMEOUT_MS);
          return false;
        }
        void onCommit({ id: step.id, kind: 'delete' });
      },
    };
  };

  const openMenu = (
    step: Dnd5eSpellRollStep,
    position: { clientX: number; clientY: number },
    returnFocus?: () => void,
  ) => {
    const index = steps.findIndex(({ id }) => id === step.id);
    const entries: ContextMenuEntry[] = [
      {
        disabled: index <= 0,
        kind: 'action',
        label: 'Move Up',
        onSelect: () => void onCommit({ direction: 'up', id: step.id, kind: 'move' }),
      },
      {
        disabled: index === steps.length - 1,
        kind: 'action',
        label: 'Move Down',
        onSelect: () => void onCommit({ direction: 'down', id: step.id, kind: 'move' }),
      },
      {
        kind: 'action',
        label: 'Reorder Freely',
        onSelect: () => beginReorder(step, position),
      },
      { kind: 'divider' },
      armDelete(step),
    ];
    menuRef.current?.open(
      position.clientX,
      position.clientY,
      `${stepLabel(step)} actions`,
      entries,
      returnFocus,
      listRef.current?.closest('dialog') ?? undefined,
    );
  };

  const openContext = (event: ReactMouseEvent, step: Dnd5eSpellRollStep) => {
    if (!canEdit) return;
    event.preventDefault();
    openMenu(step, event);
  };
  const openKeyboardMenu = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    step: Dnd5eSpellRollStep,
  ) => {
    if (!canEdit || (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))) {
      return;
    }
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    openMenu(step, { clientX: bounds.left + 24, clientY: bounds.top + 24 }, () =>
      event.currentTarget.focus());
  };

  const add = async () => {
    if (steps.length >= MAX_DND5E_SPELL_ROLL_STEPS) return;
    const step = createDefaultDnd5eSpellRollStep();
    setExpandedIds((current) => new Set(current).add(step.id));
    await onCommit({ kind: 'add', step });
  };

  return (
    <section className={styles.rollActions} aria-label="Spell Roll Actions">
      {steps.length === 0 ? (
        <div className={styles.emptySteps}>
          <strong>This Spell has no Roll Actions yet.</strong>
          <span>Add one to define its eventual character-sheet roll.</span>
        </div>
      ) : (
        <div className={styles.stepList} ref={listRef} role="list">
          {displayedSteps.map((step) => {
            const analysis = analyzeDnd5eSpellRollStep(step);
            const expanded = expandedIds.has(step.id);
            return (
              <div
                className={[
                  reorderState?.activeId === step.id ? styles.reordering : undefined,
                ].filter(Boolean).join(' ')}
                data-spell-roll-step-order-id={step.id}
                key={step.id}
                role={canEdit ? 'listitem' : undefined}
                tabIndex={canEdit ? 0 : undefined}
                onContextMenu={(event) => openContext(event, step)}
                onKeyDown={(event) => openKeyboardMenu(event, step)}
              >
                <Collapsible
                  className={styles.stepCard}
                  contentClassName={styles.stepContent}
                  expanded={expanded}
                  label={(
                    <span className={styles.stepSummary}>
                      <span className={styles.stepIdentity}>
                        <strong>{stepLabel(step)}</strong>
                        <span>{PURPOSE_LABELS[step.purpose]}</span>
                      </span>
                      <code data-incomplete={analysis.issues.length > 0 || undefined}>
                        {analysis.summary}
                      </code>
                    </span>
                  )}
                  onExpandedChange={(next) => setExpandedIds((current) => {
                    const ids = new Set(current);
                    if (next) ids.add(step.id);
                    else ids.delete(step.id);
                    return ids;
                  })}
                >
                  {canEdit ? (
                    <StepEditor
                      canEdit
                      level={level}
                      step={step}
                      steps={steps}
                      onChange={changeStep}
                      onCommit={commitStep}
                      onSave={() => void onSave()}
                    />
                  ) : (
                    <p className={styles.readOnlySummary}>{analysis.summary}</p>
                  )}
                  {canEdit && analysis.issues.length > 0 ? (
                    <ul
                      aria-label={`${stepLabel(step)} incomplete fields`}
                      className={styles.stepIssues}
                    >
                      {analysis.issues.map((issue) => <li key={issue}>{issue}</li>)}
                    </ul>
                  ) : null}
                </Collapsible>
              </div>
            );
          })}
        </div>
      )}
      {canEdit ? (
        <CharacterSheetAddEntryButton
          disabled={steps.length >= MAX_DND5E_SPELL_ROLL_STEPS}
          label="Add Roll Action"
          onClick={() => void add()}
        />
      ) : null}
      {reorderState ? (
        <div
          aria-live="polite"
          className={styles.reorderGhost}
          style={{ left: reorderState.x, top: reorderState.y }}
        >
          Place {stepLabel(steps.find(({ id }) => id === reorderState.activeId)!)}
        </div>
      ) : null}
    </section>
  );
}

export { mutationTarget as spellRollStepMutationTarget };
