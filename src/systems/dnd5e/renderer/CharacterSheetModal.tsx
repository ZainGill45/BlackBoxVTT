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
} from 'react';
import { Button } from '../../../components/ui/Button';
import { Checkbox } from '../../../components/ui/Checkbox';
import { Dropdown, DropdownOption } from '../../../components/ui/Dropdown';
import { InlineInput } from '../../../components/ui/InlineInput';
import { Modal } from '../../../components/ui/Modal';
import { Tabs, type TabOption } from '../../../components/ui/Tabs';
import type { CampaignSystemState } from '../../../shared/gameSystems';
import type { NetworkApi } from '../../../shared/network';
import {
  JOURNAL_AUTOSAVE_DELAY_MS,
  MAX_JOURNAL_TITLE_INPUT_CODE_UNITS,
  normalizeJournalTitle,
  type JournalApi,
  type JournalEntry,
  type SystemJournalEntry,
} from '../../../shared/journal';
import {
  applyDnd5eCharacterActionMutations,
  applyDnd5eCharacterFeatureMutations,
  applyDnd5eCharacterInventoryMutations,
  applyDnd5eCharacterResourceMutations,
  calculateDnd5eOffsetForTotal,
  createDefaultDnd5eCharacterData,
  DND5E_5_5E_CLASSES,
  DND5E_ABILITIES,
  DND5E_CHARACTER_LEVELS,
  DND5E_SKILLS,
  deriveDnd5eCharacterValues,
  formatDnd5eSignedValue,
  isDnd5eCharacterData,
  MAX_DND5E_CHARACTER_FIELD_CODE_UNITS,
  nextDnd5eSkillTraining,
  parseDnd5eSafeInteger,
  type Dnd5eAbilityId,
  type Dnd5eCharacterActionMutation,
  type Dnd5eCharacterData,
  type Dnd5eCharacterFeatureMutation,
  type Dnd5eCharacterInventoryMutation,
  type Dnd5eCharacterResourceMutation,
  type Dnd5eRulesVersion,
  type Dnd5eSkillTraining,
} from '../characterData';
import {
  DND5E_CHARACTER_ENTRY_TYPE_ID,
  isDnd5eSettings,
} from '../definition';
import { CharacterActionPanel } from './CharacterActionPanel';
import { CharacterFeaturePanel } from './CharacterFeaturePanel';
import { CharacterInventoryPanel } from './CharacterInventoryPanel';
import { CharacterResourcePanel } from './CharacterResourcePanel';
import { CharacterSheetAddEntryButton } from './CharacterSheetAddEntryButton';
import styles from './CharacterSheetModal.module.css';

type CharacterSheetTab = 'home' | 'settings' | 'spells';

interface CharacterSheetModalProps {
  campaignId: string;
  entry: SystemJournalEntry;
  journalApi: JournalApi;
  networkApi?: NetworkApi;
  onDismiss: () => void;
  onUpdated: (entry: SystemJournalEntry) => void;
  system: CampaignSystemState;
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
  readOnly: boolean;
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
  },
  { accessibleLabel: 'Armor Class', label: 'Armor Class', path: 'armorClass' },
  { accessibleLabel: 'Current Speed', label: 'Speed', path: 'currentSpeed' },
  {
    accessibleLabel: 'Concentration Save',
    derivedKey: 'concentrationSave',
    label: 'Concentration',
    offsetKey: 'concentrationSaveOffset',
  },
  {
    accessibleLabel: 'Proficiency Bonus',
    derivedKey: 'proficiencyBonus',
    label: 'Proficiency',
    offsetKey: 'proficiencyBonusOffset',
  },
  { accessibleLabel: 'Inspiration Count', label: 'Inspiration', path: 'inspirationCount' },
] as const;

const SKILL_TRAINING_LABELS = {
  expertise: 'Expertise',
  proficient: 'Proficient',
  untrained: 'Untrained',
} satisfies Record<Dnd5eSkillTraining, string>;

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
  inventoryMutations: readonly Dnd5eCharacterInventoryMutation[],
  resourceMutations: readonly Dnd5eCharacterResourceMutation[],
  featureMutations: readonly Dnd5eCharacterFeatureMutation[],
) {
  const next = mergeFields(data, fields);
  const actions = applyDnd5eCharacterActionMutations(
    next.actions,
    actionMutations,
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
  return {
    data: {
      ...next,
      actions: actions.actions,
      features: features.features,
      inventory: inventory.inventory,
      resources: resources.resources,
    },
    missingActionIds: actions.missingIds,
    invalidInventory: inventory.invalid,
    missingFeatureIds: features.missingIds,
    missingInventoryIds: inventory.missingIds,
    missingResourceIds: resources.missingIds,
  };
}

function actionMutationTarget(
  mutation: Dnd5eCharacterActionMutation,
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
  readOnly,
  value,
}: AbilityValueFieldProps) {
  return (
    <label className={styles.abilityValueField}>
      <span>{label}</span>
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
    </label>
  );
}

