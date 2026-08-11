import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { Button } from '../../../components/ui/Button';
import { Collapsible } from '../../../components/ui/Collapsible';
import { DELETE_CONFIRMATION_TIMEOUT_MS } from '../../../components/ui/deleteConfirmation';
import { Dropdown, DropdownOption } from '../../../components/ui/Dropdown';
import { TextInput } from '../../../components/ui/FormField';
import { Modal } from '../../../components/ui/Modal';
import {
  ContextMenuController,
  type ContextMenuEntry,
} from '../../../components/ui/contextMenu';
import { OrderedCollectionController } from '../../../components/ui/orderedCollection';
import {
  CHAT_ROLL_SEND_TIMEOUT_MS,
} from '../../../shared/chatRoll';
import type { NetworkApi } from '../../../shared/network';
import {
  compileDnd5eCharacterAction,
  dnd5eActionPurposeLabel,
  type Dnd5eActionIssue,
  type Dnd5eActionStepPreview,
} from '../characterActions';
import {
  DND5E_ABILITIES,
  DND5E_ACTION_STEP_PURPOSES,
  DND5E_DAMAGE_TYPES,
  MAX_DND5E_ACTION_DICE_TIERS,
  MAX_DND5E_ACTION_STEPS,
  MAX_DND5E_ACTION_TERMS,
  MAX_DND5E_CHARACTER_ACTIONS,
  MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS,
  MAX_DND5E_CHARACTER_FIELD_CODE_UNITS,
  createDefaultDnd5eActionStep,
  createDefaultDnd5eCharacterAction,
  type Dnd5eActionDiceTier,
  type Dnd5eActionStep,
  type Dnd5eActionValueTerm,
  type Dnd5eCharacterAction,
  type Dnd5eCharacterActionMutation,
  type Dnd5eCharacterData,
  type Dnd5eDerivedCharacterValues,
} from '../characterData';
import { CharacterSheetAddEntryButton } from './CharacterSheetAddEntryButton';
import styles from './CharacterActionPanel.module.css';

interface CharacterActionPanelProps {
  actions: readonly Dnd5eCharacterAction[];
  campaignId: string;
  canEdit: boolean;
  data: Dnd5eCharacterData;
  derived: Dnd5eDerivedCharacterValues;
  networkApi?: NetworkApi;
  onChange: (mutation: Dnd5eCharacterActionMutation) => boolean;
  onCommit: (mutation: Dnd5eCharacterActionMutation) => Promise<boolean>;
  onError: (message: string) => void;
  onSave: () => Promise<boolean>;
}

interface ReorderState {
  actionId: string | null;
  activeId: string;
  orderedIds: readonly string[];
  scope: 'actions' | 'steps';
  x: number;
  y: number;
}

interface MenuPosition {
  clientX: number;
  clientY: number;
}

function actionLabel(action: Dnd5eCharacterAction): string {
  return action.name.trim() || 'Unnamed Action';
}

function stepLabel(step: Dnd5eActionStep): string {
  return step.label.trim() || `Unnamed ${dnd5eActionPurposeLabel(step.purpose)}`;
}

