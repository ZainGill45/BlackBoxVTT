import {
  Axe,
  CircleUserRound,
  Cog,
  Cross,
  Crosshair,
  Crown,
  Eye,
  Footprints,
  HandFist,
  KeyRound,
  Leaf,
  Music2,
  Shield,
  ShieldCheck,
  Sparkles,
  Swords,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { Button } from '../../../components/ui/Button';
import { ContextMenuController } from '../../../components/ui/contextMenu';
import { Dropdown, DropdownOption } from '../../../components/ui/Dropdown';
import { InlineInput } from '../../../components/ui/InlineInput';
import { Modal } from '../../../components/ui/Modal';
import { Tabs, type TabOption } from '../../../components/ui/Tabs';
import { CHAT_SEND_TIMEOUT_MS } from '../../../shared/chat';
import {
  CHAT_ROLL_SEND_TIMEOUT_MS,
  type ChatRollDefinition,
} from '../../../shared/chatRoll';
import type { CampaignSystemState } from '../../../shared/gameSystems';
import {
  JOURNAL_AUTOSAVE_DELAY_MS,
  MAX_JOURNAL_TITLE_INPUT_CODE_UNITS,
  normalizeJournalTitle,
  type JournalEntry,
  type SystemJournalEntry,
} from '../../../shared/journal';
import type {
  CharacterSheetJournalApi,
  CharacterSheetNetworkApi,
  JournalWindowGeometry,
} from '../../../shared/journalWindows';
import {
  createDnd5eAbilityRollDefinition,
  createDnd5eHitDieRollDefinition,
  createDnd5eSkillRollDefinition,
  createDnd5eStatisticRollDefinition,
  type Dnd5eAbilityRollKind,
  type Dnd5eStatisticRollKind,
} from '../characterActions';
import {
  applyDnd5eCharacterActionMutations,
  applyDnd5eCharacterCustomSkillMutations,
  applyDnd5eCharacterFeatureMutations,
  applyDnd5eCharacterInventoryMutations,
  applyDnd5eCharacterResourceMutations,
  applyDnd5eCharacterSpellMutations,
  calculateDnd5eOffsetForTotal,
  createDefaultDnd5eCharacterData,
  defaultDnd5eSpellcastingAbilityForClass,
  DND5E_5_5E_CLASSES,
  DND5E_ABILITIES,
  DND5E_CHARACTER_LEVELS,
  DND5E_SKILLS,
  DND5E_SPELL_SLOT_LEVELS,
  deriveDnd5eCharacterValues,
  formatDnd5eSignedValue,
  hasUsableDnd5eSpellSlot,
  isDnd5eCharacterData,
  MAX_DND5E_CHARACTER_FIELD_CODE_UNITS,
  parseDnd5eSafeInteger,
  parseDnd5eNonnegativeSafeInteger,
  type Dnd5eAbilityId,
  type Dnd5eCharacterActionMutation,
  type Dnd5eCharacterCustomSkillMutation,
  type Dnd5eCharacterData,
  type Dnd5eCharacterFeatureMutation,
  type Dnd5eCharacterInventoryMutation,
  type Dnd5eCharacterResourceMutation,
  type Dnd5eCharacterSpellMutation,
  type Dnd5eDerivedCharacterValues,
  type Dnd5eRulesVersion,
  type Dnd5eSpellSlotLevel,
} from '../characterData';
import { createDnd5eFeatureChatContent } from '../characterFeatureChat';
import { createDnd5eInventoryEntryChatContent } from '../characterInventoryChat';
import {
  DND5E_CHARACTER_ENTRY_TYPE_ID,
  isDnd5eSettings,
} from '../definition';
import { CharacterActionPanel } from './CharacterActionPanel';
import { CharacterCustomSkillPanel } from './CharacterCustomSkillPanel';
import { CharacterFeaturePanel } from './CharacterFeaturePanel';
import { CharacterInventoryPanel } from './CharacterInventoryPanel';
import { CharacterResourcePanel } from './CharacterResourcePanel';
import { CharacterSkillTrainingButton } from './CharacterSkillTrainingButton';
import { CharacterSpellPanel } from './CharacterSpellPanel';
import styles from './CharacterSheetModal.module.css';

type CharacterSheetTab = 'home' | 'settings' | 'spells';

export interface CharacterSheetProps {
  campaignId: string;
  entry: SystemJournalEntry;
  journalApi: CharacterSheetJournalApi;
  networkApi?: CharacterSheetNetworkApi;
  onDismiss: () => void;
  onUpdated: (entry: SystemJournalEntry) => void;
  system: CampaignSystemState;
}

interface CharacterSheetEditorProps extends CharacterSheetProps {
  closeRequestId: number;
  presentation: 'detached' | 'modal';
}

interface CharacterSheetPresentationProps {
  accessibleLabel: string;
  children: ReactNode;
  onDismiss: () => void;
  presentation: CharacterSheetEditorProps['presentation'];
}

interface CharacterFieldProps {
  accessibleLabel?: string;
  className?: string;
  label: string;
  maxLength?: number;
  onBlur: () => void;
  onChange: (value: string) => void;
  readOnly: boolean;
  title: string;
  value: string;
}

interface AbilityValueFieldProps {
  accessibleLabel: string;
  label: string;
  onBlur: () => void;
  onChange: (value: string) => void;
  onRoll: () => void;
  readOnly: boolean;
  rollAccessibleLabel: string;
  rollDisabled: boolean;
  rollPending: boolean;
  value: string;
}

const ABILITY_LABELS: Record<Dnd5eAbilityId, string> = {
  charisma: 'Charisma',
  constitution: 'Constitution',
  dexterity: 'Dexterity',
  intelligence: 'Intelligence',
  strength: 'Strength',
  wisdom: 'Wisdom',
};

const SPELL_SLOT_LEVEL_LABELS: Record<Dnd5eSpellSlotLevel, string> = {
  '1': '1st Level',
  '2': '2nd Level',
  '3': '3rd Level',
  '4': '4th Level',
  '5': '5th Level',
  '6': '6th Level',
  '7': '7th Level',
  '8': '8th Level',
  '9': '9th Level',
};

const CLASS_ICONS = {
  Artificer: Cog,
  Barbarian: Axe,
  Bard: Music2,
  Cleric: Cross,
  Druid: Leaf,
  Fighter: Swords,
  Monk: HandFist,
  Paladin: ShieldCheck,
  Ranger: Crosshair,
  Rogue: KeyRound,
  Sorcerer: Sparkles,
  Warlock: Eye,
  Wizard: WandSparkles,
} satisfies Record<(typeof DND5E_5_5E_CLASSES)[number], LucideIcon>;

const LEVEL_ICONS: Readonly<Record<string, LucideIcon>> = Object.fromEntries(
  DND5E_CHARACTER_LEVELS.map((level) => {
    const value = Number(level);
    const Icon = value <= 4
      ? Footprints
      : value <= 10
        ? Shield
        : value <= 16
          ? Swords
          : Crown;
    return [level, Icon];
  }),
);

const IMPORTANT_STATS = [
  {
    accessibleLabel: 'Initiative',
    derivedKey: 'initiative',
    label: 'Initiative',
    offsetKey: 'initiativeOffset',
    rollKind: 'initiative',
  },
  {
    accessibleLabel: 'Armor Class',
    label: 'Armor Class',
    path: 'armorClass',
    shareKey: 'armorClass',
  },
  {
    accessibleLabel: 'Current Speed',
    label: 'Speed',
    path: 'currentSpeed',
    shareKey: 'currentSpeed',
  },
  {
    accessibleLabel: 'Concentration Save',
    derivedKey: 'concentrationSave',
    label: 'Concentration',
    offsetKey: 'concentrationSaveOffset',
    rollKind: 'concentration',
  },
  {
    accessibleLabel: 'Proficiency Bonus',
    derivedKey: 'proficiencyBonus',
    label: 'Proficiency',
    offsetKey: 'proficiencyBonusOffset',
    shareKey: 'proficiencyBonus',
  },
  {
    accessibleLabel: 'Inspiration Count',
    label: 'Inspiration',
    path: 'inspirationCount',
    shareKey: 'inspirationCount',
  },
] as const;

type ImportantStatShareKey =
  | 'armorClass'
  | 'currentSpeed'
  | 'inspirationCount'
  | 'proficiencyBonus';

type CharacterShareKey =
  | ImportantStatShareKey
  | 'hitDice'
  | 'hitPoints'
  | 'temporaryHitPoints'
  | `feature:${string}`
  | `inventory:${string}`
  | `resource:${string}`;

function isCharacterEntry(
  entry: JournalEntry,
): entry is SystemJournalEntry & { data: Dnd5eCharacterData } {
  return entry.kind === 'system' &&
    entry.typeId === DND5E_CHARACTER_ENTRY_TYPE_ID &&
    isDnd5eCharacterData(entry.data);
}

function parseCharacterEntry(
  entry: JournalEntry,
): (SystemJournalEntry & { data: Dnd5eCharacterData }) | null {
  return isCharacterEntry(entry) ? entry : null;
}

function requireDnd5eDerivedValues(
  data: Dnd5eCharacterData,
  rulesVersion: Dnd5eRulesVersion,
) {
  const values = deriveDnd5eCharacterValues(data, rulesVersion);
  if (values === null) throw new RangeError('D&D character values exceed the safe integer range.');
  return values;
}

type CharacterFieldValue = string | number | null;

function readField(data: Dnd5eCharacterData, path: string): CharacterFieldValue {
  let value: unknown = data;
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' || typeof value === 'number' || value === null
    ? value
    : null;
}

function readStringField(data: Dnd5eCharacterData, path: string): string {
  const value = readField(data, path);
  return typeof value === 'string' ? value : '';
}

function writeField(
  data: Dnd5eCharacterData,
  path: string,
  value: CharacterFieldValue,
): Dnd5eCharacterData {
  const next = structuredClone(data);
  const parts = path.split('.');
  let target = next as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    target = target[part] as Record<string, unknown>;
  }
  target[parts.at(-1)!] = value;
  return next;
}

function mergeFields(
  data: Dnd5eCharacterData,
  fields: ReadonlyMap<string, CharacterFieldValue>,
): Dnd5eCharacterData {
  let next = structuredClone(data);
  for (const [path, value] of fields) next = writeField(next, path, value);
  return next;
}

function mergeCharacterDraft(
  data: Dnd5eCharacterData,
  fields: ReadonlyMap<string, CharacterFieldValue>,
  actionMutations: readonly Dnd5eCharacterActionMutation[],
  customSkillMutations: readonly Dnd5eCharacterCustomSkillMutation[],
  inventoryMutations: readonly Dnd5eCharacterInventoryMutation[],
  resourceMutations: readonly Dnd5eCharacterResourceMutation[],
  featureMutations: readonly Dnd5eCharacterFeatureMutation[],
  spellMutations: readonly Dnd5eCharacterSpellMutation[],
) {
  const next = mergeFields(data, fields);
  const actions = applyDnd5eCharacterActionMutations(
    next.actions,
    actionMutations,
  );
  const customSkills = applyDnd5eCharacterCustomSkillMutations(
    next.customSkills,
    customSkillMutations,
  );
  const inventory = applyDnd5eCharacterInventoryMutations(
    next.inventory,
    inventoryMutations,
  );
  const resources = applyDnd5eCharacterResourceMutations(
    next.resources,
    resourceMutations,
  );
  const features = applyDnd5eCharacterFeatureMutations(
    next.features,
    featureMutations,
  );
  const spells = applyDnd5eCharacterSpellMutations(
    next.spellcasting.spells,
    spellMutations,
  );
  return {
    data: {
      ...next,
      actions: actions.actions,
      customSkills: customSkills.skills,
      features: features.features,
      inventory: inventory.inventory,
      resources: resources.resources,
      spellcasting: { ...next.spellcasting, spells: spells.spells },
    },
    missingActionIds: actions.missingIds,
    missingCustomSkillIds: customSkills.missingIds,
    invalidInventory: inventory.invalid,
    missingFeatureIds: features.missingIds,
    missingInventoryIds: inventory.missingIds,
    missingResourceIds: resources.missingIds,
    missingSpellIds: spells.missingIds,
  };
}