export function CharacterSheetModal({
  campaignId,
  entry,
  journalApi,
  networkApi,
  onDismiss,
  onUpdated,
  system,
}: CharacterSheetModalProps) {
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
  const currentRef = useRef(initialEntry);
  const draftRef = useRef(initialData);
  const nameRef = useRef(entry.name);
  const dirtyFieldsRef = useRef(new Map<string, CharacterFieldValue>());
  const actionMutationsRef = useRef<Dnd5eCharacterActionMutation[]>([]);
  const featureMutationsRef = useRef<Dnd5eCharacterFeatureMutation[]>([]);
  const inventoryMutationsRef = useRef<Dnd5eCharacterInventoryMutation[]>([]);
  const resourceMutationsRef = useRef<Dnd5eCharacterResourceMutation[]>([]);
  const saveTimerRef = useRef<number | null>(null);
  const mutationQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const refreshRequestRef = useRef(0);

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
  const validData = isCharacterEntry(current);
  const canEdit = validData && current.capabilities.edit;

  const hasDirtyDraft = useCallback(() => (
    dirtyFieldsRef.current.size > 0 ||
    actionMutationsRef.current.length > 0 ||
    featureMutationsRef.current.length > 0 ||
    inventoryMutationsRef.current.length > 0 ||
    resourceMutationsRef.current.length > 0 ||
    nameRef.current !== currentRef.current.name
  ), []);

  const applyServerEntry = useCallback((
    updated: SystemJournalEntry,
    savedFields?: ReadonlyMap<string, CharacterFieldValue>,
    savedActionMutations?: readonly Dnd5eCharacterActionMutation[],
    savedInventoryMutations?: readonly Dnd5eCharacterInventoryMutation[],
    savedResourceMutations?: readonly Dnd5eCharacterResourceMutation[],
    savedFeatureMutations?: readonly Dnd5eCharacterFeatureMutation[],
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
      inventoryMutationsRef.current,
      resourceMutationsRef.current,
      featureMutationsRef.current,
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
        inventoryMutationsRef.current,
        resourceMutationsRef.current,
        featureMutationsRef.current,
      );
      setError('An Action was deleted remotely, so its pending local edit was discarded.');
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
      inventoryMutationsRef.current,
        resourceMutationsRef.current,
        featureMutationsRef.current,
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
      inventoryMutationsRef.current,
        resourceMutationsRef.current,
        featureMutationsRef.current,
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
      inventoryMutationsRef.current,
        resourceMutationsRef.current,
        featureMutationsRef.current,
      );
      setError('A Feature was deleted remotely, so its pending local edit was discarded.');
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
    const inventoryMutations = [...inventoryMutationsRef.current];
    const resourceMutations = [...resourceMutationsRef.current];
    const featureMutations = [...featureMutationsRef.current];
    const pendingName = normalizeJournalTitle(nameRef.current);
    const nameChanged = pendingName !== active.name;
    if (
      dirtyFields.size === 0 &&
      actionMutations.length === 0 &&
      inventoryMutations.length === 0 &&
      resourceMutations.length === 0 &&
      featureMutations.length === 0 &&
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
        inventoryMutations.length > 0 ||
        resourceMutations.length > 0 ||
        featureMutations.length > 0
      ) {
        if (!isCharacterEntry(next)) return false;
        let merged = mergeCharacterDraft(
          next.data,
          dirtyFields,
          actionMutations,
          inventoryMutations,
          resourceMutations,
          featureMutations,
        );
        if (
          merged.invalidInventory ||
          merged.missingActionIds.length > 0 ||
          merged.missingInventoryIds.length > 0 ||
          merged.missingResourceIds.length > 0 ||
          merged.missingFeatureIds.length > 0 ||
          !isDnd5eCharacterData(merged.data)
        ) {
          setError(merged.invalidInventory
            ? 'The Inventory data is invalid.'
            : merged.missingActionIds.length > 0
              ? 'An Action was deleted remotely, so its pending local edit was discarded.'
            : merged.missingInventoryIds.length > 0
              ? 'An Inventory entry was deleted remotely, so its pending local edit was discarded.'
              : merged.missingFeatureIds.length > 0
            ? 'A Feature was deleted remotely, so its pending local edit was discarded.'
            : merged.missingResourceIds.length > 0
              ? 'A Resource was deleted remotely, so its pending local edit was discarded.'
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
            inventoryMutations,
            resourceMutations,
            featureMutations,
          );
          if (
            merged.invalidInventory ||
            merged.missingActionIds.length > 0 ||
            merged.missingInventoryIds.length > 0 ||
            merged.missingResourceIds.length > 0 ||
            merged.missingFeatureIds.length > 0 ||
            !isDnd5eCharacterData(merged.data)
          ) {
            setError(merged.invalidInventory
              ? 'The Inventory data is invalid.'
              : merged.missingActionIds.length > 0
                ? 'An Action was deleted remotely, so its pending local edit was discarded.'
              : merged.missingInventoryIds.length > 0
                ? 'An Inventory entry was deleted remotely, so its pending local edit was discarded.'
                : merged.missingFeatureIds.length > 0
              ? 'A Feature was deleted remotely, so its pending local edit was discarded.'
              : merged.missingResourceIds.length > 0
                ? 'A Resource was deleted remotely, so its pending local edit was discarded.'
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
          inventoryMutations,
          resourceMutations,
          featureMutations,
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

  const changeField = (path: string, value: CharacterFieldValue) => {
    const next = writeField(draftRef.current, path, value);
    draftRef.current = next;
    setDraft(next);
    const saved = isCharacterEntry(currentRef.current)
      ? readField(currentRef.current.data, path)
      : null;
    if (Object.is(value, saved)) dirtyFieldsRef.current.delete(path);
    else dirtyFieldsRef.current.set(path, value);
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
  ) => {
    const input = numericBuffers[path];
    if (input === undefined) {
      void save();
      return;
    }
    const desiredTotal = input.trim() === '' ? null : parseDnd5eSafeInteger(input);
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

  const dropdownField = (
    path: string,
    label: string,
    title: string,
    options: readonly string[],
    icons?: Readonly<Partial<Record<string, LucideIcon>>>,
    numeric = false,
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
  ) => (
    <InlineInput
      aria-label={accessibleLabel}
      autoComplete="off"
      className={[styles.healthInput, className].filter(Boolean).join(' ')}
      inputMode={inputMode}
      maxLength={MAX_DND5E_CHARACTER_FIELD_CODE_UNITS}
      readOnly={!canEdit}
      value={readStringField(draft, path)}
      onBlur={() => void save()}
      onChange={(event) => changeField(path, event.currentTarget.value)}
    />
  );

  const deathSaveTrack = (
    path: 'health.deathSaveFailures' | 'health.deathSaveSuccesses',
    label: 'Failure' | 'Success',
  ) => {
    const parsed = Number(readStringField(draft, path));
    const count = Number.isInteger(parsed) && parsed >= 0 && parsed <= 3 ? parsed : 0;
    return (
      <div
        aria-label={`Death save ${label === 'Success' ? 'successes' : 'failures'}`}
        className={styles.deathSaveTrack}
        data-outcome={label.toLowerCase()}
        role="group"
      >
        {Array.from({ length: 3 }, (_, index) => {
          const value = index + 1;
          return (
            <button
              aria-label={`${label} ${value}`}
              aria-pressed={count >= value}
              disabled={!canEdit}
              key={value}
              title={`${label} ${value}`}
              type="button"
              onClick={() => {
                changeField(path, String(count === value ? index : value));
                void save();
              }}
            >
              <svg aria-hidden viewBox="0 0 8 8">
                <circle cx="4" cy="4" r="3" />
              </svg>
            </button>
          );
        })}
      </div>
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

  const close = async () => {
    setCloseFailed(false);
    if (!hasDirtyDraft()) {
      onDismiss();
      return;
    }
    if (await save()) onDismiss();
    else setCloseFailed(true);
  };

  const discard = () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    onDismiss();
  };

  return (
    <>
      <Modal
        accessibleLabel={`${current.name} character sheet`}
        className={styles.modal}
        contentClassName={styles.content}
        initialFocus="dialog"
        isOpen
        onDismiss={() => void close()}
      >
        <div className={styles.workspace}>
          <div className={styles.sheetViewport} data-character-sheet-viewport>
            <main className={styles.sheet}>
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
                  return (
                    <article
                      aria-label={`${label} ability`}
                      className={styles.abilityCard}
                      key={ability}
                    >
                      <h2 className={styles.abilityHeading}>{label}</h2>
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
                          readOnly={!canEdit}
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
                          readOnly={!canEdit}
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
                          return (
                            <label className={styles.statRow} key={key}>
                              <span>{stat.label}</span>
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
                          );
                        })}
                      </div>
                    </section>
                    <section className={styles.collectionPanel}>
                      <h2>Skills</h2>
                      <div className={styles.skillGrid}>
                        {DND5E_SKILLS.map((skill) => {
                          const training = draft.skills[skill.id];
                          const nextTraining = nextDnd5eSkillTraining(training);
                          const values = derived.skills[skill.id];
                          return (
                            <div className={styles.skillRow} key={skill.id}>
                              <button
                                aria-label={`${skill.label} training: ${SKILL_TRAINING_LABELS[training]}`}
                                className={styles.skillTraining}
                                data-training={training}
                                disabled={!canEdit}
                                title={`Set ${skill.label} training to ${SKILL_TRAINING_LABELS[nextTraining]}`}
                                type="button"
                                onClick={() => {
                                  const path = `skills.${skill.id}`;
                                  const candidate = writeField(draftRef.current, path, nextTraining);
                                  if (deriveDnd5eCharacterValues(candidate, rulesVersion) === null) return;
                                  changeField(path, nextTraining);
                                  void save();
                                }}
                              >
                                <svg
                                  aria-hidden="true"
                                  className={styles.skillTrainingIcon}
                                  viewBox="0 0 12 12"
                                >
                                  <circle
                                    className={styles.skillTrainingOuter}
                                    cx="6"
                                    cy="6"
                                    r="4.5"
                                  />
                                  <circle
                                    className={styles.skillTrainingInner}
                                    cx="6"
                                    cy="6"
                                    r="2"
                                  />
                                </svg>
                              </button>
                              <span className={styles.skillLabel}>
                                <span className={styles.skillAbility}>{skill.abbreviation}</span>
                                <span className={styles.skillName}>{skill.label}</span>
                              </span>
                              <output
                                aria-label={`${skill.label} bonus and passive score`}
                                className={styles.skillValues}
                              >
                                {values.display}
                              </output>
                            </div>
                          );
                        })}
                        <div className={styles.skillAddRow}>
                          <CharacterSheetAddEntryButton
                            disabled={!canEdit}
                            label="Add Custom Skill"
                          />
                        </div>
                      </div>
                    </section>
                  </div>
                  <div className={styles.middleColumn}>
                    <section className={[styles.collectionPanel, styles.healthPanel].join(' ')}>
                      <h2>Health</h2>
                      <div className={styles.healthGrid}>
                        <label className={styles.healthField}>
                          <span>Current / Maximum</span>
                          <span className={styles.healthPair}>
                            {healthInput('health.currentHitPoints', 'Current hit points')}
                            <span aria-hidden>/</span>
                            {healthInput('health.maximumHitPoints', 'Maximum hit points')}
                          </span>
                        </label>
                        <label className={styles.healthField}>
                          <span>Temporary HP</span>
                          {healthInput('health.temporaryHitPoints', 'Temporary hit points')}
                        </label>
                        <label className={styles.healthField}>
                          <span>Hit Dice</span>
                          <span className={styles.hitDiceValues}>
                            {healthInput('health.currentHitDice', 'Current hit dice')}
                            <span aria-hidden>/</span>
                            {healthInput('health.maximumHitDice', 'Maximum hit dice')}
                            {healthInput('health.hitDie', 'Hit die', styles.hitDieInput, 'text')}
                          </span>
                        </label>
                        <div className={styles.deathSaves}>
                          <span>Death Saves</span>
                          <div className={styles.deathSaveTracks}>
                            {deathSaveTrack('health.deathSaveSuccesses', 'Success')}
                            {deathSaveTrack('health.deathSaveFailures', 'Failure')}
                          </div>
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
                        derived={derived.inventory}
                        inventory={draft.inventory}
                        onChange={changeInventory}
                        onCommit={commitInventory}
                        onSave={save}
                      />
                    </section>
                  </div>
                  <div className={styles.rightColumn}>
                    <section className={styles.collectionPanel}>
                      <h2>Resources</h2>
                      <CharacterResourcePanel
                        canEdit={canEdit}
                        resources={draft.resources}
                        onChange={changeResource}
                        onCommit={commitResource}
                        onSave={save}
                      />
                    </section>
                    <section className={styles.collectionPanel}>
                      <h2>Features</h2>
                      <CharacterFeaturePanel
                        canEdit={canEdit}
                        features={draft.features}
                        onChange={changeFeature}
                        onCommit={commitFeature}
                        onSave={save}
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
                  <section className={styles.settingsSection}>
                    <h2>Inventory</h2>
                    <Checkbox
                      checked={draft.inventory.variantEncumbrance}
                      disabled={!canEdit}
                      onChange={(event) => void commitInventory({
                        kind: 'set-variant-encumbrance',
                        value: event.currentTarget.checked,
                      })}
                    >
                      Use Variant Encumbrance
                    </Checkbox>
                    <p>
                      Shows Encumbered and Heavily Encumbered thresholds based on
                      Strength and Size. This does not change Speed or rolls.
                    </p>
                  </section>
                </div>
              ) : (
                <div
                  id={`character-${entry.id}-${activeTab}`}
                  aria-labelledby={`character-${entry.id}-${activeTab}-tab`}
                  className={styles.blankPanel}
                  role="tabpanel"
                />
              )}
            </main>
          </div>
        </div>
      </Modal>

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