function move<T>(values: readonly T[], index: number, direction: 'down' | 'up') {
  const next = [...values];
  const target = index + (direction === 'down' ? 1 : -1);
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function EditorField({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div className={[styles.editorField, className].filter(Boolean).join(' ')}>
      <span className={styles.editorLabel}>{label}</span>
      {children}
    </div>
  );
}

function NumericField({
  accessibleLabel,
  minimum,
  onCommit,
  value,
}: {
  accessibleLabel: string;
  minimum?: number;
  onCommit: (value: number) => void;
  value: number;
}) {
  return (
    <TextInput
      aria-label={accessibleLabel}
      defaultValue={String(value)}
      inputMode="numeric"
      key={value}
      maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
      onBlur={(event) => {
        const draft = event.currentTarget.value;
        const parsed = /^[+-]?\d+$/u.test(draft.trim())
          ? Number(draft.trim())
          : Number.NaN;
        if (
          Number.isSafeInteger(parsed) &&
          (minimum === undefined || parsed >= minimum)
        ) {
          onCommit(parsed);
        } else {
          event.currentTarget.value = String(value);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

function TermEditor({
  allowDice,
  onChange,
  terms,
}: {
  allowDice: boolean;
  onChange: (terms: Dnd5eActionValueTerm[]) => void;
  terms: readonly Dnd5eActionValueTerm[];
}) {
  const update = (index: number, term: Dnd5eActionValueTerm) =>
    onChange(terms.map((current, currentIndex) =>
      currentIndex === index ? term : current));
  const remove = (index: number) =>
    onChange(terms.filter((_, currentIndex) => currentIndex !== index));
  const canAdd = terms.length < MAX_DND5E_ACTION_TERMS;
  const add = (term: Dnd5eActionValueTerm) => onChange([...terms, term]);
  return (
    <div className={styles.termEditor}>
      {terms.map((term, index) => (
        <div
          className={styles.termRow}
          data-term-kind={term.kind}
          key={`${term.kind}:${index}`}
        >
          <div className={styles.termHeader}>
            <Button
              aria-label={`Remove ${term.kind} term ${index + 1}`}
              className={styles.termRemove}
              size="compact"
              onClick={() => remove(index)}
            >
              Remove
            </Button>
          </div>
          <div className={styles.termControls}>
            {term.kind === 'dice' ? (
              <div className={styles.diceControls}>
                <EditorField label="Count">
                  <NumericField
                    accessibleLabel={`Dice ${index + 1} count`}
                    minimum={1}
                    value={term.count}
                    onCommit={(count) => update(index, { ...term, count })}
                  />
                </EditorField>
                <span aria-hidden className={styles.diceSeparator}>d</span>
                <EditorField label="Sides">
                  <NumericField
                    accessibleLabel={`Dice ${index + 1} sides`}
                    minimum={2}
                    value={term.sides}
                    onCommit={(sides) => update(index, { ...term, sides })}
                  />
                </EditorField>
              </div>
            ) : term.kind === 'ability' ? (
              <EditorField label="Ability modifier">
                <Dropdown
                  accessibleLabel={`Ability modifier ${index + 1}`}
                  label={term.ability}
                  panelLabel="Ability modifier options"
                >
                  {DND5E_ABILITIES.map((ability) => (
                    <DropdownOption
                      active={ability === term.ability}
                      key={ability}
                      label={ability}
                      onSelect={() => update(index, { ...term, ability })}
                    />
                  ))}
                </Dropdown>
              </EditorField>
            ) : term.kind === 'proficiency' ? (
              <EditorField label="Proficiency">
                <Dropdown
                  accessibleLabel={`Proficiency scale ${index + 1}`}
                  label={term.scale === 'once' ? 'Proficiency bonus'
                    : term.scale === 'twice' ? 'Double proficiency' : 'Half proficiency'}
                  panelLabel="Proficiency scale options"
                >
                  <DropdownOption
                    active={term.scale === 'half'}
                    label="Half proficiency"
                    onSelect={() => update(index, { ...term, scale: 'half' })}
                  />
                  <DropdownOption
                    active={term.scale === 'once'}
                    label="Proficiency bonus"
                    onSelect={() => update(index, { ...term, scale: 'once' })}
                  />
                  <DropdownOption
                    active={term.scale === 'twice'}
                    label="Double proficiency"
                    onSelect={() => update(index, { ...term, scale: 'twice' })}
                  />
                </Dropdown>
              </EditorField>
            ) : term.kind === 'flat' ? (
              <EditorField label="Flat modifier">
                <NumericField
                  accessibleLabel={`Flat modifier ${index + 1}`}
                  value={term.value}
                  onCommit={(value) => update(index, { ...term, value })}
                />
              </EditorField>
            ) : (
              <EditorField label="Character level">
                <span className={styles.termValue}>Current character level</span>
              </EditorField>
            )}
          </div>
          {term.kind === 'dice' ? (
            <>
              <div className={styles.scaleToggle}>
                <EditorField label="Scaling">
                  <Dropdown
                    accessibleLabel={`Dice ${index + 1} scaling`}
                    label={term.tiers.length > 0 ? 'Level-scaled dice' : 'Fixed dice'}
                    panelLabel={`Dice ${index + 1} scaling options`}
                  >
                    <DropdownOption
                      active={term.tiers.length === 0}
                      label="Fixed dice"
                      onSelect={() => update(index, { ...term, tiers: [] })}
                    />
                    <DropdownOption
                      active={term.tiers.length > 0}
                      label="Level-scaled dice"
                      onSelect={() => update(index, {
                        ...term,
                        tiers: term.tiers.length > 0
                          ? term.tiers
                          : [{ count: term.count, minimumLevel: 1 }],
                      })}
                    />
                  </Dropdown>
                </EditorField>
              </div>
              {term.tiers.length > 0 ? (
                <div className={styles.tierList} aria-label={`Dice ${index + 1} level tiers`}>
                  {term.tiers.map((tier, tierIndex) => (
                    <div className={styles.tierRow} key={`${tier.minimumLevel}:${tierIndex}`}>
                      <span>Lv</span>
                      <NumericField
                        accessibleLabel={`Dice ${index + 1} tier ${tierIndex + 1} minimum level`}
                        minimum={1}
                        value={tier.minimumLevel}
                        onCommit={(minimumLevel) => {
                          const tiers = term.tiers.map((current, currentIndex) =>
                            currentIndex === tierIndex
                              ? { ...current, minimumLevel }
                              : current);
                          tiers.sort((left, right) => left.minimumLevel - right.minimumLevel);
                          update(index, { ...term, tiers });
                        }}
                      />
                      <span>→</span>
                      <NumericField
                        accessibleLabel={`Dice ${index + 1} tier ${tierIndex + 1} count`}
                        minimum={1}
                        value={tier.count}
                        onCommit={(count) => update(index, {
                          ...term,
                          tiers: term.tiers.map((current, currentIndex) =>
                            currentIndex === tierIndex ? { ...current, count } : current),
                        })}
                      />
                      <span>d{term.sides}</span>
                      <Button
                        aria-label={`Remove dice ${index + 1} tier ${tierIndex + 1}`}
                        size="compact"
                        onClick={() => update(index, {
                          ...term,
                          tiers: term.tiers.filter((_, currentIndex) => currentIndex !== tierIndex),
                        })}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    disabled={term.tiers.length >= MAX_DND5E_ACTION_DICE_TIERS}
                    size="compact"
                    onClick={() => {
                      const previous = term.tiers.at(-1);
                      const tier: Dnd5eActionDiceTier = {
                        count: previous?.count ?? term.count,
                        minimumLevel: Math.min(20, (previous?.minimumLevel ?? 0) + 1),
                      };
                      if (term.tiers.some(({ minimumLevel }) => minimumLevel === tier.minimumLevel)) return;
                      update(index, { ...term, tiers: [...term.tiers, tier] });
                    }}
                  >
                    Add Tier
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ))}
      <EditorField className={styles.addTermField} label="Add term">
        <Dropdown
          accessibleLabel={allowDice ? 'Add roll term' : 'Add DC term'}
          className={styles.addTerm}
          disabled={!canAdd}
          label="Choose term type"
          panelLabel={allowDice ? 'Roll term types' : 'DC term types'}
        >
          {allowDice ? (
            <DropdownOption
              label="Dice"
              onSelect={() => add({ count: 1, kind: 'dice', sides: 6, tiers: [] })}
            />
          ) : null}
          <DropdownOption
            label="Ability modifier"
            onSelect={() => add({ ability: 'strength', kind: 'ability' })}
          />
          <DropdownOption
            label="Proficiency"
            onSelect={() => add({ kind: 'proficiency', scale: 'once' })}
          />
          <DropdownOption
            label="Character level"
            onSelect={() => add({ kind: 'level' })}
          />
          <DropdownOption
            label="Flat modifier"
            onSelect={() => add({ kind: 'flat', value: 0 })}
          />
        </Dropdown>
      </EditorField>
    </div>
  );
}

function StepEditor({
  action,
  canEdit,
  expanded,
  issues,
  onChange,
  onContextMenu,
  onExpandedChange,
  onKeyDown,
  onSave,
  preview,
  step,
}: {
  action: Dnd5eCharacterAction;
  canEdit: boolean;
  expanded: boolean;
  issues: readonly Dnd5eActionIssue[];
  onChange: (step: Dnd5eActionStep) => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  onExpandedChange: (expanded: boolean) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onSave: () => void;
  preview: Dnd5eActionStepPreview | undefined;
  step: Dnd5eActionStep;
}) {
  const updateTerms = (terms: Dnd5eActionValueTerm[]) => {
    if (step.purpose === 'save') {
      onChange({ ...step, dcTerms: terms.filter((term) => term.kind !== 'dice') });
    } else if (step.purpose !== 'effect') {
      onChange({ ...step, terms });
    }
  };
  return (
    <div
      data-action-step-order-id={step.id}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      <Collapsible
        className={styles.stepCard}
        contentClassName={styles.stepContent}
        expanded={expanded}
        label={(
          <span className={styles.stepSummary}>
            <span className={styles.stepIdentity}>
              <strong>{stepLabel(step)}</strong>
              <span>{dnd5eActionPurposeLabel(step.purpose)}</span>
            </span>
            <code data-incomplete={!preview || undefined}>
              {preview?.summary ?? 'Needs setup'}
            </code>
          </span>
        )}
        onExpandedChange={onExpandedChange}
      >
        <div className={styles.stepGrid}>
          <EditorField label="Step name">
            <TextInput
              aria-label={`${stepLabel(step)} label`}
              maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
              placeholder="Step name"
              readOnly={!canEdit}
              value={step.label}
              onBlur={onSave}
              onChange={(event) => onChange({ ...step, label: event.currentTarget.value })}
            />
          </EditorField>
          <EditorField label="Purpose">
            <Dropdown
              accessibleLabel={`${stepLabel(step)} purpose`}
              disabled={!canEdit}
              label={dnd5eActionPurposeLabel(step.purpose)}
              panelLabel="Action step purposes"
            >
              {DND5E_ACTION_STEP_PURPOSES.map((purpose) => (
                <DropdownOption
                  active={purpose === step.purpose}
                  key={purpose}
                  label={dnd5eActionPurposeLabel(purpose)}
                  onSelect={() => {
                    const converted = createDefaultDnd5eActionStep(purpose, step.id);
                    onChange({ ...converted, label: step.label });
                    onSave();
                  }}
                />
              ))}
            </Dropdown>
          </EditorField>
        </div>
        {step.purpose === 'effect' ? (
          <EditorField label="Effect">
            <textarea
              aria-label={`${stepLabel(step)} effect`}
              className={styles.compactTextarea}
              maxLength={MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS}
              placeholder="Describe the effect"
              readOnly={!canEdit}
              rows={2}
              value={step.text}
              onBlur={onSave}
              onChange={(event) => onChange({ ...step, text: event.currentTarget.value })}
            />
          </EditorField>
        ) : step.purpose === 'save' ? (
          <>
            <div className={styles.saveExpression}>
              <EditorField label="Save ability">
                <Dropdown
                  accessibleLabel={`${stepLabel(step)} saving throw ability`}
                  disabled={!canEdit}
                  label={step.ability}
                >
                  {DND5E_ABILITIES.map((ability) => (
                    <DropdownOption
                      active={ability === step.ability}
                      key={ability}
                      label={ability}
                      onSelect={() => {
                        onChange({ ...step, ability });
                        onSave();
                      }}
                    />
                  ))}
                </Dropdown>
              </EditorField>
              <TermEditor allowDice={false} onChange={updateTerms} terms={step.dcTerms} />
            </div>
            <div className={styles.stepGrid}>
              <EditorField label="On success">
                <textarea
                  aria-label={`${stepLabel(step)} success`}
                  className={styles.compactTextarea}
                  maxLength={MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS}
                  placeholder="Optional result"
                  readOnly={!canEdit}
                  rows={2}
                  value={step.success}
                  onBlur={onSave}
                  onChange={(event) => onChange({ ...step, success: event.currentTarget.value })}
                />
              </EditorField>
              <EditorField label="On failure">
                <textarea
                  aria-label={`${stepLabel(step)} failure`}
                  className={styles.compactTextarea}
                  maxLength={MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS}
                  placeholder="Optional result"
                  readOnly={!canEdit}
                  rows={2}
                  value={step.failure}
                  onBlur={onSave}
                  onChange={(event) => onChange({ ...step, failure: event.currentTarget.value })}
                />
              </EditorField>
            </div>
          </>
        ) : (
          <>
            {step.purpose === 'damage' ? (
              <div className={styles.stepGrid}>
                <EditorField label="Damage type">
                  <Dropdown
                    accessibleLabel={`${stepLabel(step)} damage type`}
                    disabled={!canEdit}
                    label={step.damageType || 'None'}
                  >
                    <DropdownOption label="None" onSelect={() => {
                      onChange({ ...step, damageType: null });
                      onSave();
                    }} />
                    {DND5E_DAMAGE_TYPES.map((damageType) => (
                      <DropdownOption
                        active={damageType === step.damageType}
                        key={damageType}
                        label={damageType}
                        onSelect={() => {
                          onChange({ ...step, damageType });
                          onSave();
                        }}
                      />
                    ))}
                    <DropdownOption label="Custom" onSelect={() => {
                      onChange({ ...step, damageType: 'Custom' });
                      onSave();
                    }} />
                  </Dropdown>
                </EditorField>
                <EditorField label="Critical source">
                  <Dropdown
                    accessibleLabel={`${stepLabel(step)} critical source`}
                    disabled={!canEdit}
                    label={action.steps.find(({ id }) =>
                      id === step.criticalSourceStepId)?.label || 'None'}
                  >
                    <DropdownOption label="None" onSelect={() => {
                      onChange({ ...step, criticalSourceStepId: null });
                      onSave();
                    }} />
                    {action.steps.filter((candidate) => candidate.purpose === 'attack').map((attack) => (
                      <DropdownOption
                        active={attack.id === step.criticalSourceStepId}
                        key={attack.id}
                        label={stepLabel(attack)}
                        onSelect={() => {
                          onChange({ ...step, criticalSourceStepId: attack.id });
                          onSave();
                        }}
                      />
                    ))}
                  </Dropdown>
                </EditorField>
                {step.damageType && !DND5E_DAMAGE_TYPES.includes(
                  step.damageType as (typeof DND5E_DAMAGE_TYPES)[number],
                ) ? (
                  <EditorField label="Custom type">
                    <TextInput
                      aria-label={`${stepLabel(step)} custom damage type`}
                      maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                      readOnly={!canEdit}
                      value={step.damageType}
                      onBlur={onSave}
                      onChange={(event) => onChange({
                        ...step,
                        damageType: event.currentTarget.value,
                      })}
                    />
                  </EditorField>
                ) : null}
              </div>
            ) : null}
            <TermEditor allowDice onChange={updateTerms} terms={step.terms} />
          </>
        )}
        {issues.length > 0 ? (
          <ul className={styles.stepIssues} aria-label={`${stepLabel(step)} incomplete fields`}>
            {issues.map((issue, index) => (
              <li key={`${issue.message}:${index}`}>{issue.message}</li>
            ))}
          </ul>
        ) : null}
      </Collapsible>
    </div>
  );
}

export function CharacterActionPanel({
  actions,
  campaignId,
  canEdit,
  data,
  derived,
  networkApi,
  onChange,
  onCommit,
  onError,
  onSave,
}: CharacterActionPanelProps) {
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedStepIds, setExpandedStepIds] = useState<ReadonlySet<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [reorderState, setReorderState] = useState<ReorderState | null>(null);
  const actionListRef = useRef<HTMLDivElement | null>(null);
  const stepListRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<ContextMenuController | null>(null);
  const orderRef = useRef<OrderedCollectionController | null>(null);

  useEffect(() => {
    menuRef.current = new ContextMenuController();
    return () => menuRef.current?.close();
  }, []);

  const compiled = useMemo(() => new Map(actions.map((action) => [
    action.id,
    compileDnd5eCharacterAction(action, data, derived),
  ])), [actions, data, derived]);

  const displayedActions = useMemo(() => {
    if (reorderState?.scope !== 'actions') return actions;
    const ordered = reorderState.orderedIds.flatMap((id) =>
      actions.find((action) => action.id === id) ?? []);
    const ids = new Set(ordered.map(({ id }) => id));
    return [...ordered, ...actions.filter(({ id }) => !ids.has(id))];
  }, [actions, reorderState]);

  const updateAction = (action: Dnd5eCharacterAction) => onChange({
    changes: {
      activation: action.activation,
      description: action.description,
      duration: action.duration,
      name: action.name,
      range: action.range,
      steps: action.steps,
      target: action.target,
    },
    id: action.id,
    kind: 'update',
  });

  const commitAction = (action: Dnd5eCharacterAction) => onCommit({
    changes: {
      activation: action.activation,
      description: action.description,
      duration: action.duration,
      name: action.name,
      range: action.range,
      steps: action.steps,
      target: action.target,
    },
    id: action.id,
    kind: 'update',
  });

  const editAction = (action: Dnd5eCharacterAction) => {
    setDetailsId(null);
    setEditingId(action.id);
    setExpandedStepIds(new Set(action.steps.slice(0, 1).map(({ id }) => id)));
  };

  const beginActionReorder = (action: Dnd5eCharacterAction, position: MenuPosition) => {
    const controller = new OrderedCollectionController(
      () => actions.map(({ id }) => id),
      (orderedIds) => onCommit({ kind: 'reorder', orderedIds }),
    );
    orderRef.current = controller;
    const snapshot = controller.begin(action.id);
    if (snapshot) setReorderState({
      actionId: null,
      activeId: action.id,
      orderedIds: snapshot.orderedIds,
      scope: 'actions',
      x: position.clientX,
      y: position.clientY,
    });
  };

  const beginStepReorder = (
    action: Dnd5eCharacterAction,
    step: Dnd5eActionStep,
    position: MenuPosition,
  ) => {
    const controller = new OrderedCollectionController(
      () => action.steps.map(({ id }) => id),
      async (orderedIds) => {
        const ordered = orderedIds.flatMap((id) =>
          action.steps.find((candidate) => candidate.id === id) ?? []);
        return commitAction({ ...action, steps: ordered });
      },
    );
    orderRef.current = controller;
    const snapshot = controller.begin(step.id);
    if (snapshot) setReorderState({
      actionId: action.id,
      activeId: step.id,
      orderedIds: snapshot.orderedIds,
      scope: 'steps',
      x: position.clientX,
      y: position.clientY,
    });
  };

  useEffect(() => {
    if (!reorderState) return undefined;
    const list = reorderState.scope === 'actions'
      ? actionListRef.current
      : stepListRef.current;
    const attribute = reorderState.scope === 'actions'
      ? 'data-action-order-id'
      : 'data-action-step-order-id';
    const movePointer = (event: PointerEvent) => {
      const target = (event.target as Element | null)?.closest<HTMLElement>(`[${attribute}]`);
      let snapshot = orderRef.current?.active;
      if (target && list?.contains(target)) {
        const id = target.getAttribute(attribute);
        const index = snapshot?.orderedIds.indexOf(id ?? '') ?? 0;
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
      if (event.button === 2 || !list?.contains(event.target as Node)) {
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

  const armDelete = (
    label: string,
    targetLabel: string,
    remove: () => void,
  ): ContextMenuEntry => {
    let armedUntil = 0;
    return {
      danger: true,
      kind: 'action',
      label,
      onSelect: (button) => {
        const now = Date.now();
        if (now > armedUntil) {
          armedUntil = now + DELETE_CONFIRMATION_TIMEOUT_MS;
          const expected = armedUntil;
          button.textContent = `Confirm ${label}`;
          button.setAttribute('aria-label', `Confirm deletion of ${targetLabel}`);
          button.setAttribute('aria-pressed', 'true');
          window.setTimeout(() => {
            if (button.isConnected && armedUntil === expected && Date.now() >= expected) {
              button.textContent = label;
              button.removeAttribute('aria-label');
              button.setAttribute('aria-pressed', 'false');
            }
          }, DELETE_CONFIRMATION_TIMEOUT_MS);
          return false;
        }
        remove();
      },
    };
  };

  const openActionMenu = (
    action: Dnd5eCharacterAction,
    position: MenuPosition,
    returnFocus?: () => void,
  ) => {
    const index = actions.findIndex(({ id }) => id === action.id);
    const entries: ContextMenuEntry[] = [
      {
        kind: 'action',
        label: 'Details',
        onSelect: () => {
          setEditingId(null);
          setDetailsId(action.id);
        },
      },
    ];
    if (canEdit) {
      entries.push(
        { kind: 'action', label: 'Edit', onSelect: () => editAction(action) },
        { kind: 'divider' },
        {
          disabled: index <= 0,
          kind: 'action',
          label: 'Move Up',
          onSelect: () => void onCommit({ direction: 'up', id: action.id, kind: 'move' }),
        },
        {
          disabled: index === actions.length - 1,
          kind: 'action',
          label: 'Move Down',
          onSelect: () => void onCommit({ direction: 'down', id: action.id, kind: 'move' }),
        },
        {
          kind: 'action',
          label: 'Reorder Freely',
          onSelect: () => beginActionReorder(action, position),
        },
        { kind: 'divider' },
        armDelete('Delete', actionLabel(action), () => {
          void onCommit({ id: action.id, kind: 'delete' });
        }),
      );
    }
    menuRef.current?.open(
      position.clientX,
      position.clientY,
      `${actionLabel(action)} actions`,
      entries,
      returnFocus ?? (() => actionListRef.current
        ?.querySelector<HTMLElement>(`[data-action-order-id="${action.id}"] button`)
        ?.focus()),
      actionListRef.current?.closest('dialog') ?? undefined,
    );
  };

  const openActionContext = (event: ReactMouseEvent, action: Dnd5eCharacterAction) => {
    event.preventDefault();
    openActionMenu(action, event);
  };

  const openActionKeyboardMenu = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    action: Dnd5eCharacterAction,
  ) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    const button = event.currentTarget;
    const bounds = button.getBoundingClientRect();
    openActionMenu(
      action,
      { clientX: bounds.left + Math.min(bounds.width / 2, 24), clientY: bounds.bottom },
      () => button.focus(),
    );
  };

  const openStepMenu = (
    action: Dnd5eCharacterAction,
    step: Dnd5eActionStep,
    position: MenuPosition,
    returnFocus?: () => void,
  ) => {
    const index = action.steps.findIndex(({ id }) => id === step.id);
    const commitSteps = (steps: Dnd5eActionStep[]) => void commitAction({ ...action, steps });
    const entries: ContextMenuEntry[] = [
      {
        disabled: index <= 0,
        kind: 'action',
        label: 'Move Up',
        onSelect: () => commitSteps(move(action.steps, index, 'up')),
      },
      {
        disabled: index === action.steps.length - 1,
        kind: 'action',
        label: 'Move Down',
        onSelect: () => commitSteps(move(action.steps, index, 'down')),
      },
      {
        kind: 'action',
        label: 'Reorder Freely',
        onSelect: () => beginStepReorder(action, step, position),
      },
      { kind: 'divider' },
      armDelete('Delete', stepLabel(step), () =>
        commitSteps(action.steps.filter(({ id }) => id !== step.id))),
    ];
    menuRef.current?.open(
      position.clientX,
      position.clientY,
      `${stepLabel(step)} actions`,
      entries,
      returnFocus,
      stepListRef.current?.closest('dialog') ?? undefined,
    );
  };

  const openStepContext = (
    event: ReactMouseEvent,
    action: Dnd5eCharacterAction,
    step: Dnd5eActionStep,
  ) => {
    if (!canEdit) return;
    event.preventDefault();
    openStepMenu(action, step, event);
  };

  const openStepKeyboardMenu = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    action: Dnd5eCharacterAction,
    step: Dnd5eActionStep,
  ) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    const focused = event.target instanceof HTMLElement ? event.target : null;
    const bounds = event.currentTarget.getBoundingClientRect();
    openStepMenu(
      action,
      step,
      { clientX: bounds.left + Math.min(bounds.width / 2, 24), clientY: bounds.bottom },
      () => focused?.focus(),
    );
  };

  const executeAction = async (action: Dnd5eCharacterAction) => {
    if (!networkApi) {
      onError('Chat is unavailable.');
      return;
    }
    const candidate = compiled.get(action.id);
    if (!candidate?.ok || pendingIds.has(action.id) || reorderState) return;
    setPendingIds((current) => new Set(current).add(action.id));
    let timer = 0;
    try {
      const timeout = new Promise<Awaited<ReturnType<NetworkApi['sendChatRoll']>>>((resolve) => {
        timer = window.setTimeout(() => resolve({
          error: { code: 'timeout', message: 'The host did not acknowledge this roll.' },
          ok: false,
        }), CHAT_ROLL_SEND_TIMEOUT_MS);
      });
      const result = await Promise.race([
        networkApi.sendChatRoll({
          campaignId,
          clientMessageId: crypto.randomUUID(),
          definition: candidate.definition,
          recipient: null,
        }),
        timeout,
      ]);
      if (!result.ok) onError(result.error.message);
    } catch {
      onError('The Action could not be rolled.');
    } finally {
      window.clearTimeout(timer);
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(action.id);
        return next;
      });
    }
  };

  const editingAction = actions.find(({ id }) => id === editingId) ?? null;
  const detailsAction = actions.find(({ id }) => id === detailsId) ?? null;
  const modalAction = editingAction ?? detailsAction;
  const modalCompiled = modalAction ? compiled.get(modalAction.id) : null;
  const displayedSteps = modalAction && reorderState?.scope === 'steps' &&
    reorderState.actionId === modalAction.id
    ? reorderState.orderedIds.flatMap((id) =>
        modalAction.steps.find((step) => step.id === id) ?? [])
    : modalAction?.steps ?? [];

  return (
    <>
      <div className={styles.panelBody}>
        <div aria-label="Character actions" className={styles.actionList} ref={actionListRef} role="list">
          {displayedActions.map((action) => {
            const result = compiled.get(action.id);
            const disabled = !networkApi || !result?.ok || pendingIds.has(action.id);
            return (
              <div
                className={styles.actionRow}
                data-action-order-id={action.id}
                data-reordering={reorderState?.activeId === action.id}
                key={action.id}
                onContextMenu={(event) => openActionContext(event, action)}
                role="listitem"
              >
                <button
                  aria-busy={pendingIds.has(action.id)}
                  aria-label={`Use ${actionLabel(action)}`}
                  className={styles.actionUse}
                  disabled={disabled}
                  title={result?.ok
                    ? `Use ${actionLabel(action)}. Right-click for details.`
                    : `${result?.issues[0]?.message ?? 'Needs setup'} Right-click for details.`}
                  type="button"
                  onClick={() => void executeAction(action)}
                  onKeyDown={(event) => openActionKeyboardMenu(event, action)}
                >
                  <strong>{actionLabel(action)}</strong>
                </button>
              </div>
            );
          })}
        </div>
        {canEdit ? (
          <div className={styles.addRow}>
            <CharacterSheetAddEntryButton
            disabled={actions.length >= MAX_DND5E_CHARACTER_ACTIONS}
            label="Add Action"
            onClick={() => {
              const action = createDefaultDnd5eCharacterAction();
              if (!onChange({ action, kind: 'add' })) return;
              setEditingId(action.id);
              setExpandedStepIds(new Set());
              void onSave();
            }}
            />
          </div>
        ) : null}
      </div>

      <Modal
        accessibleLabel={modalAction
          ? `${actionLabel(modalAction)} action ${editingAction ? 'editor' : 'details'}`
          : 'Action details'}
        className={[
          styles.actionModal,
          editingAction ? styles.actionEditorModal : styles.actionDetailsModal,
        ].join(' ')}
        contentClassName={styles.actionModalContent}
        initialFocus="dialog"
        isOpen={modalAction !== null}
        onDismiss={() => {
          setEditingId(null);
          setDetailsId(null);
        }}
      >
        {modalAction ? (
          <>
            {editingAction ? (
              <div className={styles.builderLayout}>
                <div className={styles.builderMain}>
                  <div className={styles.actionBasics}>
                    <EditorField label="Action name">
                      <TextInput
                        aria-label="Action Name"
                        maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                        placeholder="Action name"
                        value={editingAction.name}
                        onBlur={() => void onSave()}
                        onChange={(event) => updateAction({
                          ...editingAction,
                          name: event.currentTarget.value,
                        })}
                      />
                    </EditorField>
                    <EditorField label="Description">
                      <textarea
                        aria-label="Action description"
                        className={styles.actionDescription}
                        maxLength={MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS}
                        placeholder="Describe the action"
                        rows={3}
                        value={editingAction.description}
                        onBlur={() => void onSave()}
                        onChange={(event) => updateAction({
                          ...editingAction,
                          description: event.currentTarget.value,
                        })}
                      />
                    </EditorField>
                  </div>
                  <section className={styles.stepBuilder}>
                    <div className={styles.stepList} ref={stepListRef} role="list">
                      {displayedSteps.map((step) => (
                        <StepEditor
                          action={editingAction}
                          canEdit
                          expanded={expandedStepIds.has(step.id)}
                          issues={modalCompiled && !modalCompiled.ok
                            ? modalCompiled.issues.filter(({ stepId }) => stepId === step.id)
                            : []}
                          key={step.id}
                          preview={modalCompiled?.previews.find(({ stepId }) => stepId === step.id)}
                          step={step}
                          onContextMenu={(event) => openStepContext(event, editingAction, step)}
                          onKeyDown={(event) => openStepKeyboardMenu(
                            event,
                            editingAction,
                            step,
                          )}
                          onExpandedChange={(expanded) => setExpandedStepIds((current) => {
                            const next = new Set(current);
                            if (expanded) next.add(step.id);
                            else next.delete(step.id);
                            return next;
                          })}
                          onSave={() => void onSave()}
                          onChange={(updated) => updateAction({
                            ...editingAction,
                            steps: editingAction.steps.map((current) =>
                              current.id === updated.id ? updated : current),
                          })}
                        />
                      ))}
                    </div>
                    {editingAction.steps.length === 0 ? (
                      <div className={styles.emptySteps}>
                        <strong>This action has no steps yet.</strong>
                        <span>Add a step to describe what happens when it is used.</span>
                      </div>
                    ) : null}
                    <CharacterSheetAddEntryButton
                      disabled={editingAction.steps.length >= MAX_DND5E_ACTION_STEPS}
                      label="Add Step"
                      onClick={() => {
                        const step = createDefaultDnd5eActionStep();
                        updateAction({
                          ...editingAction,
                          steps: [...editingAction.steps, step],
                        });
                        setExpandedStepIds(new Set([step.id]));
                        void onSave();
                      }}
                    />
                  </section>
                </div>
              </div>
            ) : (
              <div className={styles.detailsLayout}>
                <div className={styles.detailsMetadata}>
                  {([
                    ['Activation', modalAction.activation],
                    ['Range', modalAction.range],
                    ['Target', modalAction.target],
                    ['Duration', modalAction.duration],
                  ] as const).filter(([, value]) => value.trim()).map(([label, value]) => (
                    <p key={label}><strong>{label}</strong><span>{value}</span></p>
                  ))}
                  {modalAction.description.trim() ? <p>{modalAction.description}</p> : null}
                </div>
                <div className={styles.detailsSteps}>
                  {displayedSteps.map((step) => {
                    const preview = modalCompiled?.previews.find(({ stepId }) => stepId === step.id);
                    return (
                      <section className={styles.detailsStep} key={step.id}>
                        <div>
                          <strong>{stepLabel(step)}</strong>
                          <span>{dnd5eActionPurposeLabel(step.purpose)}</span>
                        </div>
                        <code>{preview?.summary ?? 'Incomplete'}</code>
                      </section>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : null}
      </Modal>

      {reorderState ? (
        <div
          className={styles.reorderGhost}
          style={{ transform: `translate3d(${reorderState.x + 12}px, ${reorderState.y + 12}px, 0)` }}
        >
          Move {reorderState.scope === 'actions'
            ? actionLabel(actions.find(({ id }) => id === reorderState.activeId)!)
            : stepLabel(modalAction!.steps.find(({ id }) => id === reorderState.activeId)!)}
        </div>
      ) : null}
    </>
  );
}