function actionMutationTarget(
  mutation: Dnd5eCharacterActionMutation,
): string | null {
  return mutation.kind === 'update' || mutation.kind === 'move'
    ? mutation.id
    : null;
}

function customSkillMutationTarget(
  mutation: Dnd5eCharacterCustomSkillMutation,
): string | null {
  return mutation.kind === 'update' || mutation.kind === 'move'
    ? mutation.id
    : null;
}

function featureMutationTarget(
  mutation: Dnd5eCharacterFeatureMutation,
): string | null {
  return mutation.kind === 'update' || mutation.kind === 'move'
    ? mutation.id
    : null;
}

function resourceMutationTarget(
  mutation: Dnd5eCharacterResourceMutation,
): string | null {
  return mutation.kind === 'update' || mutation.kind === 'move'
    ? mutation.id
    : null;
}

function inventoryMutationReferences(
  mutation: Dnd5eCharacterInventoryMutation,
): readonly string[] {
  if (mutation.kind === 'add') {
    return mutation.parentId === null ? [] : [mutation.parentId];
  }
  if (
    mutation.kind === 'set-currency' ||
    mutation.kind === 'set-variant-encumbrance' ||
    mutation.kind === 'delete'
  ) {
    return [];
  }
  return mutation.kind === 'place' && mutation.parentId !== null
    ? [mutation.id, mutation.parentId]
    : [mutation.id];
}

function CharacterField({
  accessibleLabel,
  className,
  label,
  maxLength = MAX_DND5E_CHARACTER_FIELD_CODE_UNITS,
  onBlur,
  onChange,
  readOnly,
  title,
  value,
}: CharacterFieldProps) {
  return (
    <label className={[styles.field, className].filter(Boolean).join(' ')}>
      <input
        aria-label={accessibleLabel ?? label}
        autoComplete="off"
        maxLength={maxLength}
        placeholder={label}
        readOnly={readOnly}
        title={title}
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function AbilityValueField({
  accessibleLabel,
  label,
  onBlur,
  onChange,
  onRoll,
  readOnly,
  rollAccessibleLabel,
  rollDisabled,
  rollPending,
  value,
}: AbilityValueFieldProps) {
  return (
    <div className={styles.abilityValueField}>
      <button
        aria-busy={rollPending}
        aria-label={rollAccessibleLabel}
        className={styles.abilityRollButton}
        disabled={rollDisabled}
        title={rollDisabled && !rollPending ? 'Chat is unavailable.' : rollAccessibleLabel}
        type="button"
        onClick={onRoll}
      >
        {label}
      </button>
      <InlineInput
        aria-label={accessibleLabel}
        autoComplete="off"
        className={styles.abilityValueInput}
        maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
        readOnly={readOnly}
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </div>
  );
}

function spellMutationTarget(
  mutation: Dnd5eCharacterSpellMutation,
): string | null {
  return mutation.kind === 'set-preparation' ? mutation.entryId : null;
}

export function measureCharacterSheetModal(): JournalWindowGeometry {
  const rootFontSize = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  ) || 16;
  const probe = document.createElement('dialog');
  probe.className = styles.modal;
  probe.setAttribute('open', '');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.position = 'fixed';
  probe.style.pointerEvents = 'none';
  probe.style.visibility = 'hidden';
  document.body.append(probe);
  const bounds = probe.getBoundingClientRect();
  probe.remove();
  const fallbackHeight = window.innerHeight - rootFontSize * 2;
  return {
    contentHeight: Math.round(bounds.height || fallbackHeight),
    contentWidth: Math.round(
      bounds.width || Math.min(window.innerWidth - rootFontSize * 2, fallbackHeight * 0.777),
    ),
    rootFontSize,
  };
}

function CharacterSheetPresentation({
  accessibleLabel,
  children,
  onDismiss,
  presentation,
}: CharacterSheetPresentationProps) {
  return presentation === 'modal' ? (
    <Modal
      accessibleLabel={accessibleLabel}
      className={styles.modal}
      contentClassName={styles.content}
      initialFocus="dialog"
      isOpen
      onDismiss={onDismiss}
    >
      {children}
    </Modal>
  ) : (
    <div
      aria-label={accessibleLabel}
      className={styles.detached}
      role="document"
    >
      {children}
    </div>
  );
}

export function CharacterSheetModal(props: CharacterSheetProps) {
  return (
    <CharacterSheetEditor
      {...props}
      closeRequestId={0}
      presentation="modal"
    />
  );
}

export function CharacterSheetDetached({
  closeRequestId,
  ...props
}: CharacterSheetProps & { closeRequestId: number }) {
  return (
    <CharacterSheetEditor
      {...props}
      closeRequestId={closeRequestId}
      presentation="detached"
    />
  );
}

function CharacterSheetEditor({
  campaignId,
  closeRequestId,
  entry,
  journalApi,
  networkApi,
  onDismiss,
  onUpdated,
  presentation,
  system,
}: CharacterSheetEditorProps) {
  const normalizedEntry = parseCharacterEntry(entry);
  const initialEntry = normalizedEntry ?? entry;
  const initialData = normalizedEntry
    ? structuredClone(normalizedEntry.data)
    : createDefaultDnd5eCharacterData();
  const [activeTab, setActiveTab] = useState<CharacterSheetTab>('home');
  const [current, setCurrent] = useState(initialEntry);
  const [draft, setDraft] = useState(initialData);
  const [name, setName] = useState(entry.name);
  const [error, setError] = useState<string | null>(null);
  const [closeFailed, setCloseFailed] = useState(false);
  const [numericBuffers, setNumericBuffers] = useState<Readonly<Record<string, string>>>({});
  const [pendingRolls, setPendingRolls] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [preparedSpellSummary, setPreparedSpellSummary] = useState({
    current: 0,
    incomplete: false,
    overMaximum: false,
  });
  const currentRef = useRef(initialEntry);
  const draftRef = useRef(initialData);
  const nameRef = useRef(entry.name);
  const dirtyFieldsRef = useRef(new Map<string, CharacterFieldValue>());
  const actionMutationsRef = useRef<Dnd5eCharacterActionMutation[]>([]);
  const customSkillMutationsRef = useRef<Dnd5eCharacterCustomSkillMutation[]>([]);
  const featureMutationsRef = useRef<Dnd5eCharacterFeatureMutation[]>([]);
  const inventoryMutationsRef = useRef<Dnd5eCharacterInventoryMutation[]>([]);
  const resourceMutationsRef = useRef<Dnd5eCharacterResourceMutation[]>([]);
  const spellMutationsRef = useRef<Dnd5eCharacterSpellMutation[]>([]);
  const saveTimerRef = useRef<number | null>(null);
  const mutationQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const refreshRequestRef = useRef(0);
  const pendingRollsRef = useRef(new Set<string>());
  const pendingShareMessagesRef = useRef(new Set<CharacterShareKey>());
  const shareMenuRef = useRef<ContextMenuController | null>(null);

  useEffect(() => {
    shareMenuRef.current = new ContextMenuController();
    return () => shareMenuRef.current?.close();
  }, []);

  const tabs = useMemo<readonly TabOption<CharacterSheetTab>[]>(() => [
    { id: 'spells', label: 'Spells', panelId: `character-${entry.id}-spells` },
    { id: 'home', label: 'Home', panelId: `character-${entry.id}-home` },
    { id: 'settings', label: 'Settings', panelId: `character-${entry.id}-settings` },
  ], [entry.id]);

  const rulesVersion = isDnd5eSettings(system.settings)
    ? system.settings.defaultRulesVersion
    : '5.5e';
  const ancestryLabel = rulesVersion === '5e' ? 'Race' : 'Species';
  const subAncestryLabel = rulesVersion === '5e' ? 'Subrace' : 'Lineage';
  const creatureLabel = rulesVersion === '5e' ? 'Creature' : 'Creature Type';
  const derived = useMemo(
    () => requireDnd5eDerivedValues(draft, rulesVersion),
    [draft, rulesVersion],
  );
  const availableSpellSlotLevels = DND5E_SPELL_SLOT_LEVELS.filter((slotLevel) => (
    derived.spellcasting.slots[slotLevel].baseTotal > 0
  ));
  const hitDieCanRoll = createDnd5eHitDieRollDefinition(draft.health.hitDie) !== null;
  const validData = isCharacterEntry(current);
  const canEdit = validData && current.capabilities.edit;

  const hasDirtyDraft = useCallback(() => (
    dirtyFieldsRef.current.size > 0 ||
    actionMutationsRef.current.length > 0 ||
    customSkillMutationsRef.current.length > 0 ||
    featureMutationsRef.current.length > 0 ||
    inventoryMutationsRef.current.length > 0 ||
    resourceMutationsRef.current.length > 0 ||
    spellMutationsRef.current.length > 0 ||
    nameRef.current !== currentRef.current.name
  ), []);

  const applyServerEntry = useCallback((
    updated: SystemJournalEntry,
    savedFields?: ReadonlyMap<string, CharacterFieldValue>,
    savedActionMutations?: readonly Dnd5eCharacterActionMutation[],
    savedCustomSkillMutations?: readonly Dnd5eCharacterCustomSkillMutation[],
    savedInventoryMutations?: readonly Dnd5eCharacterInventoryMutation[],
    savedResourceMutations?: readonly Dnd5eCharacterResourceMutation[],
    savedFeatureMutations?: readonly Dnd5eCharacterFeatureMutation[],
    savedSpellMutations?: readonly Dnd5eCharacterSpellMutation[],
    savedName?: string,
  ): boolean => {
    const normalized = parseCharacterEntry(updated);
    if (!normalized) {
      setError('The Character data returned by the campaign is invalid.');
      return false;
    }
    if (savedFields) {
      for (const [path, value] of savedFields) {
        if (dirtyFieldsRef.current.get(path) === value) {
          dirtyFieldsRef.current.delete(path);
        }
      }
    }
    if (savedActionMutations) {
      const saved = new Set(savedActionMutations);
      actionMutationsRef.current = actionMutationsRef.current.filter(
        (mutation) => !saved.has(mutation),
      );
    }
    if (savedCustomSkillMutations) {
      const saved = new Set(savedCustomSkillMutations);
      customSkillMutationsRef.current = customSkillMutationsRef.current.filter(
        (mutation) => !saved.has(mutation),
      );
    }
    if (savedResourceMutations) {
      const saved = new Set(savedResourceMutations);
      resourceMutationsRef.current = resourceMutationsRef.current.filter(
        (mutation) => !saved.has(mutation),
      );
    }
    if (savedInventoryMutations) {
      const saved = new Set(savedInventoryMutations);
      inventoryMutationsRef.current = inventoryMutationsRef.current.filter(
        (mutation) => !saved.has(mutation),
      );
    }
    if (savedFeatureMutations) {
      const saved = new Set(savedFeatureMutations);
      featureMutationsRef.current = featureMutationsRef.current.filter(
        (mutation) => !saved.has(mutation),
      );
    }
    if (savedSpellMutations) {
      const saved = new Set(savedSpellMutations);
      spellMutationsRef.current = spellMutationsRef.current.filter(
        (mutation) => !saved.has(mutation),
      );
    }
    const pendingName = nameRef.current;
    const nameWasDirty = pendingName !== currentRef.current.name;
    const nextName = savedName !== undefined && normalizeJournalTitle(pendingName) === savedName
      ? normalized.name
      : nameWasDirty
        ? pendingName
        : normalized.name;
    nameRef.current = nextName;
    setName(nextName);
    currentRef.current = normalized;
    setCurrent(normalized);
    let merged = mergeCharacterDraft(
      normalized.data,
      dirtyFieldsRef.current,
      actionMutationsRef.current,
      customSkillMutationsRef.current,
      inventoryMutationsRef.current,
      resourceMutationsRef.current,
      featureMutationsRef.current,
      spellMutationsRef.current,
    );
    if (merged.missingActionIds.length > 0) {
      const missingIds = new Set(merged.missingActionIds);
      actionMutationsRef.current = actionMutationsRef.current.filter((mutation) => {
        const target = actionMutationTarget(mutation);
        return target === null || !missingIds.has(target);
      });
      merged = mergeCharacterDraft(
        normalized.data,
        dirtyFieldsRef.current,
        actionMutationsRef.current,
        customSkillMutationsRef.current,
        inventoryMutationsRef.current,
        resourceMutationsRef.current,
        featureMutationsRef.current,
        spellMutationsRef.current,
      );
      setError('An Action was deleted remotely, so its pending local edit was discarded.');
    }
    if (merged.missingCustomSkillIds.length > 0) {
      const missingIds = new Set(merged.missingCustomSkillIds);
      customSkillMutationsRef.current = customSkillMutationsRef.current.filter((mutation) => {
        const target = customSkillMutationTarget(mutation);
        return target === null || !missingIds.has(target);
      });
      merged = mergeCharacterDraft(
        normalized.data,
        dirtyFieldsRef.current,
        actionMutationsRef.current,
        customSkillMutationsRef.current,
        inventoryMutationsRef.current,
        resourceMutationsRef.current,
        featureMutationsRef.current,
        spellMutationsRef.current,
      );
      setError('A Custom Skill was deleted remotely, so its pending local edit was discarded.');
    }
    if (merged.missingResourceIds.length > 0) {
      const missingIds = new Set(merged.missingResourceIds);
      resourceMutationsRef.current = resourceMutationsRef.current.filter((mutation) => {
        const target = resourceMutationTarget(mutation);
        return target === null || !missingIds.has(target);
      });
      merged = mergeCharacterDraft(
        normalized.data,
        dirtyFieldsRef.current,
        actionMutationsRef.current,
        customSkillMutationsRef.current,
        inventoryMutationsRef.current,
        resourceMutationsRef.current,
        featureMutationsRef.current,
        spellMutationsRef.current,
      );
      setError('A Resource was deleted remotely, so its pending local edit was discarded.');
    }
    if (merged.missingInventoryIds.length > 0 || merged.invalidInventory) {
      const inventoryWasInvalid = merged.invalidInventory;
      const missingIds = new Set(merged.missingInventoryIds);
      inventoryMutationsRef.current = inventoryWasInvalid
        ? []
        : inventoryMutationsRef.current.filter((mutation) =>
          !inventoryMutationReferences(mutation).some((id) => missingIds.has(id)),
        );
      merged = mergeCharacterDraft(
        normalized.data,
        dirtyFieldsRef.current,
        actionMutationsRef.current,
        customSkillMutationsRef.current,
        inventoryMutationsRef.current,
        resourceMutationsRef.current,
        featureMutationsRef.current,
        spellMutationsRef.current,
      );
      setError(inventoryWasInvalid
        ? 'Pending Inventory changes could not be applied to the latest Character.'
        : 'An Inventory entry was deleted remotely, so its pending local edit was discarded.');
    }
    if (merged.missingFeatureIds.length > 0) {
      const missingIds = new Set(merged.missingFeatureIds);
      featureMutationsRef.current = featureMutationsRef.current.filter((mutation) => {
        const target = featureMutationTarget(mutation);
        return target === null || !missingIds.has(target);
      });
      merged = mergeCharacterDraft(
        normalized.data,
        dirtyFieldsRef.current,
        actionMutationsRef.current,
        customSkillMutationsRef.current,
        inventoryMutationsRef.current,
        resourceMutationsRef.current,
        featureMutationsRef.current,
        spellMutationsRef.current,
      );
      setError('A Feature was deleted remotely, so its pending local edit was discarded.');
    }
    if (merged.missingSpellIds.length > 0) {
      const missingIds = new Set(merged.missingSpellIds);
      spellMutationsRef.current = spellMutationsRef.current.filter((mutation) => {
        const target = spellMutationTarget(mutation);
        return target === null || !missingIds.has(target);
      });
      merged = mergeCharacterDraft(
        normalized.data,
        dirtyFieldsRef.current,
        actionMutationsRef.current,
        customSkillMutationsRef.current,
        inventoryMutationsRef.current,
        resourceMutationsRef.current,
        featureMutationsRef.current,
        spellMutationsRef.current,
      );
      setError('A spell was removed remotely, so its pending preparation change was discarded.');
    }
    draftRef.current = merged.data;
    setDraft(merged.data);
    setNumericBuffers({});
    onUpdated(normalized);
    return true;
  }, [onUpdated]);

  const refreshCurrent = useCallback(async () => {
    const request = ++refreshRequestRef.current;
    const result = await journalApi.getEntry({
      campaignId,
      entryId: currentRef.current.id,
    });
    if (request !== refreshRequestRef.current) return;
    if (!result.ok) {
      if (result.error.code === 'not_found' || result.error.code === 'permission_denied') {
        onDismiss();
      } else {
        setError(result.error.message);
      }
      return;
    }
    if (result.value.kind !== 'system') {
      setError('The Character entry returned by the campaign is invalid.');
      return;
    }
    if (result.value.revision >= currentRef.current.revision) {
      applyServerEntry(result.value);
    }
  }, [applyServerEntry, campaignId, journalApi, onDismiss]);

  const save = useCallback(async function persistDraft(): Promise<boolean> {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (saveInFlightRef.current) {
      const saved = await saveInFlightRef.current;
      return saved ? persistDraft() : false;
    }
    const active = currentRef.current;
    if (!active.capabilities.edit || !isCharacterEntry(active)) return true;
    const dirtyFields = new Map(dirtyFieldsRef.current);
    const actionMutations = [...actionMutationsRef.current];
    const customSkillMutations = [...customSkillMutationsRef.current];
    const inventoryMutations = [...inventoryMutationsRef.current];
    const resourceMutations = [...resourceMutationsRef.current];
    const featureMutations = [...featureMutationsRef.current];
    const spellMutations = [...spellMutationsRef.current];
    const pendingName = normalizeJournalTitle(nameRef.current);
    const nameChanged = pendingName !== active.name;
    if (
      dirtyFields.size === 0 &&
      actionMutations.length === 0 &&
      customSkillMutations.length === 0 &&
      inventoryMutations.length === 0 &&
      resourceMutations.length === 0 &&
      featureMutations.length === 0 &&
      spellMutations.length === 0 &&
      !nameChanged
    ) {
      if (nameRef.current !== active.name) {
        nameRef.current = active.name;
        setName(active.name);
      }
      return mutationQueueRef.current;
    }
    const queued = mutationQueueRef.current.then(async () => {
      const next = currentRef.current;
      if (!isCharacterEntry(next)) return false;

      if (
        dirtyFields.size > 0 ||
        actionMutations.length > 0 ||
        customSkillMutations.length > 0 ||
        inventoryMutations.length > 0 ||
        resourceMutations.length > 0 ||
        featureMutations.length > 0 ||
        spellMutations.length > 0
      ) {
        if (!isCharacterEntry(next)) return false;
        let merged = mergeCharacterDraft(
          next.data,
          dirtyFields,
          actionMutations,
          customSkillMutations,
          inventoryMutations,
          resourceMutations,
          featureMutations,
          spellMutations,
        );
        if (
          merged.invalidInventory ||
          merged.missingActionIds.length > 0 ||
          merged.missingCustomSkillIds.length > 0 ||
          merged.missingInventoryIds.length > 0 ||
          merged.missingResourceIds.length > 0 ||
          merged.missingFeatureIds.length > 0 ||
          merged.missingSpellIds.length > 0 ||
          !isDnd5eCharacterData(merged.data)
        ) {
          setError(merged.invalidInventory
            ? 'The Inventory data is invalid.'
            : merged.missingActionIds.length > 0
              ? 'An Action was deleted remotely, so its pending local edit was discarded.'
              : merged.missingCustomSkillIds.length > 0
                ? 'A Custom Skill was deleted remotely, so its pending local edit was discarded.'
                : merged.missingInventoryIds.length > 0
                  ? 'An Inventory entry was deleted remotely, so its pending local edit was discarded.'
                  : merged.missingFeatureIds.length > 0
                    ? 'A Feature was deleted remotely, so its pending local edit was discarded.'
                    : merged.missingResourceIds.length > 0
                      ? 'A Resource was deleted remotely, so its pending local edit was discarded.'
                      : merged.missingSpellIds.length > 0
                        ? 'A spell was removed remotely, so its pending preparation change was discarded.'
                      : 'The Character collection data is invalid.');
          return false;
        }
        let data = merged.data;
        let dataResult = await journalApi.updateEntryData({
          campaignId,
          data,
          entryId: next.id,
          expectedRevision: next.revision,
        });
        if (!dataResult.ok && dataResult.error.code === 'conflict') {
          const refreshed = await journalApi.getEntry({ campaignId, entryId: next.id });
          const refreshedCharacter = refreshed.ok
            ? parseCharacterEntry(refreshed.value)
            : null;
          if (!refreshed.ok || !refreshedCharacter) {
            setError(refreshed.ok
              ? 'The Character data returned by the campaign is invalid.'
              : refreshed.error.message);
            return false;
          }
          applyServerEntry(refreshedCharacter);
          merged = mergeCharacterDraft(
            refreshedCharacter.data,
            dirtyFields,
            actionMutations,
            customSkillMutations,
            inventoryMutations,
            resourceMutations,
            featureMutations,
            spellMutations,
          );
          if (
            merged.invalidInventory ||
            merged.missingActionIds.length > 0 ||
            merged.missingCustomSkillIds.length > 0 ||
            merged.missingInventoryIds.length > 0 ||
            merged.missingResourceIds.length > 0 ||
            merged.missingFeatureIds.length > 0 ||
            merged.missingSpellIds.length > 0 ||
            !isDnd5eCharacterData(merged.data)
          ) {
            setError(merged.invalidInventory
              ? 'The Inventory data is invalid.'
              : merged.missingActionIds.length > 0
                ? 'An Action was deleted remotely, so its pending local edit was discarded.'
                : merged.missingCustomSkillIds.length > 0
                  ? 'A Custom Skill was deleted remotely, so its pending local edit was discarded.'
                  : merged.missingInventoryIds.length > 0
                    ? 'An Inventory entry was deleted remotely, so its pending local edit was discarded.'
                    : merged.missingFeatureIds.length > 0
                      ? 'A Feature was deleted remotely, so its pending local edit was discarded.'
                      : merged.missingResourceIds.length > 0
                        ? 'A Resource was deleted remotely, so its pending local edit was discarded.'
                        : merged.missingSpellIds.length > 0
                          ? 'A spell was removed remotely, so its pending preparation change was discarded.'
                        : 'The Character collection data is invalid.');
            return false;
          }
          data = merged.data;
          dataResult = await journalApi.updateEntryData({
            campaignId,
            data,
            entryId: refreshedCharacter.id,
            expectedRevision: refreshedCharacter.revision,
          });
        }
        if (!dataResult.ok || dataResult.value.kind !== 'system') {
          setError(dataResult.ok
            ? 'The Character entry returned by the campaign is invalid.'
            : dataResult.error.message);
          return false;
        }
        if (!applyServerEntry(
          dataResult.value,
          dirtyFields,
          actionMutations,
          customSkillMutations,
          inventoryMutations,
          resourceMutations,
          featureMutations,
          spellMutations,
        )) return false;
      }

      const renamedFrom = currentRef.current;
      if (pendingName !== renamedFrom.name) {
        let nameResult = await journalApi.renameEntry({
          campaignId,
          entryId: renamedFrom.id,
          expectedRevision: renamedFrom.revision,
          name: pendingName,
        });
        if (!nameResult.ok && nameResult.error.code === 'conflict') {
          const refreshed = await journalApi.getEntry({ campaignId, entryId: renamedFrom.id });
          const refreshedCharacter = refreshed.ok
            ? parseCharacterEntry(refreshed.value)
            : null;
          if (!refreshed.ok || !refreshedCharacter) {
            setError(refreshed.ok
              ? 'The Character data returned by the campaign is invalid.'
              : refreshed.error.message);
            return false;
          }
          applyServerEntry(refreshedCharacter);
          nameResult = await journalApi.renameEntry({
            campaignId,
            entryId: refreshedCharacter.id,
            expectedRevision: refreshedCharacter.revision,
            name: pendingName,
          });
        }
        if (!nameResult.ok || nameResult.value.kind !== 'system') {
          setError(nameResult.ok
            ? 'The Character entry returned by the campaign is invalid.'
            : nameResult.error.message);
          return false;
        }
        if (!applyServerEntry(
          nameResult.value,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          pendingName,
        )) return false;
      }

      return true;
    });
    mutationQueueRef.current = queued.catch(() => false);
    saveInFlightRef.current = queued;
    try {
      return await queued;
    } finally {
      if (saveInFlightRef.current === queued) saveInFlightRef.current = null;
    }
  }, [applyServerEntry, campaignId, journalApi]);

  const changeFields = (
    fields: ReadonlyMap<string, CharacterFieldValue>,
  ) => {
    const next = mergeFields(draftRef.current, fields);
    draftRef.current = next;
    setDraft(next);
    for (const [path, value] of fields) {
      const saved = isCharacterEntry(currentRef.current)
        ? readField(currentRef.current.data, path)
        : null;
      if (Object.is(value, saved)) dirtyFieldsRef.current.delete(path);
      else dirtyFieldsRef.current.set(path, value);
    }
  };

  const changeField = (path: string, value: CharacterFieldValue) => {
    changeFields(new Map([[path, value]]));
  };

  const changeResource = (mutation: Dnd5eCharacterResourceMutation): boolean => {
    const applied = applyDnd5eCharacterResourceMutations(
      draftRef.current.resources,
      [mutation],
    );
    if (applied.missingIds.length > 0) {
      setError('The Resource no longer exists.');
      return false;
    }
    const next = { ...draftRef.current, resources: applied.resources };
    if (!isDnd5eCharacterData(next)) return false;
    resourceMutationsRef.current.push(mutation);
    draftRef.current = next;
    setDraft(next);
    return true;
  };

  const commitResource = async (
    mutation: Dnd5eCharacterResourceMutation,
  ): Promise<boolean> => changeResource(mutation) && save();

  const changeCustomSkill = (
    mutation: Dnd5eCharacterCustomSkillMutation,
  ): boolean => {
    const applied = applyDnd5eCharacterCustomSkillMutations(
      draftRef.current.customSkills,
      [mutation],
    );
    if (applied.missingIds.length > 0) {
      setError('The Custom Skill no longer exists.');
      return false;
    }
    const next = { ...draftRef.current, customSkills: applied.skills };
    if (
      !isDnd5eCharacterData(next) ||
      deriveDnd5eCharacterValues(next, rulesVersion) === null
    ) return false;
    customSkillMutationsRef.current.push(mutation);
    draftRef.current = next;
    setDraft(next);
    return true;
  };

  const commitCustomSkill = async (
    mutation: Dnd5eCharacterCustomSkillMutation,
  ): Promise<boolean> => changeCustomSkill(mutation) && save();

  const changeAction = (mutation: Dnd5eCharacterActionMutation): boolean => {
    const applied = applyDnd5eCharacterActionMutations(
      draftRef.current.actions,
      [mutation],
    );
    if (applied.missingIds.length > 0) {
      setError('The Action no longer exists.');
      return false;
    }
    const next = { ...draftRef.current, actions: applied.actions };
    if (!isDnd5eCharacterData(next)) return false;
    actionMutationsRef.current.push(mutation);
    draftRef.current = next;
    setDraft(next);
    return true;
  };

  const commitAction = async (
    mutation: Dnd5eCharacterActionMutation,
  ): Promise<boolean> => changeAction(mutation) && save();

  const changeInventory = (
    mutation: Dnd5eCharacterInventoryMutation,
  ): boolean => {
    const applied = applyDnd5eCharacterInventoryMutations(
      draftRef.current.inventory,
      [mutation],
    );
    if (applied.missingIds.length > 0) {
      setError('The Inventory entry or destination no longer exists.');
      return false;
    }
    if (applied.invalid) {
      setError('That Inventory change is not valid.');
      return false;
    }
    const next = { ...draftRef.current, inventory: applied.inventory };
    if (!isDnd5eCharacterData(next)) return false;
    inventoryMutationsRef.current.push(mutation);
    draftRef.current = next;
    setDraft(next);
    return true;
  };

  const commitInventory = async (
    mutation: Dnd5eCharacterInventoryMutation,
  ): Promise<boolean> => changeInventory(mutation) && save();

  const changeFeature = (mutation: Dnd5eCharacterFeatureMutation): boolean => {
    const applied = applyDnd5eCharacterFeatureMutations(
      draftRef.current.features,
      [mutation],
    );
    if (applied.missingIds.length > 0) {
      setError('The Feature no longer exists.');
      return false;
    }
    const next = { ...draftRef.current, features: applied.features };
    if (!isDnd5eCharacterData(next)) return false;
    featureMutationsRef.current.push(mutation);
    draftRef.current = next;
    setDraft(next);
    return true;
  };

  const commitFeature = async (
    mutation: Dnd5eCharacterFeatureMutation,
  ): Promise<boolean> => changeFeature(mutation) && save();

  const commitSpells = async (
    mutations: readonly Dnd5eCharacterSpellMutation[],
  ): Promise<boolean> => {
    if (mutations.length === 0) return true;
    const applied = applyDnd5eCharacterSpellMutations(
      draftRef.current.spellcasting.spells,
      mutations,
    );
    if (applied.missingIds.length > 0) {
      setError('The spell is no longer attached to this character.');
      return false;
    }
    const next = {
      ...draftRef.current,
      spellcasting: {
        ...draftRef.current.spellcasting,
        spells: applied.spells,
      },
    };
    if (!isDnd5eCharacterData(next)) {
      setError('That spell list change is not valid.');
      return false;
    }
    spellMutationsRef.current.push(...mutations);
    draftRef.current = next;
    setDraft(next);
    return save();
  };

  const consumeSpellSlot = async (
    slotLevel: Dnd5eSpellSlotLevel,
    compile: (
      character: Dnd5eCharacterData,
      derived: Dnd5eDerivedCharacterValues,
    ) => ChatRollDefinition | null,
  ): Promise<ChatRollDefinition | null> => {
    if (!await save()) return null;
    let definition: ChatRollDefinition | null = null;
    const queued = mutationQueueRef.current.then(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const active = currentRef.current;
        if (!isCharacterEntry(active) || !active.capabilities.edit) {
          setError('Editing permission is required to consume spell slots.');
          return false;
        }
        const latestDerived = deriveDnd5eCharacterValues(
          active.data,
          rulesVersion,
        );
        if (!latestDerived) {
          setError('The Character values are invalid and the spell cannot be cast.');
          return false;
        }
        if (!hasUsableDnd5eSpellSlot(active.data, latestDerived, slotLevel)) {
          setError('That spell slot is no longer available.');
          return false;
        }
        const compiled = compile(active.data, latestDerived);
        if (!compiled) return false;
        const candidate = structuredClone(active.data);
        candidate.spellcasting.slots[slotLevel].current -= 1;
        const result = await journalApi.updateEntryData({
          campaignId,
          data: candidate,
          entryId: active.id,
          expectedRevision: active.revision,
        });
        if (result.ok) {
          if (result.value.kind !== 'system' || !applyServerEntry(result.value)) {
            setError('The Character entry returned by the campaign is invalid.');
            return false;
          }
          definition = compiled;
          return true;
        }
        if (result.error.code !== 'conflict') {
          setError(result.error.message);
          return false;
        }
        const refreshed = await journalApi.getEntry({
          campaignId,
          entryId: active.id,
        });
        if (!refreshed.ok || refreshed.value.kind !== 'system' ||
          !applyServerEntry(refreshed.value)) {
          setError(refreshed.ok
            ? 'The Character data returned by the campaign is invalid.'
            : refreshed.error.message);
          return false;
        }
      }
      setError('The spell slot changed too many times to complete this cast.');
      return false;
    });
    mutationQueueRef.current = queued.catch(() => false);
    return await queued ? definition : null;
  };

  const adjustSpellSlot = async (
    slotLevel: Dnd5eSpellSlotLevel,
    delta: -1 | 1,
  ): Promise<boolean> => {
    if (!await save()) return false;
    const queued = mutationQueueRef.current.then(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const active = currentRef.current;
        if (!isCharacterEntry(active) || !active.capabilities.edit) {
          setError('Editing permission is required to change spell slots.');
          return false;
        }
        const currentSlots = active.data.spellcasting.slots[slotLevel].current;
        if (delta < 0 && currentSlots < 1) {
          setError('That spell slot is no longer available.');
          return false;
        }
        const adjusted = currentSlots + delta;
        if (!Number.isSafeInteger(adjusted) || adjusted < 0) {
          setError('The spell slot value is outside the supported range.');
          return false;
        }
        const candidate = structuredClone(active.data);
        candidate.spellcasting.slots[slotLevel].current = adjusted;
        const result = await journalApi.updateEntryData({
          campaignId,
          data: candidate,
          entryId: active.id,
          expectedRevision: active.revision,
        });
        if (result.ok) {
          if (result.value.kind !== 'system' || !applyServerEntry(result.value)) {
            setError('The Character entry returned by the campaign is invalid.');
            return false;
          }
          return true;
        }
        if (result.error.code !== 'conflict') {
          setError(result.error.message);
          return false;
        }
        const refreshed = await journalApi.getEntry({
          campaignId,
          entryId: active.id,
        });
        if (!refreshed.ok || refreshed.value.kind !== 'system' ||
          !applyServerEntry(refreshed.value)) {
          setError(refreshed.ok
            ? 'The Character data returned by the campaign is invalid.'
            : refreshed.error.message);
          return false;
        }
      }
      setError('The spell slot changed too many times to complete this cast.');
      return false;
    });
    mutationQueueRef.current = queued.catch(() => false);
    return queued;
  };

  const changeName = (value: string) => {
    nameRef.current = value;
    setName(value);
  };

  const changeNumericBuffer = (path: string, value: string) => {
    setNumericBuffers((currentBuffers) => ({ ...currentBuffers, [path]: value }));
  };

  const clearNumericBuffer = (path: string) => {
    setNumericBuffers((currentBuffers) => {
      if (!Object.hasOwn(currentBuffers, path)) return currentBuffers;
      const next = { ...currentBuffers };
      delete next[path];
      return next;
    });
  };

  const numericValue = (path: string, fallback: string): string => (
    Object.hasOwn(numericBuffers, path) ? numericBuffers[path] : fallback
  );

  const commitAbilityScore = (ability: Dnd5eAbilityId) => {
    const path = `abilities.${ability}.score`;
    const input = numericBuffers[path];
    if (input === undefined) {
      void save();
      return;
    }
    const score = parseDnd5eSafeInteger(input);
    clearNumericBuffer(path);
    if (score === null) return;
    const candidate = writeField(draftRef.current, path, score);
    if (deriveDnd5eCharacterValues(candidate, rulesVersion) === null) return;
    changeField(path, score);
    void save();
  };

  const commitCalculatedTotal = (
    path: string,
    currentTotal: number,
    currentOffset: number,
    nonnegative = false,
  ) => {
    const input = numericBuffers[path];
    if (input === undefined) {
      void save();
      return;
    }
    const desiredTotal = input.trim() === ''
      ? null
      : nonnegative
        ? parseDnd5eNonnegativeSafeInteger(input)
        : parseDnd5eSafeInteger(input);
    clearNumericBuffer(path);
    if (input.trim() !== '' && desiredTotal === null) return;
    const nextOffset = desiredTotal === null
      ? 0
      : calculateDnd5eOffsetForTotal(currentTotal, currentOffset, desiredTotal);
    if (nextOffset === null) return;
    const candidate = writeField(draftRef.current, path, nextOffset);
    if (deriveDnd5eCharacterValues(candidate, rulesVersion) === null) return;
    changeField(path, nextOffset);
    void save();
  };

  const commitNonnegativeValue = (path: string) => {
    const input = numericBuffers[path];
    if (input === undefined) {
      void save();
      return;
    }
    const nextValue = input.trim() === ''
      ? 0
      : parseDnd5eNonnegativeSafeInteger(input);
    clearNumericBuffer(path);
    if (nextValue === null) return;
    const candidate = writeField(draftRef.current, path, nextValue);
    if (deriveDnd5eCharacterValues(candidate, rulesVersion) === null) return;
    changeField(path, nextValue);
    void save();
  };

  const setSpellSlotCurrent = (
    slotLevel: Dnd5eSpellSlotLevel,
    current: number,
  ) => {
    const path = `spellcasting.slots.${slotLevel}.current`;
    const candidate = writeField(draftRef.current, path, current);
    if (deriveDnd5eCharacterValues(candidate, rulesVersion) === null) return;
    clearNumericBuffer(path);
    changeField(path, current);
    void save();
  };

  const sendRoll = async (
    key: string,
    definition: ChatRollDefinition,
  ): Promise<boolean> => {
    if (!networkApi) {
      setError('Chat is unavailable.');
      return false;
    }
    if (pendingRollsRef.current.has(key)) return false;
    pendingRollsRef.current.add(key);
    setPendingRolls(new Set(pendingRollsRef.current));
    let timer = 0;
    try {
      const timeout = new Promise<
        Awaited<ReturnType<CharacterSheetNetworkApi['sendChatRoll']>>
      >((resolve) => {
        timer = window.setTimeout(() => resolve({
          error: { code: 'timeout', message: 'The host did not acknowledge this roll.' },
          ok: false,
        }), CHAT_ROLL_SEND_TIMEOUT_MS);
      });
      const result = await Promise.race([
        networkApi.sendChatRoll({
          campaignId,
          clientMessageId: crypto.randomUUID(),
          definition,
          recipient: null,
        }),
        timeout,
      ]);
      if (!result.ok) {
        setError(result.error.message);
        return false;
      }
      return true;
    } catch {
      setError('The roll could not be sent.');
      return false;
    } finally {
      window.clearTimeout(timer);
      pendingRollsRef.current.delete(key);
      setPendingRolls(new Set(pendingRollsRef.current));
    }
  };

  const rollAbility = (
    ability: Dnd5eAbilityId,
    kind: Dnd5eAbilityRollKind,
  ) => {
    const latestDerived = deriveDnd5eCharacterValues(draftRef.current, rulesVersion);
    if (!latestDerived) {
      setError('The Character values are invalid and could not be rolled.');
      return;
    }
    void sendRoll(
      `ability:${ability}:${kind}`,
      createDnd5eAbilityRollDefinition(ability, latestDerived, kind),
    );
  };

  const rollImportantStat = (kind: Dnd5eStatisticRollKind) => {
    const latestDerived = deriveDnd5eCharacterValues(draftRef.current, rulesVersion);
    if (!latestDerived) {
      setError('The Character values are invalid and could not be rolled.');
      return;
    }
    void sendRoll(
      `stat:${kind}`,
      createDnd5eStatisticRollDefinition(latestDerived, kind),
    );
  };

  const rollBuiltInSkill = (skillId: (typeof DND5E_SKILLS)[number]['id']) => {
    const latestDerived = deriveDnd5eCharacterValues(draftRef.current, rulesVersion);
    const skill = DND5E_SKILLS.find(({ id }) => id === skillId);
    if (!latestDerived || !skill) {
      setError('The Character values are invalid and could not be rolled.');
      return;
    }
    void sendRoll(
      `skill:${skillId}`,
      createDnd5eSkillRollDefinition(
        skill.label,
        latestDerived.skills[skillId].bonus,
      ),
    );
  };

  const rollCustomSkill = (skillId: string) => {
    const latestData = draftRef.current;
    const latestDerived = deriveDnd5eCharacterValues(latestData, rulesVersion);
    const skill = latestData.customSkills.find(({ id }) => id === skillId);
    const values = latestDerived?.customSkills[skillId];
    if (!skill || !values) {
      setError('The Custom Skill values are invalid and could not be rolled.');
      return;
    }
    void sendRoll(
      `custom-skill:${skillId}`,
      createDnd5eSkillRollDefinition(
        skill.name.trim() || 'Unnamed Skill',
        values.bonus,
      ),
    );
  };

  const rollHitDie = async () => {
    const health = draftRef.current.health;
    const definition = createDnd5eHitDieRollDefinition(health.hitDie);
    if (!definition) return;
    if (!(await sendRoll('health:hit-die', definition))) return;
    const available = parseDnd5eSafeInteger(
      draftRef.current.health.currentHitDice,
    );
    if (available === null || available <= 0) return;
    changeField('health.currentHitDice', String(available - 1));
    void save();
  };

  const characterShareContent = (
    key: CharacterShareKey,
  ): string | null => {
    if (key === 'hitPoints') {
      const health = draftRef.current.health;
      return `HP: ${health.currentHitPoints}/${health.maximumHitPoints}`;
    }
    if (key === 'temporaryHitPoints') {
      return `Temp HP: ${draftRef.current.health.temporaryHitPoints}`;
    }
    if (key === 'hitDice') {
      const health = draftRef.current.health;
      return `Hit Dice: ${health.currentHitDice}/${health.maximumHitDice} ${health.hitDie}`;
    }
    if (key.startsWith('resource:')) {
      const resource = draftRef.current.resources.find(
        ({ id }) => id === key.slice('resource:'.length),
      );
      if (!resource) return null;
      return `${resource.name.trim() || 'Unnamed Resource'}: ${resource.current}/${resource.maximum}`;
    }
    if (key.startsWith('feature:')) {
      const feature = draftRef.current.features.find(
        ({ id }) => id === key.slice('feature:'.length),
      );
      return feature ? createDnd5eFeatureChatContent(feature) : null;
    }
    if (key.startsWith('inventory:')) {
      const latestData = draftRef.current;
      const latestDerived = deriveDnd5eCharacterValues(latestData, rulesVersion);
      return latestDerived
        ? createDnd5eInventoryEntryChatContent(
          latestData.inventory,
          latestDerived.inventory,
          key.slice('inventory:'.length),
        )
        : null;
    }
    if (key === 'proficiencyBonus') {
      const latestDerived = deriveDnd5eCharacterValues(draftRef.current, rulesVersion);
      return latestDerived
        ? `Proficiency: ${formatDnd5eSignedValue(latestDerived.proficiencyBonus)}`
        : null;
    }
    if (key === 'armorClass') {
      return `Armor Class: ${draftRef.current.importantStats.armorClass}`;
    }
    if (key === 'currentSpeed') {
      return `Speed: ${draftRef.current.importantStats.currentSpeed}`;
    }
    if (key === 'inspirationCount') {
      return `Inspiration: ${draftRef.current.importantStats.inspirationCount}`;
    }
    return null;
  };

  const sendCharacterShare = async (key: CharacterShareKey) => {
    if (!networkApi) {
      setError('Chat is unavailable.');
      return;
    }
    if (pendingShareMessagesRef.current.has(key)) return;
    const content = characterShareContent(key);
    if (content === null) {
      setError('The Character values are invalid and could not be sent.');
      return;
    }
    pendingShareMessagesRef.current.add(key);
    let timer = 0;
    try {
      const timeout = new Promise<
        Awaited<ReturnType<CharacterSheetNetworkApi['sendChatMessage']>>
      >((resolve) => {
        timer = window.setTimeout(() => resolve({
          error: { code: 'timeout', message: 'The host did not acknowledge this message.' },
          ok: false,
        }), CHAT_SEND_TIMEOUT_MS);
      });
      const result = await Promise.race([
        networkApi.sendChatMessage({
          campaignId,
          clientMessageId: crypto.randomUUID(),
          content,
          recipient: null,
        }),
        timeout,
      ]);
      if (!result.ok) setError(result.error.message);
    } catch {
      setError('The message could not be sent.');
    } finally {
      window.clearTimeout(timer);
      pendingShareMessagesRef.current.delete(key);
    }
  };

  const openCharacterShareMenu = (
    key: CharacterShareKey,
    label: string,
    position: { clientX: number; clientY: number },
    returnFocus: () => void,
    mount?: HTMLElement,
  ) => {
    shareMenuRef.current?.open(
      position.clientX,
      position.clientY,
      `${label} actions`,
      [{
        disabled: !networkApi || pendingShareMessagesRef.current.has(key),
        kind: 'action',
        label: 'Send To Chat',
        onSelect: () => void sendCharacterShare(key),
      }],
      returnFocus,
      mount,
    );
  };

  const healthShareHandlers = (
    key: Extract<CharacterShareKey, 'hitDice' | 'hitPoints' | 'temporaryHitPoints'>,
    label: string,
  ) => ({
    onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const focused = event.target instanceof HTMLElement ? event.target : null;
      openCharacterShareMenu(
        key,
        label,
        event,
        () => focused?.focus(),
        event.currentTarget.closest('dialog') ?? undefined,
      );
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (
        event.key !== 'ContextMenu' &&
        !(event.shiftKey && event.key === 'F10')
      ) return;
      event.preventDefault();
      const focused = event.target instanceof HTMLElement ? event.target : null;
      const bounds = event.currentTarget.getBoundingClientRect();
      openCharacterShareMenu(
        key,
        label,
        { clientX: bounds.left + 24, clientY: bounds.bottom },
        () => focused?.focus(),
        event.currentTarget.closest('dialog') ?? undefined,
      );
    },
  });

  const field = (
    path: string,
    label: string,
    title: string,
    className?: string,
    accessibleLabel?: string,
  ) => (
    <CharacterField
      key={path}
      accessibleLabel={accessibleLabel}
      className={className}
      label={label}
      onBlur={() => void save()}
      onChange={(value) => changeField(path, value)}
      readOnly={!canEdit}
      title={title}
      value={readStringField(draft, path)}
    />
  );

  const selectClass = (className: string) => {
    const fields = new Map<string, CharacterFieldValue>([
      ['identity.className', className],
      [
        'spellcasting.ability',
        defaultDnd5eSpellcastingAbilityForClass(className),
      ],
    ]);
    const candidate = mergeFields(draftRef.current, fields);
    if (deriveDnd5eCharacterValues(candidate, rulesVersion) === null) return;
    changeFields(fields);
    void save();
  };

  const dropdownField = (
    path: string,
    label: string,
    title: string,
    options: readonly string[],
    icons?: Readonly<Partial<Record<string, LucideIcon>>>,
    numeric = false,
    onSelectValue?: (value: string | number) => void,
  ) => {
    const rawValue = readField(draft, path);
    const value = rawValue === null ? '' : String(rawValue);
    return (
      <Dropdown
        accessibleLabel={label}
        className={[
          styles.dropdownField,
          value ? undefined : styles.dropdownPlaceholder,
        ].filter(Boolean).join(' ')}
        disabled={!canEdit}
        key={path}
        label={value || label}
        panelLabel={`${label} options`}
        showIndicator={false}
        title={title}
      >
        {options.map((option) => {
          const Icon = icons?.[option];
          return (
            <DropdownOption
              key={option}
              active={value === option}
              icon={Icon ? <Icon aria-hidden size="1rem" /> : undefined}
              label={option}
              onSelect={() => {
                const nextValue = numeric ? Number(option) : option;
                if (onSelectValue) {
                  onSelectValue(nextValue);
                  return;
                }
                const candidate = writeField(draftRef.current, path, nextValue);
                if (deriveDnd5eCharacterValues(candidate, rulesVersion) === null) return;
                changeField(path, nextValue);
                void save();
              }}
            />
          );
        })}
      </Dropdown>
    );
  };

  const healthInput = (
    path: string,
    accessibleLabel: string,
    className?: string,
    inputMode: 'numeric' | 'text' = 'numeric',
  ) => {
    const value = readStringField(draft, path);
    return (
      <InlineInput
        aria-label={accessibleLabel}
        autoComplete="off"
        className={[styles.healthInput, className].filter(Boolean).join(' ')}
        inputMode={inputMode}
        maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
        readOnly={!canEdit}
        size={Math.max(1, value.length)}
        value={value}
        onBlur={() => void save()}
        onChange={(event) => changeField(path, event.currentTarget.value)}
      />
    );
  };

  const selectSpellcastingAbility = (ability: Dnd5eAbilityId | null) => {
    const path = 'spellcasting.ability';
    const candidate = writeField(draftRef.current, path, ability);
    if (deriveDnd5eCharacterValues(candidate, rulesVersion) === null) return;
    clearNumericBuffer('spellcasting.attackBonusOffset');
    clearNumericBuffer('spellcasting.saveDcOffset');
    changeField(path, ability);
    void save();
  };

  const spellcastingAbilityDropdown = () => {
    const selected = draft.spellcasting.ability;
    return (
      <Dropdown
        accessibleLabel="Spellcasting Ability"
        className={[styles.dropdownField, styles.spellSummaryDropdown].join(' ')}
        disabled={!canEdit}
        label={selected === null ? 'None' : ABILITY_LABELS[selected]}
        panelLabel="Spellcasting Ability options"
        showIndicator={false}
        title="The ability used to derive spell attacks and spell save DC."
      >
        <DropdownOption
          active={selected === null}
          label="None"
          onSelect={() => selectSpellcastingAbility(null)}
        />
        {DND5E_ABILITIES.map((ability) => (
          <DropdownOption
            active={selected === ability}
            key={ability}
            label={ABILITY_LABELS[ability]}
            onSelect={() => selectSpellcastingAbility(ability)}
          />
        ))}
      </Dropdown>
    );
  };

  const spellSummaryCalculatedInput = (
    path: string,
    accessibleLabel: string,
    total: number | null,
    currentOffset: number,
    signed: boolean,
    nonnegative = false,
    unclampedTotal = total,
    className = styles.spellSummaryInput,
  ) => {
    const fallback = total === null
      ? ''
      : signed
        ? formatDnd5eSignedValue(total)
        : String(total);
    const displayed = numericValue(path, fallback);
    return (
      <InlineInput
        aria-label={accessibleLabel}
        autoComplete="off"
        className={className}
        inputMode="numeric"
        maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
        placeholder={total === null ? '—' : undefined}
        readOnly={!canEdit || total === null}
        size={Math.max(1, displayed.length)}
        value={displayed}
        onBlur={() => {
          if (unclampedTotal === null) {
            clearNumericBuffer(path);
            return;
          }
          commitCalculatedTotal(
            path,
            unclampedTotal,
            currentOffset,
            nonnegative,
          );
        }}
        onChange={(event) => changeNumericBuffer(path, event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    );
  };

  const spellSlotCurrentInput = (slotLevel: Dnd5eSpellSlotLevel) => {
    const path = `spellcasting.slots.${slotLevel}.current`;
    const displayed = numericValue(
      path,
      String(draft.spellcasting.slots[slotLevel].current),
    );
    return (
      <InlineInput
        aria-label={`${SPELL_SLOT_LEVEL_LABELS[slotLevel]} Spell Slots Current`}
        autoComplete="off"
        className={styles.spellSlotInput}
        inputMode="numeric"
        maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
        readOnly={!canEdit}
        size={Math.max(1, displayed.length)}
        value={displayed}
        onBlur={() => commitNonnegativeValue(path)}
        onChange={(event) => changeNumericBuffer(path, event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    );
  };

  useEffect(() => {
    if (!canEdit || !hasDirtyDraft()) return undefined;
    saveTimerRef.current = window.setTimeout(
      () => void save(),
      JOURNAL_AUTOSAVE_DELAY_MS,
    );
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [canEdit, draft, hasDirtyDraft, name, save]);

  useEffect(() => journalApi.onChanged((event) => {
    if (
      event.campaignId === campaignId &&
      (!event.entryId || event.entryId === currentRef.current.id)
    ) {
      void refreshCurrent();
    }
  }), [campaignId, journalApi, refreshCurrent]);

  useEffect(() => {
    if (entry.revision > currentRef.current.revision) {
      applyServerEntry(entry);
    }
  }, [applyServerEntry, entry]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
  }, []);

  const close = useCallback(async () => {
    setCloseFailed(false);
    if (!hasDirtyDraft()) {
      onDismiss();
      return;
    }
    if (await save() || presentation === 'detached') onDismiss();
    else setCloseFailed(true);
  }, [hasDirtyDraft, onDismiss, presentation, save]);

  const discard = useCallback(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    onDismiss();
  }, [onDismiss]);

  const handledCloseRequestRef = useRef(0);
  useEffect(() => {
    if (
      presentation !== 'detached' ||
      closeRequestId <= handledCloseRequestRef.current
    ) return;
    handledCloseRequestRef.current = closeRequestId;
    void close();
  }, [close, closeRequestId, presentation]);

  return (
    <>
      <CharacterSheetPresentation
        accessibleLabel={`${current.name} character sheet`}
        onDismiss={() => void close()}
        presentation={presentation}
      >
        <div className={styles.workspace}>
          <div
            className={styles.sheetViewport}
            data-active-tab={activeTab}
            data-character-sheet-viewport
          >
            <main className={styles.sheet} data-active-tab={activeTab}>
              <header className={styles.header}>
                <section className={styles.tokenPlaceholder} aria-label="Character token">
                  <CircleUserRound aria-hidden size="3rem" strokeWidth={1.2} />
                  <span>Character Token</span>
                </section>
                <div className={styles.identityGrid}>
                  <div className={styles.classRow}>
                    <CharacterField
                      label="Name"
                      maxLength={MAX_JOURNAL_TITLE_INPUT_CODE_UNITS}
                      onBlur={() => void save()}
                      onChange={changeName}
                      readOnly={!canEdit}
                      title="The name used to identify this character."
                      value={name}
                    />
                    {dropdownField(
                      'identity.className',
                      'Class',
                      "The character's primary adventuring class.",
                      DND5E_5_5E_CLASSES,
                      CLASS_ICONS,
                      false,
                      (value) => selectClass(String(value)),
                    )}
                    {field(
                      'identity.subclass',
                      'Subclass',
                      "The specialization chosen within the character's class.",
                    )}
                    {dropdownField(
                      'identity.level',
                      'Level',
                      "The character's current class level, from 1 to 20.",
                      DND5E_CHARACTER_LEVELS,
                      LEVEL_ICONS,
                      true,
                    )}
                    {field(
                      'identity.experience',
                      'Experience',
                      "The character's accumulated experience points.",
                    )}
                  </div>
                  <div className={styles.detailRow}>
                    {field(
                      'identity.ancestry',
                      ancestryLabel,
                      rulesVersion === '5e'
                        ? "The character's race."
                        : "The character's species.",
                    )}
                    {field(
                      'identity.subAncestry',
                      subAncestryLabel,
                      rulesVersion === '5e'
                        ? "The character's subrace, if applicable."
                        : "The character's lineage, if applicable.",
                    )}
                    {field(
                      'identity.creatureType',
                      creatureLabel,
                      "The character's creature type, such as Humanoid.",
                    )}
                    {field('appearance.age', 'Age', "The character's age.")}
                    {field('appearance.height', 'Height', "The character's height.")}
                  </div>
                  <div className={styles.detailRow}>
                    {field('appearance.weight', 'Weight', "The character's weight.")}
                    {field(
                      'appearance.eyes',
                      'Eyes',
                      "The character's eye color or appearance.",
                    )}
                    {field(
                      'appearance.skin',
                      'Skin',
                      "The character's skin color or appearance.",
                    )}
                    {field(
                      'appearance.hair',
                      'Hair',
                      "The character's hair color or appearance.",
                    )}
                    {field(
                      'appearance.size',
                      'Size',
                      "The character's size category, such as Medium or Small.",
                    )}
                  </div>
                </div>
              </header>

              <section className={styles.abilities} aria-label="Abilities">
                {DND5E_ABILITIES.map((ability) => {
                  const label = ABILITY_LABELS[ability];
                  const modifierPath = `abilities.${ability}.modifierOffset`;
                  const savingThrowPath = `abilities.${ability}.savingThrowOffset`;
                  const scorePath = `abilities.${ability}.score`;
                  const checkPending = pendingRolls.has(`ability:${ability}:check`);
                  const savingThrowPending = pendingRolls.has(
                    `ability:${ability}:saving-throw`,
                  );
                  return (
                    <article
                      aria-label={`${label} ability`}
                      className={styles.abilityCard}
                      key={ability}
                    >
                      <h2 className={styles.abilityHeading}>
                        <button
                          aria-busy={checkPending}
                          aria-label={`Roll ${label} check from ability heading`}
                          className={styles.abilityHeadingButton}
                          disabled={!networkApi || checkPending}
                          title={!networkApi
                            ? 'Chat is unavailable.'
                            : `Roll ${label} check`}
                          type="button"
                          onClick={() => void rollAbility(ability, 'check')}
                        >
                          {label}
                        </button>
                      </h2>
                      <label className={styles.modifierField}>
                        <InlineInput
                          aria-label={`${label} modifier`}
                          autoComplete="off"
                          className={styles.modifierInput}
                          maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                          readOnly={!canEdit}
                          value={numericValue(
                            modifierPath,
                            formatDnd5eSignedValue(derived.abilities[ability].modifier),
                          )}
                          onBlur={() => commitCalculatedTotal(
                            modifierPath,
                            derived.abilities[ability].modifier,
                            draft.abilities[ability].modifierOffset,
                          )}
                          onChange={(event) => changeNumericBuffer(
                            modifierPath,
                            event.currentTarget.value,
                          )}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                          }}
                        />
                      </label>
                      <div className={styles.abilityFooter}>
                        <AbilityValueField
                          accessibleLabel={`${label} score`}
                          label="Score"
                          onBlur={() => commitAbilityScore(ability)}
                          onChange={(value) => changeNumericBuffer(scorePath, value)}
                          onRoll={() => void rollAbility(ability, 'check')}
                          readOnly={!canEdit}
                          rollAccessibleLabel={`Roll ${label} check`}
                          rollDisabled={!networkApi || checkPending}
                          rollPending={checkPending}
                          value={numericValue(scorePath, String(draft.abilities[ability].score))}
                        />
                        <AbilityValueField
                          accessibleLabel={`${label} saving throw`}
                          label="Throw"
                          onBlur={() => commitCalculatedTotal(
                            savingThrowPath,
                            derived.abilities[ability].savingThrow,
                            draft.abilities[ability].savingThrowOffset,
                          )}
                          onChange={(value) => changeNumericBuffer(savingThrowPath, value)}
                          onRoll={() => void rollAbility(ability, 'saving-throw')}
                          readOnly={!canEdit}
                          rollAccessibleLabel={`Roll ${label} saving throw`}
                          rollDisabled={!networkApi || savingThrowPending}
                          rollPending={savingThrowPending}
                          value={numericValue(
                            savingThrowPath,
                            formatDnd5eSignedValue(derived.abilities[ability].savingThrow),
                          )}
                        />
                      </div>
                    </article>
                  );
                })}
              </section>

              <div className={styles.tabStrip}>
                <Tabs
                  activeId={activeTab}
                  ariaLabel="Character sheet sections"
                  items={tabs}
                  onChange={setActiveTab}
                />
              </div>

              {activeTab === 'home' ? (
                <div
                  id={`character-${entry.id}-home`}
                  aria-labelledby={`character-${entry.id}-home-tab`}
                  className={styles.homeGrid}
                  role="tabpanel"
                >
                  <div className={styles.leftColumn}>
                    <section className={styles.importantStats}>
                      <h2>Important Statistics</h2>
                      <div className={styles.statGrid}>
                        {IMPORTANT_STATS.map((stat) => {
                          const derivedStat = 'offsetKey' in stat;
                          const key = derivedStat ? stat.offsetKey : stat.path;
                          const path = `importantStats.${key}`;
                          const total = derivedStat ? derived[stat.derivedKey] : null;
                          const rollKind = 'rollKind' in stat ? stat.rollKind : null;
                          const rollPending = rollKind
                            ? pendingRolls.has(`stat:${rollKind}`)
                            : false;
                          const shareKey = 'shareKey' in stat
                            ? stat.shareKey as ImportantStatShareKey
                            : null;
                          return (
                            <div
                              className={styles.statRow}
                              key={key}
                              onContextMenu={(event) => {
                                if (!shareKey) return;
                                event.preventDefault();
                                const focused = event.target instanceof HTMLElement
                                  ? event.target
                                  : null;
                                openCharacterShareMenu(
                                  shareKey,
                                  stat.label,
                                  event,
                                  () => focused?.focus(),
                                  event.currentTarget.closest('dialog') ?? undefined,
                                );
                              }}
                              onKeyDown={(event) => {
                                if (
                                  !shareKey ||
                                  (event.key !== 'ContextMenu' &&
                                    !(event.shiftKey && event.key === 'F10'))
                                ) return;
                                event.preventDefault();
                                const focused = event.target instanceof HTMLElement
                                  ? event.target
                                  : null;
                                const bounds = event.currentTarget.getBoundingClientRect();
                                openCharacterShareMenu(
                                  shareKey,
                                  stat.label,
                                  { clientX: bounds.left + 24, clientY: bounds.bottom },
                                  () => focused?.focus(),
                                  event.currentTarget.closest('dialog') ?? undefined,
                                );
                              }}
                            >
                              {rollKind ? (
                                <button
                                  aria-busy={rollPending}
                                  aria-label={rollKind === 'concentration'
                                    ? 'Roll Concentration saving throw'
                                    : 'Roll Initiative'}
                                  className={styles.statRollButton}
                                  disabled={!networkApi || rollPending}
                                  title={!networkApi
                                    ? 'Chat is unavailable.'
                                    : `Roll ${stat.label}`}
                                  type="button"
                                  onClick={() => rollImportantStat(rollKind)}
                                >
                                  {stat.label}
                                </button>
                              ) : (
                                <span className={styles.statLabel}>{stat.label}</span>
                              )}
                              <label className={styles.statInputField}>
                                <InlineInput
                                  aria-label={stat.accessibleLabel}
                                  autoComplete="off"
                                  className={styles.statInput}
                                  maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                                  readOnly={!canEdit}
                                  value={derivedStat
                                    ? numericValue(path, formatDnd5eSignedValue(total!))
                                    : readStringField(draft, path)}
                                  onBlur={derivedStat
                                    ? () => commitCalculatedTotal(
                                      path,
                                      total!,
                                      draft.importantStats[stat.offsetKey],
                                    )
                                    : () => void save()}
                                  onChange={(event) => {
                                    if (derivedStat) {
                                      changeNumericBuffer(path, event.currentTarget.value);
                                    } else {
                                      changeField(path, event.currentTarget.value);
                                    }
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') event.currentTarget.blur();
                                  }}
                                />
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                    <section className={styles.collectionPanel}>
                      <h2>Skills</h2>
                      <div className={styles.skillGrid}>
                        {DND5E_SKILLS.map((skill) => {
                          const skillData = draft.skills[skill.id];
                          const training = skillData.training;
                          const values = derived.skills[skill.id];
                          const bonusPath = `skills.${skill.id}.bonusOffset`;
                          const passivePath = `skills.${skill.id}.passiveOffset`;
                          const displayedBonus = numericValue(
                            bonusPath,
                            formatDnd5eSignedValue(values.bonus),
                          );
                          const displayedPassive = numericValue(
                            passivePath,
                            String(values.passive),
                          );
                          const rollPending = pendingRolls.has(`skill:${skill.id}`);
                          return (
                            <div className={styles.skillRow} key={skill.id}>
                              <CharacterSkillTrainingButton
                                disabled={!canEdit}
                                label={skill.label}
                                training={training}
                                onChange={(nextTraining) => {
                                  const path = `skills.${skill.id}.training`;
                                  const candidate = writeField(draftRef.current, path, nextTraining);
                                  if (deriveDnd5eCharacterValues(candidate, rulesVersion) === null) return;
                                  changeField(path, nextTraining);
                                  void save();
                                }}
                              />
                              <span className={styles.skillLabel}>
                                <span className={styles.skillAbility}>{skill.abbreviation}</span>
                                <button
                                  aria-busy={rollPending}
                                  aria-label={`Roll ${skill.label}`}
                                  className={[
                                    styles.skillName,
                                    styles.skillNameRollButton,
                                  ].join(' ')}
                                  disabled={!networkApi || rollPending}
                                  title={!networkApi
                                    ? 'Chat is unavailable.'
                                    : `Roll ${skill.label}`}
                                  type="button"
                                  onClick={() => rollBuiltInSkill(skill.id)}
                                >
                                  {skill.label}
                                </button>
                              </span>
                              <span className={styles.skillValues}>
                                <InlineInput
                                  aria-label={`${skill.label} bonus`}
                                  autoComplete="off"
                                  className={styles.skillValueInput}
                                  maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                                  readOnly={!canEdit}
                                  size={Math.max(1, displayedBonus.length)}
                                  value={displayedBonus}
                                  onBlur={() => commitCalculatedTotal(
                                    bonusPath,
                                    values.bonus,
                                    skillData.bonusOffset,
                                  )}
                                  onChange={(event) => changeNumericBuffer(
                                    bonusPath,
                                    event.currentTarget.value,
                                  )}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') event.currentTarget.blur();
                                  }}
                                />
                                <span aria-hidden>/</span>
                                <InlineInput
                                  aria-label={`${skill.label} passive score`}
                                  autoComplete="off"
                                  className={styles.skillValueInput}
                                  maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
                                  readOnly={!canEdit}
                                  size={Math.max(1, displayedPassive.length)}
                                  value={displayedPassive}
                                  onBlur={() => commitCalculatedTotal(
                                    passivePath,
                                    values.passive,
                                    skillData.passiveOffset,
                                  )}
                                  onChange={(event) => changeNumericBuffer(
                                    passivePath,
                                    event.currentTarget.value,
                                  )}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') event.currentTarget.blur();
                                  }}
                                />
                              </span>
                            </div>
                          );
                        })}
                        <CharacterCustomSkillPanel
                          canEdit={canEdit}
                          canSendToChat={Boolean(networkApi)}
                          derived={derived.customSkills}
                          isSendPending={(skillId) => pendingRolls.has(
                            `custom-skill:${skillId}`,
                          )}
                          skills={draft.customSkills}
                          onChange={changeCustomSkill}
                          onCommit={commitCustomSkill}
                          onSave={save}
                          onSendToChat={(skill) => rollCustomSkill(skill.id)}
                        />
                      </div>
                    </section>
                  </div>
                  <div className={styles.middleColumn}>
                    <section className={[styles.collectionPanel, styles.healthPanel].join(' ')}>
                      <h2>Health</h2>
                      <div className={styles.healthGrid}>
                        <div
                          className={styles.healthField}
                          {...healthShareHandlers('hitPoints', 'HP')}
                        >
                          <span className={styles.healthHeading}>HP</span>
                          <span className={styles.healthPair}>
                            {healthInput('health.currentHitPoints', 'Current hit points')}
                            <span aria-hidden>/</span>
                            {healthInput('health.maximumHitPoints', 'Maximum hit points')}
                          </span>
                        </div>
                        <div
                          className={styles.healthField}
                          {...healthShareHandlers('temporaryHitPoints', 'Temp HP')}
                        >
                          <span className={styles.healthHeading}>Temp HP</span>
                          {healthInput('health.temporaryHitPoints', 'Temporary hit points')}
                        </div>
                        <div
                          className={styles.healthField}
                          {...healthShareHandlers('hitDice', 'Hit Dice')}
                        >
                          <button
                            aria-busy={pendingRolls.has('health:hit-die')}
                            aria-label="Roll Hit Die"
                            className={styles.healthRollButton}
                            disabled={
                              !networkApi ||
                              !hitDieCanRoll ||
                              pendingRolls.has('health:hit-die')
                            }
                            title={!networkApi
                              ? 'Chat is unavailable.'
                              : !hitDieCanRoll
                                ? 'Set the Hit Die to d4, d6, d8, d10, or d12.'
                              : 'Roll one Hit Die'}
                            type="button"
                            onClick={() => void rollHitDie()}
                          >
                            Hit Dice
                          </button>
                          <span className={styles.hitDiceValues}>
                            {healthInput('health.currentHitDice', 'Current hit dice')}
                            <span aria-hidden>/</span>
                            {healthInput('health.maximumHitDice', 'Maximum hit dice')}
                            {healthInput('health.hitDie', 'Hit die', styles.hitDieInput, 'text')}
                          </span>
                        </div>
                      </div>
                    </section>
                    <section className={styles.collectionPanel}>
                      <h2>Actions</h2>
                      <CharacterActionPanel
                        actions={draft.actions}
                        campaignId={campaignId}
                        canEdit={canEdit}
                        data={draft}
                        derived={derived}
                        networkApi={networkApi}
                        onChange={changeAction}
                        onCommit={commitAction}
                        onError={setError}
                        onSave={save}
                      />
                    </section>
                    <section className={styles.collectionPanel}>
                      <h2>Inventory</h2>
                      <CharacterInventoryPanel
                        canEdit={canEdit}
                        canSendToChat={Boolean(networkApi)}
                        derived={derived.inventory}
                        inventory={draft.inventory}
                        onChange={changeInventory}
                        onCommit={commitInventory}
                        onSave={save}
                        onSendToChat={(entry) => void sendCharacterShare(
                          `inventory:${entry.id}`,
                        )}
                      />
                    </section>
                  </div>
                  <div className={styles.rightColumn}>
                    <section className={styles.collectionPanel}>
                      <h2>Resources</h2>
                      <CharacterResourcePanel
                        canEdit={canEdit}
                        canSendToChat={Boolean(networkApi)}
                        resources={draft.resources}
                        onChange={changeResource}
                        onCommit={commitResource}
                        onSave={save}
                        onSendToChat={(resource) => void sendCharacterShare(
                          `resource:${resource.id}`,
                        )}
                      />
                    </section>
                    <section className={styles.collectionPanel}>
                      <h2>Features</h2>
                      <CharacterFeaturePanel
                        canEdit={canEdit}
                        canSendToChat={Boolean(networkApi)}
                        features={draft.features}
                        onChange={changeFeature}
                        onCommit={commitFeature}
                        onSave={save}
                        onSendToChat={(feature) => void sendCharacterShare(
                          `feature:${feature.id}`,
                        )}
                      />
                    </section>
                  </div>
                </div>
              ) : activeTab === 'settings' ? (
                <div
                  id={`character-${entry.id}-settings`}
                  aria-labelledby={`character-${entry.id}-settings-tab`}
                  className={styles.settingsPanel}
                  role="tabpanel"
                >
                  <div className={styles.settingsRow}>
                    <div className={styles.settingsCopy}>
                      <span className={styles.settingsLabel}>
                        Use Variant Encumbrance
                      </span>
                      <p className={styles.settingsDescription}>
                        Shows Encumbered and Heavily Encumbered thresholds based on
                        Strength and Size. This does not change Speed or rolls.
                      </p>
                    </div>
                    <Dropdown
                      accessibleLabel="Use Variant Encumbrance"
                      className={styles.settingsDropdown}
                      disabled={!canEdit}
                      label={draft.inventory.variantEncumbrance
                        ? 'Enabled'
                        : 'Disabled'}
                      panelLabel="Use Variant Encumbrance options"
                    >
                      <DropdownOption
                        active={draft.inventory.variantEncumbrance}
                        label="Enabled"
                        onSelect={() => void commitInventory({
                          kind: 'set-variant-encumbrance',
                          value: true,
                        })}
                      />
                      <DropdownOption
                        active={!draft.inventory.variantEncumbrance}
                        label="Disabled"
                        onSelect={() => void commitInventory({
                          kind: 'set-variant-encumbrance',
                          value: false,
                        })}
                      />
                    </Dropdown>
                  </div>
                </div>
              ) : (
                <div
                  id={`character-${entry.id}-spells`}
                  aria-labelledby={`character-${entry.id}-spells-tab`}
                  className={styles.spellsPanel}
                  role="tabpanel"
                >
                  <section
                    aria-label="Spellcasting summary"
                    className={styles.spellSummary}
                  >
                    <section
                      className={`${styles.collectionPanel} ${styles.spellSummaryPanel}`}
                    >
                      <h2>Spellcasting Ability</h2>
                      <div className={styles.spellSummaryValue}>
                        {spellcastingAbilityDropdown()}
                      </div>
                    </section>
                    <section
                      className={`${styles.collectionPanel} ${styles.spellSummaryPanel}`}
                    >
                      <h2>Spell Save DC</h2>
                      <div className={styles.spellSummaryValue}>
                        {spellSummaryCalculatedInput(
                          'spellcasting.saveDcOffset',
                          'Spell Save DC',
                          derived.spellcasting.saveDc,
                          draft.spellcasting.saveDcOffset,
                          false,
                        )}
                      </div>
                    </section>
                    <section
                      className={`${styles.collectionPanel} ${styles.spellSummaryPanel}`}
                    >
                      <h2>Spell Attack Bonus</h2>
                      <div className={styles.spellSummaryValue}>
                        {spellSummaryCalculatedInput(
                          'spellcasting.attackBonusOffset',
                          'Spell Attack Bonus',
                          derived.spellcasting.attackBonus,
                          draft.spellcasting.attackBonusOffset,
                          true,
                        )}
                      </div>
                    </section>
                    <section
                      className={`${styles.collectionPanel} ${styles.spellSummaryPanel}`}
                    >
                      <h2>Concentration Save</h2>
                      <div className={styles.spellSummaryValue}>
                        {spellSummaryCalculatedInput(
                          'importantStats.concentrationSaveOffset',
                          'Spellcasting Concentration Save',
                          derived.concentrationSave,
                          draft.importantStats.concentrationSaveOffset,
                          true,
                        )}
                      </div>
                    </section>
                    <section
                      className={`${styles.collectionPanel} ${styles.spellSummaryPanel}`}
                    >
                      <h2>Prepared Spells</h2>
                      <div className={`${styles.spellSummaryValue} ${styles.preparedSpellValues}`}>
                        <output
                          aria-label="Current Prepared Spells"
                          className={styles.spellSummaryInput}
                          data-incomplete={preparedSpellSummary.incomplete}
                          data-over-maximum={preparedSpellSummary.overMaximum}
                          title={preparedSpellSummary.incomplete
                            ? 'Unavailable Prepared spells are excluded from this count.'
                            : preparedSpellSummary.overMaximum
                              ? 'Prepared spells exceed the current maximum.'
                              : undefined}
                        >
                          {preparedSpellSummary.current}
                        </output>
                        <span aria-hidden>/</span>
                        {spellSummaryCalculatedInput(
                          'spellcasting.preparedMaximumOffset',
                          'Total Prepared Spells',
                          derived.spellcasting.preparedMaximum,
                          draft.spellcasting.preparedMaximumOffset,
                          false,
                          true,
                          derived.spellcasting.preparedMaximumBase +
                            draft.spellcasting.preparedMaximumOffset,
                        )}
                      </div>
                    </section>
                  </section>
                  <section
                    aria-label="Spell Slot Tracker"
                    className={styles.spellSlotTracker}
                  >
                    <div className={styles.spellSlotTrackerBody}>
                      {availableSpellSlotLevels.length > 0 ? (
                        <div className={styles.spellSlotList}>
                          {[
                            availableSpellSlotLevels.slice(0, 5),
                            availableSpellSlotLevels.slice(5),
                          ].filter((row) => row.length > 0).map((row) => (
                            <div
                              className={styles.spellSlotRow}
                              key={row[0]}
                              style={{
                                gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`,
                              }}
                            >
                              {row.map((slotLevel) => {
                                const derivedSlot = derived.spellcasting.slots[slotLevel];
                                const storedSlot = draft.spellcasting.slots[slotLevel];
                                const renderedSlotCount = Math.min(derivedSlot.total, 8);
                                return (
                                  <article
                                    className={styles.spellSlotGroup}
                                    key={slotLevel}
                                  >
                                    <div className={styles.spellSlotHeading}>
                                      <strong>
                                        {SPELL_SLOT_LEVEL_LABELS[slotLevel]
                                          .replace(' Level', '')}
                                      </strong>
                                      <div className={styles.spellSlotValues}>
                                        {spellSlotCurrentInput(slotLevel)}
                                        <span aria-hidden>/</span>
                                        {spellSummaryCalculatedInput(
                                          `spellcasting.slots.${slotLevel}.totalOffset`,
                                          `${SPELL_SLOT_LEVEL_LABELS[slotLevel]} Spell Slots Total`,
                                          derivedSlot.total,
                                          storedSlot.totalOffset,
                                          false,
                                          true,
                                          derivedSlot.baseTotal + storedSlot.totalOffset,
                                          styles.spellSlotInput,
                                        )}
                                      </div>
                                    </div>
                                    <div className={styles.spellSlotSegments}>
                                      {renderedSlotCount > 0 ? (
                                        Array.from(
                                          { length: renderedSlotCount },
                                          (_, index) => (
                                            <button
                                              aria-label={`${SPELL_SLOT_LEVEL_LABELS[slotLevel]} spell slot ${index + 1}: ${index < storedSlot.current ? 'available' : 'expended'}`}
                                              aria-pressed={index < storedSlot.current}
                                              className={styles.spellSlotSegment}
                                              data-available={index < storedSlot.current}
                                              disabled={!canEdit}
                                              key={index}
                                              type="button"
                                              onClick={() => setSpellSlotCurrent(
                                                slotLevel,
                                                index < storedSlot.current
                                                  ? index
                                                  : index + 1,
                                              )}
                                            />
                                          ),
                                        )
                                      ) : (
                                        <span className={styles.spellSlotNoCapacity}>
                                          No slots
                                        </span>
                                      )}
                                      {derivedSlot.total > renderedSlotCount ? (
                                        <span className={styles.spellSlotOverflow}>
                                          +{derivedSlot.total - renderedSlotCount}
                                        </span>
                                      ) : null}
                                    </div>
                                  </article>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className={styles.spellSlotEmpty}>No spell slots available</p>
                      )}
                    </div>
                  </section>
                  <CharacterSpellPanel
                    campaignId={campaignId}
                    canEdit={canEdit}
                    characterEntryId={current.id}
                    data={draft}
                    derived={derived}
                    journalApi={journalApi}
                    networkApi={networkApi}
                    onCommitSpells={commitSpells}
                    onConsumeSpellSlot={consumeSpellSlot}
                    onError={setError}
                    onPreparedSummaryChange={setPreparedSpellSummary}
                    onRefundSpellSlot={(level) => adjustSpellSlot(level, 1)}
                    onSendRoll={sendRoll}
                  />
                </div>
              )}
            </main>
          </div>
        </div>
      </CharacterSheetPresentation>

      <Modal
        accessibleLabel="Character sheet error"
        dismissDisabled={closeFailed}
        isOpen={Boolean(error)}
        onDismiss={() => setError(null)}
      >
        <h2>Character Sheet</h2>
        <p role="alert">{error}</p>
        {closeFailed ? (
          <div className={styles.errorActions}>
            <Button
              onClick={() => {
                setError(null);
                void close();
              }}
            >
              Retry save
            </Button>
            <Button
              onClick={() => {
                setError(null);
                discard();
              }}
              variant="danger"
            >
              Discard changes
            </Button>
          </div>
        ) : (
          <Button onClick={() => setError(null)}>Close</Button>
        )}
      </Modal>
    </>
  );
}
