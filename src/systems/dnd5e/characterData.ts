import type { JsonValue } from '../../shared/gameSystems';
import { MAX_JOURNAL_ENTRIES } from '../../shared/journal';

export const MAX_DND5E_CHARACTER_FIELD_CODE_UNITS = 128;
export const MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS = 16_384;
export const MAX_DND5E_CHARACTER_ACTIONS = 128;
export const MAX_DND5E_ACTION_STEPS = 32;
export const MAX_DND5E_ACTION_TERMS = 32;
export const MAX_DND5E_ACTION_DICE_TIERS = 20;
export const MAX_DND5E_CHARACTER_FEATURES = 128;
export const MAX_DND5E_CHARACTER_CUSTOM_SKILLS = 128;
export const MAX_DND5E_CHARACTER_INVENTORY_ENTRIES = 256;
export const MAX_DND5E_CHARACTER_INVENTORY_DEPTH = 8;
export const MAX_DND5E_CHARACTER_RESOURCES = 128;
export const MAX_DND5E_CHARACTER_SPELLS = MAX_JOURNAL_ENTRIES;

export const DND5E_ABILITIES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

export const DND5E_5_5E_CLASSES = [
  'Artificer',
  'Barbarian',
  'Bard',
  'Cleric',
  'Druid',
  'Fighter',
  'Monk',
  'Paladin',
  'Ranger',
  'Rogue',
  'Sorcerer',
  'Warlock',
  'Wizard',
] as const;

export const DND5E_CHARACTER_LEVELS = Array.from(
  { length: 20 },
  (_, index) => String(index + 1),
);

export const DND5E_SPELL_SLOT_LEVELS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
] as const;

export type Dnd5eAbilityId = (typeof DND5E_ABILITIES)[number];
export type Dnd5eCharacterClass = (typeof DND5E_5_5E_CLASSES)[number];
export type Dnd5eRulesVersion = '5e' | '5.5e';
export type Dnd5eSpellSlotLevel = (typeof DND5E_SPELL_SLOT_LEVELS)[number];

export const DND5E_SPELL_PREPARATION_STATES = [
  'unprepared',
  'prepared',
  'always-prepared',
] as const;

export type Dnd5eSpellPreparation =
  (typeof DND5E_SPELL_PREPARATION_STATES)[number];

export type Dnd5eCharacterSpellReference = {
  entryId: string;
  preparation: Dnd5eSpellPreparation;
};

export type Dnd5eCharacterSpellMutation =
  | { kind: 'add'; spell: Dnd5eCharacterSpellReference }
  | { entryId: string; kind: 'remove' }
  | { kind: 'reorder'; orderedEntryIds: string[] }
  | {
      entryId: string;
      kind: 'set-preparation';
      preparation: Dnd5eSpellPreparation;
    };

export const DND5E_SKILLS = [
  { ability: 'dexterity', abbreviation: 'DEX', id: 'acrobatics', label: 'Acrobatics' },
  { ability: 'wisdom', abbreviation: 'WIS', id: 'animalHandling', label: 'Animal Handling' },
  { ability: 'intelligence', abbreviation: 'INT', id: 'arcana', label: 'Arcana' },
  { ability: 'strength', abbreviation: 'STR', id: 'athletics', label: 'Athletics' },
  { ability: 'charisma', abbreviation: 'CHA', id: 'deception', label: 'Deception' },
  { ability: 'intelligence', abbreviation: 'INT', id: 'history', label: 'History' },
  { ability: 'wisdom', abbreviation: 'WIS', id: 'insight', label: 'Insight' },
  { ability: 'charisma', abbreviation: 'CHA', id: 'intimidation', label: 'Intimidation' },
  { ability: 'intelligence', abbreviation: 'INT', id: 'investigation', label: 'Investigation' },
  { ability: 'wisdom', abbreviation: 'WIS', id: 'medicine', label: 'Medicine' },
  { ability: 'intelligence', abbreviation: 'INT', id: 'nature', label: 'Nature' },
  { ability: 'wisdom', abbreviation: 'WIS', id: 'perception', label: 'Perception' },
  { ability: 'charisma', abbreviation: 'CHA', id: 'performance', label: 'Performance' },
  { ability: 'charisma', abbreviation: 'CHA', id: 'persuasion', label: 'Persuasion' },
  { ability: 'intelligence', abbreviation: 'INT', id: 'religion', label: 'Religion' },
  { ability: 'dexterity', abbreviation: 'DEX', id: 'sleightOfHand', label: 'Sleight of Hand' },
  { ability: 'dexterity', abbreviation: 'DEX', id: 'stealth', label: 'Stealth' },
  { ability: 'wisdom', abbreviation: 'WIS', id: 'survival', label: 'Survival' },
] as const satisfies readonly {
  ability: Dnd5eAbilityId;
  abbreviation: string;
  id: string;
  label: string;
}[];

export const DND5E_SKILL_TRAINING_STATES = [
  'untrained',
  'proficient',
  'expertise',
] as const;

export type Dnd5eSkillId = (typeof DND5E_SKILLS)[number]['id'];
export type Dnd5eSkillTraining = (typeof DND5E_SKILL_TRAINING_STATES)[number];
export type Dnd5eCustomSkillAbility = Dnd5eAbilityId | 'none';

export const DND5E_CHARACTER_FEATURE_TYPES = [
  'unknown',
  'feature',
  'trait',
  'proficiency',
] as const;

export type Dnd5eCharacterFeatureType =
  (typeof DND5E_CHARACTER_FEATURE_TYPES)[number];

export type Dnd5eCharacterFeature = {
  description: string;
  id: string;
  name: string;
  source: string;
  sourceType: string;
  type: Dnd5eCharacterFeatureType;
};

export type Dnd5eCharacterFeatureMutation =
  | { feature: Dnd5eCharacterFeature; kind: 'add' }
  | {
      changes: Partial<Pick<
        Dnd5eCharacterFeature,
        'description' | 'name' | 'source' | 'sourceType' | 'type'
      >>;
      id: string;
      kind: 'update';
    }
  | { id: string; kind: 'delete' }
  | { direction: 'down' | 'up'; id: string; kind: 'move' }
  | { kind: 'reorder'; orderedIds: readonly string[] };

export type Dnd5eCharacterResource = {
  current: number;
  id: string;
  maximum: number;
  name: string;
};

export type Dnd5eCharacterResourceMutation =
  | { kind: 'add'; resource: Dnd5eCharacterResource }
  | { changes: Partial<Pick<Dnd5eCharacterResource, 'current' | 'maximum' | 'name'>>; id: string; kind: 'update' }
  | { id: string; kind: 'delete' }
  | { direction: 'down' | 'up'; id: string; kind: 'move' }
  | { kind: 'reorder'; orderedIds: readonly string[] };

export const DND5E_ACTION_STEP_PURPOSES = [
  'attack',
  'roll',
  'damage',
  'healing',
  'save',
] as const;

export type Dnd5eActionStepPurpose =
  (typeof DND5E_ACTION_STEP_PURPOSES)[number];

export const DND5E_DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
] as const;

export type Dnd5eDamageType = (typeof DND5E_DAMAGE_TYPES)[number];
export type Dnd5eProficiencyScale = 'half' | 'once' | 'twice';

export type Dnd5eActionDiceTier = {
  count: number;
  minimumLevel: number;
};

export type Dnd5eActionValueTerm =
  | {
      count: number;
      kind: 'dice';
      sides: number;
      tiers: Dnd5eActionDiceTier[];
    }
  | { ability: Dnd5eAbilityId; kind: 'ability' }
  | { kind: 'proficiency'; scale: Dnd5eProficiencyScale }
  | { kind: 'level' }
  | { kind: 'flat'; value: number };

type Dnd5eActionStepBase = {
  id: string;
  label: string;
};

export type Dnd5eActionAttackStep = Dnd5eActionStepBase & {
  purpose: 'attack';
  terms: Dnd5eActionValueTerm[];
};

export type Dnd5eActionRollStep = Dnd5eActionStepBase & {
  purpose: 'roll';
  terms: Dnd5eActionValueTerm[];
};

export type Dnd5eActionDamageStep = Dnd5eActionStepBase & {
  criticalSourceStepId: string | null;
  damageType: Dnd5eDamageType | string | null;
  purpose: 'damage';
  terms: Dnd5eActionValueTerm[];
};

export type Dnd5eActionHealingStep = Dnd5eActionStepBase & {
  purpose: 'healing';
  terms: Dnd5eActionValueTerm[];
};

export type Dnd5eActionSaveStep = Dnd5eActionStepBase & {
  ability: Dnd5eAbilityId;
  dcTerms: Exclude<Dnd5eActionValueTerm, { kind: 'dice' }>[];
  failure: string;
  purpose: 'save';
  success: string;
};

export type Dnd5eActionStep =
  | Dnd5eActionAttackStep
  | Dnd5eActionRollStep
  | Dnd5eActionDamageStep
  | Dnd5eActionHealingStep
  | Dnd5eActionSaveStep;

export type Dnd5eCharacterAction = {
  activation: string;
  description: string;
  duration: string;
  id: string;
  name: string;
  range: string;
  steps: Dnd5eActionStep[];
  target: string;
};

export type Dnd5eCharacterActionMutation =
  | { action: Dnd5eCharacterAction; kind: 'add' }
  | {
      changes: Partial<Omit<Dnd5eCharacterAction, 'id'>>;
      id: string;
      kind: 'update';
    }
  | { id: string; kind: 'delete' }
  | { direction: 'down' | 'up'; id: string; kind: 'move' }
  | { kind: 'reorder'; orderedIds: readonly string[] };

export function createDefaultDnd5eActionStep(
  purpose: Dnd5eActionStepPurpose = 'roll',
  id: string = crypto.randomUUID(),
): Dnd5eActionStep {
  const base = {
    id,
    label: purpose === 'roll'
      ? 'Roll'
      : purpose === 'save'
        ? 'Save'
        : `${purpose[0].toUpperCase()}${purpose.slice(1)}`,
  };
  if (purpose === 'attack') {
    return {
      ...base,
      purpose,
      terms: [
        { ability: 'strength', kind: 'ability' },
        { kind: 'proficiency', scale: 'once' },
      ],
    };
  }
  if (purpose === 'roll') {
    return {
      ...base,
      purpose,
      terms: [{ count: 1, kind: 'dice', sides: 20, tiers: [] }],
    };
  }
  if (purpose === 'damage') {
    return {
      ...base,
      criticalSourceStepId: null,
      damageType: null,
      purpose,
      terms: [{ count: 1, kind: 'dice', sides: 6, tiers: [] }],
    };
  }
  if (purpose === 'healing') {
    return {
      ...base,
      purpose,
      terms: [{ count: 1, kind: 'dice', sides: 6, tiers: [] }],
    };
  }
  return {
    ...base,
    ability: 'dexterity',
    dcTerms: [{ kind: 'flat', value: 10 }],
    failure: '',
    purpose,
    success: '',
  };
}

export function createDefaultDnd5eCharacterAction(
  id = crypto.randomUUID(),
): Dnd5eCharacterAction {
  return {
    activation: '',
    description: '',
    duration: '',
    id,
    name: 'New Action',
    range: '',
    steps: [],
    target: '',
  };
}

export const DND5E_INVENTORY_CONTENTS_WEIGHT = [
  'normal',
  'weightless',
] as const;

export type Dnd5eInventoryContentsWeight =
  (typeof DND5E_INVENTORY_CONTENTS_WEIGHT)[number];
export type Dnd5eCurrencyDenomination =
  | 'copper'
  | 'gold'
  | 'platinum'
  | 'silver';

type Dnd5eCharacterInventoryEntryBase = {
  equipped: boolean;
  id: string;
  name: string;
  weight: number;
};

export type Dnd5eCharacterInventoryItem =
  Dnd5eCharacterInventoryEntryBase & {
  kind: 'item';
  quantity: number;
};

export type Dnd5eCharacterInventoryContainer =
  Dnd5eCharacterInventoryEntryBase & {
  capacity: number | null;
  collapsed: boolean;
  contents: Dnd5eCharacterInventoryEntry[];
  contentsWeight: Dnd5eInventoryContentsWeight;
  kind: 'container';
};

export type Dnd5eCharacterInventoryEntry =
  | Dnd5eCharacterInventoryContainer
  | Dnd5eCharacterInventoryItem;

export type Dnd5eCharacterInventory = {
  currency: Record<Dnd5eCurrencyDenomination, number>;
  entries: Dnd5eCharacterInventoryEntry[];
  variantEncumbrance: boolean;
};

export type Dnd5eCharacterInventoryEntryChanges = Partial<Pick<
  Dnd5eCharacterInventoryEntryBase,
  'equipped' | 'name' | 'weight'
>> & Partial<Pick<
  Dnd5eCharacterInventoryContainer,
  'capacity' | 'collapsed' | 'contentsWeight'
>> & Partial<Pick<
  Dnd5eCharacterInventoryItem,
  'quantity'
>>;

export type Dnd5eCharacterInventoryMutation =
  | {
      entry: Dnd5eCharacterInventoryEntry;
      kind: 'add';
      parentId: string | null;
    }
  | { id: string; kind: 'delete' }
  | {
      changes: Dnd5eCharacterInventoryEntryChanges;
      id: string;
      kind: 'update';
    }
  | { direction: 'down' | 'up'; id: string; kind: 'move' }
  | {
      beforeId: string | null;
      id: string;
      kind: 'place';
      parentId: string | null;
    }
  | {
      denomination: Dnd5eCurrencyDenomination;
      kind: 'set-currency';
      value: number;
    }
  | { kind: 'set-variant-encumbrance'; value: boolean };

export interface Dnd5eSkillValues {
  bonus: number;
  passive: number;
}

export type Dnd5eCharacterSkill = {
  bonusOffset: number;
  passiveOffset: number;
  training: Dnd5eSkillTraining;
};

export type Dnd5eCharacterCustomSkill = Dnd5eCharacterSkill & {
  ability: Dnd5eCustomSkillAbility;
  id: string;
  name: string;
};

export type Dnd5eCharacterCustomSkillMutation =
  | { kind: 'add'; skill: Dnd5eCharacterCustomSkill }
  | {
      changes: Partial<Pick<
        Dnd5eCharacterCustomSkill,
        'ability' | 'bonusOffset' | 'name' | 'passiveOffset' | 'training'
      >>;
      id: string;
      kind: 'update';
    }
  | { id: string; kind: 'delete' }
  | { direction: 'down' | 'up'; id: string; kind: 'move' }
  | { kind: 'reorder'; orderedIds: readonly string[] };

export interface Dnd5eDerivedAbilityValues {
  modifier: number;
  savingThrow: number;
}

export interface Dnd5eDerivedCharacterValues {
  abilities: Record<Dnd5eAbilityId, Dnd5eDerivedAbilityValues>;
  concentrationSave: number;
  customSkills: Record<string, Dnd5eSkillValues>;
  initiative: number;
  inventory: Dnd5eDerivedInventoryValues;
  proficiencyBonus: number;
  skills: Record<Dnd5eSkillId, Dnd5eSkillValues>;
  spellcasting: {
    attackBonus: number | null;
    preparedMaximum: number;
    preparedMaximumBase: number;
    saveDc: number | null;
    slots: Record<Dnd5eSpellSlotLevel, {
      baseTotal: number;
      total: number;
    }>;
  };
}

export type Dnd5eInventoryStatus =
  | 'encumbered'
  | 'heavily-encumbered'
  | 'normal'
  | 'over-capacity';

export interface Dnd5eDerivedContainerValues {
  capacityHundredths: number | null;
  overCapacity: boolean;
  usedWeightHundredths: number;
}

export interface Dnd5eDerivedInventoryValues {
  carryingCapacityHundredths: number;
  containers: Record<string, Dnd5eDerivedContainerValues>;
  currentWeightHundredths: number;
  encumberedAtHundredths: number | null;
  heavilyEncumberedAtHundredths: number | null;
  status: Dnd5eInventoryStatus;
}

export type Dnd5eCharacterData = {
  actions: Dnd5eCharacterAction[];
  abilities: Record<Dnd5eAbilityId, {
    modifierOffset: number;
    savingThrowOffset: number;
    score: number;
  }>;
  appearance: {
    age: string;
    eyes: string;
    hair: string;
    height: string;
    size: string;
    skin: string;
    weight: string;
  };
  customSkills: Dnd5eCharacterCustomSkill[];
  health: {
    currentHitDice: string;
    currentHitPoints: string;
    hitDie: string;
    maximumHitDice: string;
    maximumHitPoints: string;
    temporaryHitPoints: string;
  };
  identity: {
    ancestry: string;
    className: string;
    creatureType: string;
    experience: string;
    level: number | null;
    subAncestry: string;
    subclass: string;
  };
  importantStats: {
    armorClass: string;
    concentrationSaveOffset: number;
    currentSpeed: string;
    initiativeOffset: number;
    inspirationCount: string;
    proficiencyBonusOffset: number;
  };
  inventory: Dnd5eCharacterInventory;
  features: Dnd5eCharacterFeature[];
  resources: Dnd5eCharacterResource[];
  skills: Record<Dnd5eSkillId, Dnd5eCharacterSkill>;
  spellcasting: {
    ability: Dnd5eAbilityId | null;
    attackBonusOffset: number;
    preparedMaximumOffset: number;
    saveDcOffset: number;
    slots: Record<Dnd5eSpellSlotLevel, {
      current: number;
      totalOffset: number;
    }>;
    spells: Dnd5eCharacterSpellReference[];
  };
};

const ABILITY_KEYS = [
  'modifierOffset',
  'savingThrowOffset',
  'score',
] as const;
const ACTION_KEYS = [
  'activation',
  'description',
  'duration',
  'id',
  'name',
  'range',
  'steps',
  'target',
] as const;
const ACTION_STEP_BASE_KEYS = ['id', 'label', 'purpose'] as const;
const ACTION_TERM_KEYS = {
  ability: ['ability', 'kind'],
  dice: ['count', 'kind', 'sides', 'tiers'],
  flat: ['kind', 'value'],
  level: ['kind'],
  proficiency: ['kind', 'scale'],
} as const;
const APPEARANCE_KEYS = [
  'age',
  'eyes',
  'hair',
  'height',
  'size',
  'skin',
  'weight',
] as const;
const IDENTITY_STRING_KEYS = [
  'ancestry',
  'className',
  'creatureType',
  'experience',
  'subAncestry',
  'subclass',
] as const;
const IDENTITY_KEYS = [...IDENTITY_STRING_KEYS, 'level'] as const;
const HEALTH_KEYS = [
  'currentHitDice',
  'currentHitPoints',
  'hitDie',
  'maximumHitDice',
  'maximumHitPoints',
  'temporaryHitPoints',
] as const;
const IMPORTANT_STAT_KEYS = [
  'armorClass',
  'concentrationSaveOffset',
  'currentSpeed',
  'initiativeOffset',
  'inspirationCount',
  'proficiencyBonusOffset',
] as const;
const SKILL_KEYS = ['bonusOffset', 'passiveOffset', 'training'] as const;
const CUSTOM_SKILL_KEYS = [
  'ability',
  'bonusOffset',
  'id',
  'name',
  'passiveOffset',
  'training',
] as const;
const FEATURE_KEYS = [
  'description',
  'id',
  'name',
  'source',
  'sourceType',
  'type',
] as const;
const INVENTORY_KEYS = ['currency', 'entries', 'variantEncumbrance'] as const;
const INVENTORY_CURRENCY_KEYS = [
  'copper',
  'gold',
  'platinum',
  'silver',
] as const satisfies readonly Dnd5eCurrencyDenomination[];
const INVENTORY_ITEM_KEYS = [
  'equipped',
  'id',
  'kind',
  'name',
  'quantity',
  'weight',
] as const;
const INVENTORY_CONTAINER_KEYS = [
  'capacity',
  'collapsed',
  'contents',
  'contentsWeight',
  'equipped',
  'id',
  'kind',
  'name',
  'weight',
] as const;
const RESOURCE_KEYS = ['current', 'id', 'maximum', 'name'] as const;
const SPELLCASTING_KEYS = [
  'ability',
  'attackBonusOffset',
  'preparedMaximumOffset',
  'saveDcOffset',
  'slots',
  'spells',
] as const;
const SPELL_SLOT_KEYS = ['current', 'totalOffset'] as const;
const SPELL_REFERENCE_KEYS = ['entryId', 'preparation'] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const CLASS_SAVE_PROFICIENCIES = {
  Artificer: ['constitution', 'intelligence'],
  Barbarian: ['strength', 'constitution'],
  Bard: ['dexterity', 'charisma'],
  Cleric: ['wisdom', 'charisma'],
  Druid: ['intelligence', 'wisdom'],
  Fighter: ['strength', 'constitution'],
  Monk: ['strength', 'dexterity'],
  Paladin: ['wisdom', 'charisma'],
  Ranger: ['strength', 'dexterity'],
  Rogue: ['dexterity', 'intelligence'],
  Sorcerer: ['constitution', 'charisma'],
  Warlock: ['wisdom', 'charisma'],
  Wizard: ['intelligence', 'wisdom'],
} as const satisfies Record<Dnd5eCharacterClass, readonly Dnd5eAbilityId[]>;

const RULE_SAVE_PROFICIENCIES = {
  '5e': CLASS_SAVE_PROFICIENCIES,
  '5.5e': CLASS_SAVE_PROFICIENCIES,
} as const satisfies Record<
  Dnd5eRulesVersion,
  Record<Dnd5eCharacterClass, readonly Dnd5eAbilityId[]>
>;

const DEFAULT_SPELLCASTING_ABILITIES = {
  Artificer: 'intelligence',
  Barbarian: null,
  Bard: 'charisma',
  Cleric: 'wisdom',
  Druid: 'wisdom',
  Fighter: null,
  Monk: null,
  Paladin: 'charisma',
  Ranger: 'wisdom',
  Rogue: null,
  Sorcerer: 'charisma',
  Warlock: 'charisma',
  Wizard: 'intelligence',
} as const satisfies Record<Dnd5eCharacterClass, Dnd5eAbilityId | null>;

const PREPARED_SPELL_TABLE_5_5E = {
  Bard: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22],
  Cleric: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22],
  Druid: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22],
  Paladin: [2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15],
  Ranger: [2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15],
  Sorcerer: [2, 4, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22],
  Warlock: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
  Wizard: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 18, 19, 21, 22, 23, 24, 25],
} as const satisfies Partial<Record<Dnd5eCharacterClass, readonly number[]>>;

const SPELLS_KNOWN_TABLE_5E = {
  Bard: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
  Ranger: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
  Sorcerer: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
  Warlock: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
} as const satisfies Partial<Record<Dnd5eCharacterClass, readonly number[]>>;

const FULL_CASTER_SPELL_SLOTS = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
] as const;

const HALF_CASTER_SPELL_SLOTS_5E = [
  [],
  [2],
  [3],
  [3],
  [4, 2],
  [4, 2],
  [4, 3],
  [4, 3],
  [4, 3, 2],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2],
] as const;

const STARTING_HALF_CASTER_SPELL_SLOTS = [
  [2],
  ...HALF_CASTER_SPELL_SLOTS_5E.slice(1),
] as const;

const PACT_MAGIC_SPELL_SLOTS = [
  { count: 1, level: 1 },
  { count: 2, level: 1 },
  { count: 2, level: 2 },
  { count: 2, level: 2 },
  { count: 2, level: 3 },
  { count: 2, level: 3 },
  { count: 2, level: 4 },
  { count: 2, level: 4 },
  { count: 2, level: 5 },
  { count: 2, level: 5 },
  { count: 3, level: 5 },
  { count: 3, level: 5 },
  { count: 3, level: 5 },
  { count: 3, level: 5 },
  { count: 3, level: 5 },
  { count: 3, level: 5 },
  { count: 4, level: 5 },
  { count: 4, level: 5 },
  { count: 4, level: 5 },
  { count: 4, level: 5 },
] as const;

const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function safeBigIntToNumber(value: bigint): number | null {
  return value >= MIN_SAFE_BIGINT && value <= MAX_SAFE_BIGINT
    ? Number(value)
    : null;
}

function safeAdd(...values: number[]): number | null {
  if (!values.every(Number.isSafeInteger)) return null;
  return safeBigIntToNumber(values.reduce((total, value) => total + BigInt(value), 0n));
}

function safeMultiply(left: number, right: number): number | null {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) return null;
  return safeBigIntToNumber(BigInt(left) * BigInt(right));
}

function abilityModifierBase(score: number): number | null {
  if (!Number.isSafeInteger(score)) return null;
  const difference = BigInt(score) - 10n;
  let quotient = difference / 2n;
  if (difference < 0n && difference % 2n !== 0n) quotient -= 1n;
  return safeBigIntToNumber(quotient);
}

function defaultSkills(): Dnd5eCharacterData['skills'] {
  return Object.fromEntries(
    DND5E_SKILLS.map(({ id }) => [id, {
      bonusOffset: 0,
      passiveOffset: 0,
      training: 'untrained',
    }]),
  ) as Dnd5eCharacterData['skills'];
}

function defaultSpellSlots(): Dnd5eCharacterData['spellcasting']['slots'] {
  return Object.fromEntries(
    DND5E_SPELL_SLOT_LEVELS.map((level) => [level, {
      current: 0,
      totalOffset: 0,
    }]),
  ) as Dnd5eCharacterData['spellcasting']['slots'];
}

function defaultHealth(): Dnd5eCharacterData['health'] {
  return {
    currentHitDice: '1',
    currentHitPoints: '1',
    hitDie: 'd8',
    maximumHitDice: '1',
    maximumHitPoints: '1',
    temporaryHitPoints: '0',
  };
}

function blankAbility(): Dnd5eCharacterData['abilities'][Dnd5eAbilityId] {
  return {
    modifierOffset: 0,
    savingThrowOffset: 0,
    score: 10,
  };
}

export function defaultDnd5eSpellcastingAbilityForClass(
  className: string,
): Dnd5eAbilityId | null {
  return DND5E_5_5E_CLASSES.includes(className as Dnd5eCharacterClass)
    ? DEFAULT_SPELLCASTING_ABILITIES[className as Dnd5eCharacterClass]
    : null;
}

export function createDefaultDnd5eCharacterSpellcasting(
  className = '',
): Dnd5eCharacterData['spellcasting'] {
  return {
    ability: defaultDnd5eSpellcastingAbilityForClass(className),
    attackBonusOffset: 0,
    preparedMaximumOffset: 0,
    saveDcOffset: 0,
    slots: defaultSpellSlots(),
    spells: [],
  };
}

export function createDefaultDnd5eCharacterInventory(): Dnd5eCharacterInventory {
  return {
    currency: {
      copper: 0,
      gold: 0,
      platinum: 0,
      silver: 0,
    },
    entries: [],
    variantEncumbrance: false,
  };
}

export function createDefaultDnd5eCharacterData(): Dnd5eCharacterData {
  return {
    actions: [],
    abilities: {
      charisma: blankAbility(),
      constitution: blankAbility(),
      dexterity: blankAbility(),
      intelligence: blankAbility(),
      strength: blankAbility(),
      wisdom: blankAbility(),
    },
    appearance: {
      age: '',
      eyes: '',
      hair: '',
      height: '',
      size: '',
      skin: '',
      weight: '',
    },
    customSkills: [],
    health: defaultHealth(),
    identity: {
      ancestry: '',
      className: '',
      creatureType: '',
      experience: '',
      level: null,
      subAncestry: '',
      subclass: '',
    },
    importantStats: {
      armorClass: '10',
      concentrationSaveOffset: 0,
      currentSpeed: '30',
      initiativeOffset: 0,
      inspirationCount: '0',
      proficiencyBonusOffset: 0,
    },
    inventory: createDefaultDnd5eCharacterInventory(),
    features: [],
    resources: [],
    skills: defaultSkills(),
    spellcasting: createDefaultDnd5eCharacterSpellcasting(),
  };
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: { [key: string]: JsonValue }, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]);
}

function isBoundedString(value: JsonValue | undefined): value is string {
  return typeof value === 'string' &&
    value.length <= MAX_DND5E_CHARACTER_FIELD_CODE_UNITS;
}

function isBoundedDescription(value: JsonValue | undefined): value is string {
  return typeof value === 'string' &&
    value.length <= MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS;
}

function isDnd5eActionTerm(
  value: JsonValue,
  allowDice = true,
): value is Dnd5eActionValueTerm {
  if (
    !isRecord(value) ||
    typeof value.kind !== 'string' ||
    !Object.hasOwn(ACTION_TERM_KEYS, value.kind)
  ) {
    return false;
  }
  const kind = value.kind as keyof typeof ACTION_TERM_KEYS;
  if (!hasExactKeys(value, ACTION_TERM_KEYS[kind])) return false;
  if (kind === 'ability') {
    return typeof value.ability === 'string' &&
      DND5E_ABILITIES.includes(value.ability as Dnd5eAbilityId);
  }
  if (kind === 'proficiency') {
    return value.scale === 'half' ||
      value.scale === 'once' ||
      value.scale === 'twice';
  }
  if (kind === 'level') return true;
  if (kind === 'flat') return isSafeInteger(value.value);
  if (!allowDice || !Array.isArray(value.tiers)) return false;
  if (
    !isSafeInteger(value.count) ||
    value.count < 1 ||
    value.count > 1_000 ||
    !isSafeInteger(value.sides) ||
    value.sides < 2 ||
    value.tiers.length > MAX_DND5E_ACTION_DICE_TIERS
  ) {
    return false;
  }
  let previousLevel = 0;
  return value.tiers.every((tier) => {
    if (
      !isRecord(tier) ||
      !hasExactKeys(tier, ['count', 'minimumLevel']) ||
      !isSafeInteger(tier.count) ||
      tier.count < 1 ||
      tier.count > 1_000 ||
      !isSafeInteger(tier.minimumLevel) ||
      tier.minimumLevel < 1 ||
      tier.minimumLevel > 20 ||
      tier.minimumLevel <= previousLevel
    ) {
      return false;
    }
    previousLevel = tier.minimumLevel;
    return true;
  });
}

function isDnd5eActionStep(value: JsonValue): value is Dnd5eActionStep {
  if (
    !isRecord(value) ||
    typeof value.purpose !== 'string' ||
    !DND5E_ACTION_STEP_PURPOSES.includes(
      value.purpose as Dnd5eActionStepPurpose,
    )
  ) {
    return false;
  }
  const purpose = value.purpose as Dnd5eActionStepPurpose;
  const extraKeys = purpose === 'damage'
    ? ['criticalSourceStepId', 'damageType', 'terms']
    : purpose === 'save'
      ? ['ability', 'dcTerms', 'failure', 'success']
      : ['terms'];
  if (
    !hasExactKeys(value, [...ACTION_STEP_BASE_KEYS, ...extraKeys]) ||
    typeof value.id !== 'string' ||
    !UUID_PATTERN.test(value.id) ||
    !isBoundedString(value.label)
  ) {
    return false;
  }
  if (purpose === 'save') {
    return typeof value.ability === 'string' &&
      DND5E_ABILITIES.includes(value.ability as Dnd5eAbilityId) &&
      Array.isArray(value.dcTerms) &&
      value.dcTerms.length <= MAX_DND5E_ACTION_TERMS &&
      value.dcTerms.every((term) => isDnd5eActionTerm(term, false)) &&
      isBoundedDescription(value.failure) &&
      isBoundedDescription(value.success);
  }
  if (
    !Array.isArray(value.terms) ||
    value.terms.length > MAX_DND5E_ACTION_TERMS ||
    !value.terms.every((term) => isDnd5eActionTerm(term))
  ) {
    return false;
  }
  if (purpose !== 'damage') return true;
  return (
    (value.criticalSourceStepId === null ||
      (typeof value.criticalSourceStepId === 'string' &&
        UUID_PATTERN.test(value.criticalSourceStepId))) &&
    (value.damageType === null || isBoundedString(value.damageType))
  );
}

function isDnd5eCharacterActions(
  value: JsonValue,
): value is Dnd5eCharacterAction[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_DND5E_CHARACTER_ACTIONS
  ) {
    return false;
  }
  const actionIds = new Set<string>();
  const stepIds = new Set<string>();
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ACTION_KEYS) ||
      typeof candidate.id !== 'string' ||
      !UUID_PATTERN.test(candidate.id) ||
      actionIds.has(candidate.id) ||
      !isBoundedString(candidate.name) ||
      !isBoundedString(candidate.activation) ||
      !isBoundedString(candidate.duration) ||
      !isBoundedString(candidate.range) ||
      !isBoundedString(candidate.target) ||
      !isBoundedDescription(candidate.description) ||
      !Array.isArray(candidate.steps) ||
      candidate.steps.length > MAX_DND5E_ACTION_STEPS ||
      !candidate.steps.every(isDnd5eActionStep)
    ) {
      return false;
    }
    actionIds.add(candidate.id);
    const attacks = new Set<string>();
    for (const step of candidate.steps as Dnd5eActionStep[]) {
      if (stepIds.has(step.id)) return false;
      stepIds.add(step.id);
      if (step.purpose === 'attack') attacks.add(step.id);
    }
    if ((candidate.steps as Dnd5eActionStep[]).some(
      (step) => step.purpose === 'damage' &&
        step.criticalSourceStepId !== null &&
        !attacks.has(step.criticalSourceStepId),
    )) {
      return false;
    }
  }
  return true;
}

function hasExactStringFields(
  value: JsonValue,
  keys: readonly string[],
): value is { [key: string]: string } {
  return isRecord(value) &&
    hasExactKeys(value, keys) &&
    keys.every((key) => isBoundedString(value[key]));
}

function hasExactSkillFields(
  value: JsonValue,
): value is Record<Dnd5eSkillId, Dnd5eCharacterSkill> {
  if (!isRecord(value)) return false;
  const expectedKeys = DND5E_SKILLS.map(({ id }) => id);
  return hasExactKeys(value, expectedKeys) &&
    expectedKeys.every((key) => {
      const skill = value[key];
      return isRecord(skill) &&
        hasExactKeys(skill, SKILL_KEYS) &&
        isSafeInteger(skill.bonusOffset) &&
        isSafeInteger(skill.passiveOffset) &&
        typeof skill.training === 'string' &&
        DND5E_SKILL_TRAINING_STATES.includes(
          skill.training as Dnd5eSkillTraining,
        );
    });
}

function hasExactSpellSlotFields(
  value: JsonValue,
): value is Dnd5eCharacterData['spellcasting']['slots'] {
  if (!isRecord(value) || !hasExactKeys(value, DND5E_SPELL_SLOT_LEVELS)) {
    return false;
  }
  return DND5E_SPELL_SLOT_LEVELS.every((level) => {
    const slot = value[level];
    return isRecord(slot) &&
      hasExactKeys(slot, SPELL_SLOT_KEYS) &&
      isNonnegativeSafeInteger(slot.current) &&
      isSafeInteger(slot.totalOffset);
  });
}

function hasExactCharacterSpellReferences(
  value: JsonValue,
): value is Dnd5eCharacterSpellReference[] {
  if (!Array.isArray(value) || value.length > MAX_DND5E_CHARACTER_SPELLS) {
    return false;
  }
  const ids = new Set<string>();
  for (const spell of value) {
    if (
      !isRecord(spell) ||
      !hasExactKeys(spell, SPELL_REFERENCE_KEYS) ||
      typeof spell.entryId !== 'string' ||
      !UUID_PATTERN.test(spell.entryId) ||
      ids.has(spell.entryId) ||
      typeof spell.preparation !== 'string' ||
      !DND5E_SPELL_PREPARATION_STATES.includes(
        spell.preparation as Dnd5eSpellPreparation,
      )
    ) {
      return false;
    }
    ids.add(spell.entryId);
  }
  return true;
}

function hasExactHealthFields(
  value: JsonValue,
): value is Dnd5eCharacterData['health'] {
  return hasExactStringFields(value, HEALTH_KEYS);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0;
}

function weightInHundredths(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  const hundredths = Math.round(value * 100);
  return Number.isSafeInteger(hundredths) && hundredths / 100 === value
    ? hundredths
    : null;
}

function isDnd5eCharacterInventory(
  value: JsonValue,
): value is Dnd5eCharacterInventory {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, INVENTORY_KEYS) ||
    !Array.isArray(value.entries) ||
    typeof value.variantEncumbrance !== 'boolean'
  ) {
    return false;
  }
  const currency = value.currency;
  if (
    !isRecord(currency) ||
    !hasExactKeys(currency, INVENTORY_CURRENCY_KEYS) ||
    !INVENTORY_CURRENCY_KEYS.every((key) =>
      isNonnegativeSafeInteger(currency[key]),
    )
  ) {
    return false;
  }

  const ids = new Set<string>();
  let total = 0;
  const validateEntries = (
    entries: JsonValue[],
    depth: number,
  ): boolean => entries.every((candidate) => {
    if (
      depth > MAX_DND5E_CHARACTER_INVENTORY_DEPTH ||
      !isRecord(candidate) ||
      ++total > MAX_DND5E_CHARACTER_INVENTORY_ENTRIES ||
      typeof candidate.kind !== 'string' ||
      (candidate.kind !== 'item' && candidate.kind !== 'container') ||
      !hasExactKeys(
        candidate,
        candidate.kind === 'item'
          ? INVENTORY_ITEM_KEYS
          : INVENTORY_CONTAINER_KEYS,
      ) ||
      typeof candidate.id !== 'string' ||
      !UUID_PATTERN.test(candidate.id) ||
      ids.has(candidate.id) ||
      !isBoundedString(candidate.name) ||
      weightInHundredths(candidate.weight) === null ||
      typeof candidate.equipped !== 'boolean' ||
      (depth > 1 && !candidate.equipped)
    ) {
      return false;
    }
    ids.add(candidate.id);
    if (candidate.kind === 'item') {
      return isNonnegativeSafeInteger(candidate.quantity);
    }
    return (
      (candidate.capacity === null ||
        isNonnegativeSafeInteger(candidate.capacity)) &&
      typeof candidate.collapsed === 'boolean' &&
      typeof candidate.contentsWeight === 'string' &&
      DND5E_INVENTORY_CONTENTS_WEIGHT.includes(
        candidate.contentsWeight as Dnd5eInventoryContentsWeight,
      ) &&
      Array.isArray(candidate.contents) &&
      validateEntries(candidate.contents, depth + 1)
    );
  });

  return validateEntries(value.entries, 1);
}

export function isDnd5eCharacterData(
  value: JsonValue,
): value is Dnd5eCharacterData {
  if (!isRecord(value) || !hasExactKeys(value, [
    'actions',
    'abilities',
    'appearance',
    'customSkills',
    'features',
    'health',
    'identity',
    'importantStats',
    'inventory',
    'resources',
    'skills',
    'spellcasting',
  ])) {
    return false;
  }
  const abilities = value.abilities;
  const identity = value.identity;
  if (
    !isRecord(abilities) ||
    !hasExactKeys(abilities, DND5E_ABILITIES) ||
    !DND5E_ABILITIES.every((ability) => {
      const candidate = abilities[ability];
      return isRecord(candidate) &&
        hasExactKeys(candidate, ABILITY_KEYS) &&
        isSafeInteger(candidate.score) &&
        isSafeInteger(candidate.modifierOffset) &&
        isSafeInteger(candidate.savingThrowOffset);
    }) ||
    !hasExactStringFields(value.appearance, APPEARANCE_KEYS) ||
    !hasExactHealthFields(value.health) ||
    !isRecord(identity) ||
    !hasExactKeys(identity, IDENTITY_KEYS) ||
    !IDENTITY_STRING_KEYS.every((key) => isBoundedString(identity[key])) ||
    !(identity.level === null || isSafeInteger(identity.level)) ||
    !isRecord(value.importantStats) ||
    !hasExactKeys(value.importantStats, IMPORTANT_STAT_KEYS) ||
    !isBoundedString(value.importantStats.armorClass) ||
    !isBoundedString(value.importantStats.currentSpeed) ||
    !isBoundedString(value.importantStats.inspirationCount) ||
    !isSafeInteger(value.importantStats.concentrationSaveOffset) ||
    !isSafeInteger(value.importantStats.initiativeOffset) ||
    !isSafeInteger(value.importantStats.proficiencyBonusOffset) ||
    !isDnd5eCharacterInventory(value.inventory) ||
    !isDnd5eCharacterActions(value.actions) ||
    !Array.isArray(value.customSkills) ||
    value.customSkills.length > MAX_DND5E_CHARACTER_CUSTOM_SKILLS ||
    !value.customSkills.every((skill) =>
      isRecord(skill) &&
      hasExactKeys(skill, CUSTOM_SKILL_KEYS) &&
      typeof skill.id === 'string' &&
      UUID_PATTERN.test(skill.id) &&
      isBoundedString(skill.name) &&
      typeof skill.ability === 'string' &&
      (skill.ability === 'none' || DND5E_ABILITIES.includes(
        skill.ability as Dnd5eAbilityId,
      )) &&
      isSafeInteger(skill.bonusOffset) &&
      isSafeInteger(skill.passiveOffset) &&
      typeof skill.training === 'string' &&
      DND5E_SKILL_TRAINING_STATES.includes(
        skill.training as Dnd5eSkillTraining,
      ),
    ) ||
    new Set(value.customSkills.map((skill) =>
      isRecord(skill) && typeof skill.id === 'string' ? skill.id : '',
    )).size !== value.customSkills.length ||
    !Array.isArray(value.features) ||
    value.features.length > MAX_DND5E_CHARACTER_FEATURES ||
    !value.features.every((feature) =>
      isRecord(feature) &&
      hasExactKeys(feature, FEATURE_KEYS) &&
      typeof feature.id === 'string' &&
      UUID_PATTERN.test(feature.id) &&
      typeof feature.type === 'string' &&
      DND5E_CHARACTER_FEATURE_TYPES.includes(
        feature.type as Dnd5eCharacterFeatureType,
      ) &&
      isBoundedString(feature.name) &&
      isBoundedString(feature.source) &&
      isBoundedString(feature.sourceType) &&
      typeof feature.description === 'string' &&
      feature.description.length <= MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS,
    ) ||
    new Set(value.features.map((feature) =>
      isRecord(feature) && typeof feature.id === 'string' ? feature.id : '',
    )).size !== value.features.length ||
    !Array.isArray(value.resources) ||
    value.resources.length > MAX_DND5E_CHARACTER_RESOURCES ||
    !value.resources.every((resource) =>
      isRecord(resource) &&
      hasExactKeys(resource, RESOURCE_KEYS) &&
      typeof resource.id === 'string' &&
      UUID_PATTERN.test(resource.id) &&
      isBoundedString(resource.name) &&
      isSafeInteger(resource.current) &&
      isSafeInteger(resource.maximum),
    ) ||
    new Set(value.resources.map((resource) =>
      isRecord(resource) && typeof resource.id === 'string' ? resource.id : '',
    )).size !== value.resources.length ||
    !hasExactSkillFields(value.skills) ||
    !isRecord(value.spellcasting) ||
    !hasExactKeys(value.spellcasting, SPELLCASTING_KEYS) ||
    !(
      value.spellcasting.ability === null ||
      (
        typeof value.spellcasting.ability === 'string' &&
        DND5E_ABILITIES.includes(value.spellcasting.ability as Dnd5eAbilityId)
      )
    ) ||
    !isSafeInteger(value.spellcasting.attackBonusOffset) ||
    !isSafeInteger(value.spellcasting.preparedMaximumOffset) ||
    !isSafeInteger(value.spellcasting.saveDcOffset) ||
    !hasExactSpellSlotFields(value.spellcasting.slots) ||
    !hasExactCharacterSpellReferences(value.spellcasting.spells)
  ) {
    return false;
  }
  return deriveDnd5eCharacterValues(
    value as unknown as Dnd5eCharacterData,
    '5.5e',
  ) !== null;
}

function repairDnd5eActionLinks(
  action: Dnd5eCharacterAction,
): Dnd5eCharacterAction {
  const attackIds = new Set(
    action.steps
      .filter((step) => step.purpose === 'attack')
      .map(({ id }) => id),
  );
  return {
    ...action,
    steps: action.steps.map((step) =>
      step.purpose === 'damage' &&
      step.criticalSourceStepId !== null &&
      !attackIds.has(step.criticalSourceStepId)
        ? { ...step, criticalSourceStepId: null }
        : step),
  };
}

export function applyDnd5eCharacterActionMutations(
  actions: readonly Dnd5eCharacterAction[],
  mutations: readonly Dnd5eCharacterActionMutation[],
): { actions: Dnd5eCharacterAction[]; missingIds: string[] } {
  let next = structuredClone(actions) as Dnd5eCharacterAction[];
  const missingIds = new Set<string>();
  for (const mutation of mutations) {
    if (mutation.kind === 'add') {
      if (!next.some(({ id }) => id === mutation.action.id)) {
        next.push(repairDnd5eActionLinks(structuredClone(mutation.action)));
      }
      continue;
    }
    if (mutation.kind === 'delete') {
      next = next.filter(({ id }) => id !== mutation.id);
      continue;
    }
    if (mutation.kind === 'update') {
      const index = next.findIndex(({ id }) => id === mutation.id);
      if (index < 0) {
        missingIds.add(mutation.id);
      } else {
        next[index] = repairDnd5eActionLinks({
          ...next[index],
          ...structuredClone(mutation.changes),
        });
      }
      continue;
    }
    if (mutation.kind === 'move') {
      const index = next.findIndex(({ id }) => id === mutation.id);
      if (index < 0) {
        missingIds.add(mutation.id);
        continue;
      }
      const target = index + (mutation.direction === 'down' ? 1 : -1);
      if (target < 0 || target >= next.length) continue;
      [next[index], next[target]] = [next[target], next[index]];
      continue;
    }
    const desired = mutation.orderedIds.filter((id, index, ids) =>
      ids.indexOf(id) === index && next.some((action) => action.id === id),
    );
    const desiredSet = new Set(desired);
    let desiredIndex = 0;
    next = next.map((action) => {
      if (!desiredSet.has(action.id)) return action;
      const desiredId = desired[desiredIndex++];
      return next.find(({ id }) => id === desiredId)!;
    });
  }
  return { actions: next, missingIds: [...missingIds] };
}

export function applyDnd5eCharacterSpellMutations(
  spells: readonly Dnd5eCharacterSpellReference[],
  mutations: readonly Dnd5eCharacterSpellMutation[],
): { missingIds: string[]; spells: Dnd5eCharacterSpellReference[] } {
  let next = spells.map((spell) => ({ ...spell }));
  const missingIds = new Set<string>();
  for (const mutation of mutations) {
    if (mutation.kind === 'add') {
      if (
        next.length < MAX_DND5E_CHARACTER_SPELLS &&
        !next.some(({ entryId }) => entryId === mutation.spell.entryId)
      ) {
        next.push({ ...mutation.spell });
      }
      continue;
    }
    if (mutation.kind === 'remove') {
      next = next.filter(({ entryId }) => entryId !== mutation.entryId);
      continue;
    }
    if (mutation.kind === 'reorder') {
      const orderedEntryIds = mutation.orderedEntryIds.filter(
        (entryId, index, entryIds) =>
          entryIds.indexOf(entryId) === index &&
          next.some((spell) => spell.entryId === entryId),
      );
      const orderedEntryIdSet = new Set(orderedEntryIds);
      let orderedIndex = 0;
      next = next.map((spell) => {
        if (!orderedEntryIdSet.has(spell.entryId)) return spell;
        const entryId = orderedEntryIds[orderedIndex++];
        return next.find((candidate) => candidate.entryId === entryId)!;
      });
      continue;
    }
    const index = next.findIndex(({ entryId }) => entryId === mutation.entryId);
    if (index < 0) {
      missingIds.add(mutation.entryId);
    } else {
      next[index] = { ...next[index], preparation: mutation.preparation };
    }
  }
  return { missingIds: [...missingIds], spells: next };
}

export function applyDnd5eCharacterFeatureMutations(
  features: readonly Dnd5eCharacterFeature[],
  mutations: readonly Dnd5eCharacterFeatureMutation[],
): { features: Dnd5eCharacterFeature[]; missingIds: string[] } {
  let next = features.map((feature) => ({ ...feature }));
  const missingIds = new Set<string>();
  for (const mutation of mutations) {
    if (mutation.kind === 'add') {
      if (!next.some(({ id }) => id === mutation.feature.id)) {
        next.push({ ...mutation.feature });
      }
      continue;
    }
    if (mutation.kind === 'delete') {
      next = next.filter(({ id }) => id !== mutation.id);
      continue;
    }
    if (mutation.kind === 'update') {
      const index = next.findIndex(({ id }) => id === mutation.id);
      if (index < 0) {
        missingIds.add(mutation.id);
      } else {
        next[index] = { ...next[index], ...mutation.changes };
      }
      continue;
    }
    if (mutation.kind === 'move') {
      const index = next.findIndex(({ id }) => id === mutation.id);
      if (index < 0) {
        missingIds.add(mutation.id);
        continue;
      }
      const target = index + (mutation.direction === 'down' ? 1 : -1);
      if (target < 0 || target >= next.length) continue;
      [next[index], next[target]] = [next[target], next[index]];
      continue;
    }

    const desired = mutation.orderedIds.filter((id, index, ids) =>
      ids.indexOf(id) === index && next.some((feature) => feature.id === id),
    );
    const desiredSet = new Set(desired);
    let desiredIndex = 0;
    next = next.map((feature) => {
      if (!desiredSet.has(feature.id)) return feature;
      const desiredId = desired[desiredIndex++];
      return next.find(({ id }) => id === desiredId)!;
    });
  }
  return { features: next, missingIds: [...missingIds] };
}

export function applyDnd5eCharacterCustomSkillMutations(
  skills: readonly Dnd5eCharacterCustomSkill[],
  mutations: readonly Dnd5eCharacterCustomSkillMutation[],
): { missingIds: string[]; skills: Dnd5eCharacterCustomSkill[] } {
  let next = skills.map((skill) => ({ ...skill }));
  const missingIds = new Set<string>();
  for (const mutation of mutations) {
    if (mutation.kind === 'add') {
      if (!next.some(({ id }) => id === mutation.skill.id)) {
        next.push({ ...mutation.skill });
      }
      continue;
    }
    if (mutation.kind === 'delete') {
      next = next.filter(({ id }) => id !== mutation.id);
      continue;
    }
    if (mutation.kind === 'update') {
      const index = next.findIndex(({ id }) => id === mutation.id);
      if (index < 0) {
        missingIds.add(mutation.id);
      } else {
        next[index] = { ...next[index], ...mutation.changes };
      }
      continue;
    }
    if (mutation.kind === 'move') {
      const index = next.findIndex(({ id }) => id === mutation.id);
      if (index < 0) {
        missingIds.add(mutation.id);
        continue;
      }
      const target = index + (mutation.direction === 'down' ? 1 : -1);
      if (target < 0 || target >= next.length) continue;
      [next[index], next[target]] = [next[target], next[index]];
      continue;
    }

    const desired = mutation.orderedIds.filter((id, index, ids) =>
      ids.indexOf(id) === index && next.some((skill) => skill.id === id),
    );
    const desiredSet = new Set(desired);
    let desiredIndex = 0;
    next = next.map((skill) => {
      if (!desiredSet.has(skill.id)) return skill;
      const desiredId = desired[desiredIndex++];
      return next.find(({ id }) => id === desiredId)!;
    });
  }
  return { missingIds: [...missingIds], skills: next };
}

export function applyDnd5eCharacterResourceMutations(
  resources: readonly Dnd5eCharacterResource[],
  mutations: readonly Dnd5eCharacterResourceMutation[],
): { missingIds: string[]; resources: Dnd5eCharacterResource[] } {
  let next = resources.map((resource) => ({ ...resource }));
  const missingIds = new Set<string>();
  for (const mutation of mutations) {
    if (mutation.kind === 'add') {
      if (!next.some(({ id }) => id === mutation.resource.id)) {
        next.push({ ...mutation.resource });
      }
      continue;
    }
    if (mutation.kind === 'delete') {
      next = next.filter(({ id }) => id !== mutation.id);
      continue;
    }
    if (mutation.kind === 'update') {
      const index = next.findIndex(({ id }) => id === mutation.id);
      if (index < 0) {
        missingIds.add(mutation.id);
      } else {
        next[index] = { ...next[index], ...mutation.changes };
      }
      continue;
    }
    if (mutation.kind === 'move') {
      const index = next.findIndex(({ id }) => id === mutation.id);
      if (index < 0) {
        missingIds.add(mutation.id);
        continue;
      }
      const target = index + (mutation.direction === 'down' ? 1 : -1);
      if (target < 0 || target >= next.length) continue;
      [next[index], next[target]] = [next[target], next[index]];
      continue;
    }

    const desired = mutation.orderedIds.filter((id, index, ids) =>
      ids.indexOf(id) === index && next.some((resource) => resource.id === id),
    );
    const desiredSet = new Set(desired);
    let desiredIndex = 0;
    next = next.map((resource) => {
      if (!desiredSet.has(resource.id)) return resource;
      const desiredId = desired[desiredIndex++];
      return next.find(({ id }) => id === desiredId)!;
    });
  }
  return { missingIds: [...missingIds], resources: next };
}

interface InventoryEntryLocation {
  depth: number;
  entry: Dnd5eCharacterInventoryEntry;
  index: number;
  parentId: string | null;
  siblings: Dnd5eCharacterInventoryEntry[];
}

function findInventoryEntry(
  entries: Dnd5eCharacterInventoryEntry[],
  id: string,
  parentId: string | null = null,
  depth = 1,
): InventoryEntryLocation | null {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.id === id) {
      return { depth, entry, index, parentId, siblings: entries };
    }
    if (entry.kind === 'container') {
      const nested = findInventoryEntry(entry.contents, id, entry.id, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function inventoryDescendantIds(
  entry: Dnd5eCharacterInventoryEntry,
): Set<string> {
  const ids = new Set<string>([entry.id]);
  if (entry.kind === 'container') {
    for (const child of entry.contents) {
      for (const id of inventoryDescendantIds(child)) ids.add(id);
    }
  }
  return ids;
}

export function applyDnd5eCharacterInventoryMutations(
  inventory: Dnd5eCharacterInventory,
  mutations: readonly Dnd5eCharacterInventoryMutation[],
): {
  invalid: boolean;
  inventory: Dnd5eCharacterInventory;
  missingIds: string[];
} {
  let next = structuredClone(inventory);
  let invalid = false;
  const missingIds = new Set<string>();

  for (const mutation of mutations) {
    const before = structuredClone(next);
    if (mutation.kind === 'set-currency') {
      next.currency[mutation.denomination] = mutation.value;
    } else if (mutation.kind === 'set-variant-encumbrance') {
      next.variantEncumbrance = mutation.value;
    } else if (mutation.kind === 'add') {
      const entry = structuredClone(mutation.entry);
      if (mutation.parentId === null) {
        next.entries.push(entry);
      } else {
        const parent = findInventoryEntry(next.entries, mutation.parentId);
        if (!parent || parent.entry.kind !== 'container') {
          missingIds.add(mutation.parentId);
          continue;
        }
        entry.equipped = true;
        parent.entry.contents.push(entry);
      }
    } else if (mutation.kind === 'delete') {
      const location = findInventoryEntry(next.entries, mutation.id);
      if (!location) continue;
      location.siblings.splice(location.index, 1);
    } else if (mutation.kind === 'update') {
      const location = findInventoryEntry(next.entries, mutation.id);
      if (!location) {
        missingIds.add(mutation.id);
        continue;
      }
      const updated = { ...location.entry, ...mutation.changes } as
        Dnd5eCharacterInventoryEntry;
      if (location.parentId !== null) updated.equipped = true;
      location.siblings[location.index] = updated;
    } else if (mutation.kind === 'move') {
      const location = findInventoryEntry(next.entries, mutation.id);
      if (!location) {
        missingIds.add(mutation.id);
        continue;
      }
      const target = location.index + (mutation.direction === 'down' ? 1 : -1);
      if (target >= 0 && target < location.siblings.length) {
        [location.siblings[location.index], location.siblings[target]] =
          [location.siblings[target], location.siblings[location.index]];
      }
    } else {
      const source = findInventoryEntry(next.entries, mutation.id);
      if (!source) {
        missingIds.add(mutation.id);
        continue;
      }
      const descendants = inventoryDescendantIds(source.entry);
      if (
        mutation.parentId !== null &&
        descendants.has(mutation.parentId)
      ) {
        invalid = true;
        continue;
      }
      const destination = mutation.parentId === null
        ? next.entries
        : (() => {
            const parent = findInventoryEntry(next.entries, mutation.parentId!);
            if (!parent || parent.entry.kind !== 'container') return null;
            return parent.entry.contents;
          })();
      if (!destination) {
        missingIds.add(mutation.parentId!);
        continue;
      }
      source.siblings.splice(source.index, 1);
      const moved = source.entry;
      if (source.parentId !== mutation.parentId) moved.equipped = true;
      const target = mutation.beforeId === null
        ? destination.length
        : destination.findIndex(({ id }) => id === mutation.beforeId);
      destination.splice(target < 0 ? destination.length : target, 0, moved);
    }

    if (!isDnd5eCharacterInventory(next as unknown as JsonValue)) {
      next = before;
      invalid = true;
    }
  }

  return { invalid, inventory: next, missingIds: [...missingIds] };
}

export function parseDnd5eSafeInteger(value: string): number | null {
  const normalized = value.trim();
  if (!/^[+-]?\d+$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseDnd5eNonnegativeSafeInteger(value: string): number | null {
  const parsed = parseDnd5eSafeInteger(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

export function parseDnd5eNonnegativeWeight(value: string): number | null {
  const normalized = value.trim();
  const match = /^\+?(\d+)(?:\.(\d{1,2}))?$/u.exec(normalized);
  if (!match) return null;
  const hundredths = BigInt(match[1]) * 100n +
    BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  if (hundredths > MAX_SAFE_BIGINT) return null;
  const parsed = Number(hundredths) / 100;
  return weightInHundredths(parsed) === Number(hundredths) ? parsed : null;
}

export function formatDnd5eWeight(hundredths: number): string {
  if (!Number.isSafeInteger(hundredths) || hundredths < 0) return '0';
  const whole = Math.floor(hundredths / 100);
  const fraction = hundredths % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, '0').replace(/0$/u, '')}`;
}

export function formatDnd5eSignedValue(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function calculateDnd5eOffsetForTotal(
  currentTotal: number,
  currentOffset: number,
  desiredTotal: number,
): number | null {
  if (![currentTotal, currentOffset, desiredTotal].every(Number.isSafeInteger)) return null;
  const base = safeAdd(currentTotal, -currentOffset);
  return base === null ? null : safeAdd(desiredTotal, -base);
}

export function calculateDnd5eSkillValues(
  abilityModifier: number,
  proficiencyBonus: number,
  skill: Dnd5eCharacterSkill,
): Dnd5eSkillValues | null {
  const multiplier = skill.training === 'expertise'
    ? 2
    : skill.training === 'proficient'
      ? 1
      : 0;
  const trainingBonus = safeMultiply(proficiencyBonus, multiplier);
  if (trainingBonus === null) return null;
  const bonus = safeAdd(abilityModifier, trainingBonus, skill.bonusOffset);
  if (bonus === null) return null;
  const passive = safeAdd(10, bonus, skill.passiveOffset);
  return passive === null ? null : { bonus, passive };
}

const DND5E_SIZE_FACTOR_HALVES: Readonly<Record<string, bigint>> = {
  gargantuan: 16n,
  huge: 8n,
  large: 4n,
  medium: 2n,
  small: 2n,
  tiny: 1n,
};

function physicalInventoryWeight(
  entry: Dnd5eCharacterInventoryEntry,
  containerUsage: Map<string, bigint>,
): bigint | null {
  const ownWeightHundredths = weightInHundredths(entry.weight);
  if (ownWeightHundredths === null) return null;
  const ownWeight = BigInt(ownWeightHundredths);
  if (entry.kind === 'item') {
    if (!isNonnegativeSafeInteger(entry.quantity)) return null;
    return ownWeight * BigInt(entry.quantity);
  }
  let contents = 0n;
  for (const child of entry.contents) {
    const childWeight = physicalInventoryWeight(child, containerUsage);
    if (childWeight === null) return null;
    contents += childWeight;
  }
  containerUsage.set(entry.id, contents);
  return ownWeight + contents;
}

function carriedInventoryWeight(
  entry: Dnd5eCharacterInventoryEntry,
): bigint | null {
  const ownWeightHundredths = weightInHundredths(entry.weight);
  if (ownWeightHundredths === null) return null;
  const ownWeight = BigInt(ownWeightHundredths);
  if (entry.kind === 'item') {
    if (!isNonnegativeSafeInteger(entry.quantity)) return null;
    return ownWeight * BigInt(entry.quantity);
  }
  if (entry.contentsWeight === 'weightless') {
    return ownWeight;
  }
  let contents = 0n;
  for (const child of entry.contents) {
    const childWeight = carriedInventoryWeight(child);
    if (childWeight === null) return null;
    contents += childWeight;
  }
  return ownWeight + contents;
}

export function deriveDnd5eInventoryValues(
  data: Dnd5eCharacterData,
): Dnd5eDerivedInventoryValues | null {
  const physicalUsage = new Map<string, bigint>();
  for (const entry of data.inventory.entries) {
    if (physicalInventoryWeight(entry, physicalUsage) === null) return null;
  }

  let current = INVENTORY_CURRENCY_KEYS.reduce(
    (total, denomination) =>
      total + BigInt(data.inventory.currency[denomination]) * 2n,
    0n,
  );
  for (const entry of data.inventory.entries) {
    if (!entry.equipped) continue;
    const entryWeight = carriedInventoryWeight(entry);
    if (entryWeight === null) return null;
    current += entryWeight;
  }

  const normalizedSize = data.appearance.size.trim().toLocaleLowerCase('en-US');
  const sizeFactorHalves = DND5E_SIZE_FACTOR_HALVES[normalizedSize] ?? 2n;
  const strength = BigInt(Math.max(0, data.abilities.strength.score));
  const scaledThreshold = (multiplier: bigint) =>
    strength * multiplier * sizeFactorHalves * 50n;
  const capacity = scaledThreshold(15n);
  const encumbered = data.inventory.variantEncumbrance
    ? scaledThreshold(5n)
    : null;
  const heavilyEncumbered = data.inventory.variantEncumbrance
    ? scaledThreshold(10n)
    : null;

  const currentWeightHundredths = safeBigIntToNumber(current);
  const carryingCapacityHundredths = safeBigIntToNumber(capacity);
  const encumberedAtHundredths = encumbered === null
    ? null
    : safeBigIntToNumber(encumbered);
  const heavilyEncumberedAtHundredths = heavilyEncumbered === null
    ? null
    : safeBigIntToNumber(heavilyEncumbered);
  if (
    currentWeightHundredths === null ||
    carryingCapacityHundredths === null ||
    (encumbered !== null && encumberedAtHundredths === null) ||
    (heavilyEncumbered !== null && heavilyEncumberedAtHundredths === null)
  ) {
    return null;
  }

  const containers: Record<string, Dnd5eDerivedContainerValues> = {};
  const visit = (entries: readonly Dnd5eCharacterInventoryEntry[]): boolean => {
    for (const entry of entries) {
      if (entry.kind !== 'container') continue;
      const usedWeightHundredths = safeBigIntToNumber(
        physicalUsage.get(entry.id) ?? 0n,
      );
      const capacityHundredths = entry.capacity === null
        ? null
        : safeBigIntToNumber(BigInt(entry.capacity) * 100n);
      if (
        usedWeightHundredths === null ||
        (entry.capacity !== null && capacityHundredths === null)
      ) {
        return false;
      }
      containers[entry.id] = {
        capacityHundredths,
        overCapacity: capacityHundredths !== null &&
          usedWeightHundredths > capacityHundredths,
        usedWeightHundredths,
      };
      if (!visit(entry.contents)) return false;
    }
    return true;
  };
  if (!visit(data.inventory.entries)) return null;

  const status: Dnd5eInventoryStatus = currentWeightHundredths >
    carryingCapacityHundredths
    ? 'over-capacity'
    : heavilyEncumberedAtHundredths !== null &&
        currentWeightHundredths > heavilyEncumberedAtHundredths
      ? 'heavily-encumbered'
      : encumberedAtHundredths !== null &&
          currentWeightHundredths > encumberedAtHundredths
        ? 'encumbered'
        : 'normal';

  return {
    carryingCapacityHundredths,
    containers,
    currentWeightHundredths,
    encumberedAtHundredths,
    heavilyEncumberedAtHundredths,
    status,
  };
}

function deriveDnd5ePreparedSpellMaximumBase(
  className: Dnd5eCharacterClass | null,
  level: number | null,
  rulesVersion: Dnd5eRulesVersion,
  spellcastingModifier: number | null,
): number | null {
  if (className === null || level === null || level < 1 || level > 20) return 0;
  if (rulesVersion === '5.5e') {
    if (className === 'Artificer') {
      if (spellcastingModifier === null) return 0;
      const total = safeAdd(Math.floor(level / 2), spellcastingModifier);
      return total === null ? null : Math.max(1, total);
    }
    const table = PREPARED_SPELL_TABLE_5_5E[className as keyof
      typeof PREPARED_SPELL_TABLE_5_5E] as readonly number[] | undefined;
    return table?.[level - 1] ?? 0;
  }

  const knownTable = SPELLS_KNOWN_TABLE_5E[className as keyof
    typeof SPELLS_KNOWN_TABLE_5E] as readonly number[] | undefined;
  if (knownTable) return knownTable[level - 1] ?? 0;
  if (spellcastingModifier === null) return 0;
  if (className === 'Cleric' || className === 'Druid' || className === 'Wizard') {
    const total = safeAdd(level, spellcastingModifier);
    return total === null ? null : Math.max(1, total);
  }
  if (className === 'Paladin') {
    if (level < 2) return 0;
    const total = safeAdd(Math.floor(level / 2), spellcastingModifier);
    return total === null ? null : Math.max(1, total);
  }
  if (className === 'Artificer') {
    const total = safeAdd(Math.floor(level / 2), spellcastingModifier);
    return total === null ? null : Math.max(1, total);
  }
  return 0;
}

function deriveDnd5eSpellSlotBases(
  className: Dnd5eCharacterClass | null,
  level: number | null,
  rulesVersion: Dnd5eRulesVersion,
): Record<Dnd5eSpellSlotLevel, number> {
  const totals = Object.fromEntries(
    DND5E_SPELL_SLOT_LEVELS.map((slotLevel) => [slotLevel, 0]),
  ) as Record<Dnd5eSpellSlotLevel, number>;
  if (className === null || level === null || level < 1 || level > 20) {
    return totals;
  }

  if (className === 'Warlock') {
    const pactMagic = PACT_MAGIC_SPELL_SLOTS[level - 1];
    totals[String(pactMagic.level) as Dnd5eSpellSlotLevel] = pactMagic.count;
    return totals;
  }

  const fullCaster = className === 'Bard' || className === 'Cleric' ||
    className === 'Druid' || className === 'Sorcerer' || className === 'Wizard';
  const halfCaster = className === 'Paladin' || className === 'Ranger';
  const row = fullCaster
    ? FULL_CASTER_SPELL_SLOTS[level - 1]
    : className === 'Artificer' || (halfCaster && rulesVersion === '5.5e')
      ? STARTING_HALF_CASTER_SPELL_SLOTS[level - 1]
      : halfCaster
        ? HALF_CASTER_SPELL_SLOTS_5E[level - 1]
        : undefined;
  row?.forEach((total, index) => {
    totals[DND5E_SPELL_SLOT_LEVELS[index]] = total;
  });
  return totals;
}

export function deriveDnd5eCharacterValues(
  data: Dnd5eCharacterData,
  rulesVersion: Dnd5eRulesVersion,
): Dnd5eDerivedCharacterValues | null {
  if (!Object.hasOwn(RULE_SAVE_PROFICIENCIES, rulesVersion)) return null;
  const level = data.identity.level;
  if (level !== null && !Number.isSafeInteger(level)) return null;
  const proficiencyBase = level === null
    ? 2
    : level >= 1 && level <= 20
      ? 2 + Math.floor((level - 1) / 4)
      : 0;
  const proficiencyBonus = safeAdd(
    proficiencyBase,
    data.importantStats.proficiencyBonusOffset,
  );
  if (proficiencyBonus === null) return null;

  const knownClass = DND5E_5_5E_CLASSES.includes(
    data.identity.className as Dnd5eCharacterClass,
  )
    ? data.identity.className as Dnd5eCharacterClass
    : null;
  const saveProficiencies: readonly Dnd5eAbilityId[] = knownClass
    ? RULE_SAVE_PROFICIENCIES[rulesVersion][knownClass]
    : [];
  const abilities = {} as Record<Dnd5eAbilityId, Dnd5eDerivedAbilityValues>;
  for (const ability of DND5E_ABILITIES) {
    const abilityData = data.abilities[ability];
    const modifierBase = abilityModifierBase(abilityData.score);
    if (modifierBase === null) return null;
    const modifier = safeAdd(modifierBase, abilityData.modifierOffset);
    if (modifier === null) return null;
    const proficiency = saveProficiencies.includes(ability) ? proficiencyBonus : 0;
    const savingThrow = safeAdd(modifier, proficiency, abilityData.savingThrowOffset);
    if (savingThrow === null) return null;
    abilities[ability] = { modifier, savingThrow };
  }

  const initiative = safeAdd(
    abilities.dexterity.modifier,
    data.importantStats.initiativeOffset,
  );
  const concentrationSave = safeAdd(
    abilities.constitution.savingThrow,
    data.importantStats.concentrationSaveOffset,
  );
  if (initiative === null || concentrationSave === null) return null;

  const skills = {} as Record<Dnd5eSkillId, Dnd5eSkillValues>;
  for (const skill of DND5E_SKILLS) {
    const values = calculateDnd5eSkillValues(
      abilities[skill.ability].modifier,
      proficiencyBonus,
      data.skills[skill.id],
    );
    if (values === null) return null;
    skills[skill.id] = values;
  }
  const customSkills: Record<string, Dnd5eSkillValues> = {};
  for (const skill of data.customSkills) {
    const abilityModifier = skill.ability === 'none'
      ? 0
      : abilities[skill.ability].modifier;
    const values = calculateDnd5eSkillValues(
      abilityModifier,
      proficiencyBonus,
      skill,
    );
    if (values === null) return null;
    customSkills[skill.id] = values;
  }

  const spellcastingAbility = data.spellcasting.ability;
  const spellcastingModifier = spellcastingAbility === null
    ? null
    : abilities[spellcastingAbility].modifier;
  const attackBonus = spellcastingModifier === null
    ? null
    : safeAdd(
        spellcastingModifier,
        proficiencyBonus,
        data.spellcasting.attackBonusOffset,
      );
  const saveDc = spellcastingModifier === null
    ? null
    : safeAdd(
        8,
        spellcastingModifier,
        proficiencyBonus,
        data.spellcasting.saveDcOffset,
      );
  if (
    (spellcastingModifier !== null && attackBonus === null) ||
    (spellcastingModifier !== null && saveDc === null)
  ) return null;

  const preparedMaximumBase = deriveDnd5ePreparedSpellMaximumBase(
    knownClass,
    level,
    rulesVersion,
    spellcastingModifier,
  );
  if (preparedMaximumBase === null) return null;
  const preparedMaximumWithOffset = safeAdd(
    preparedMaximumBase,
    data.spellcasting.preparedMaximumOffset,
  );
  if (preparedMaximumWithOffset === null) return null;
  const preparedMaximum = Math.max(0, preparedMaximumWithOffset);

  const spellSlotBases = deriveDnd5eSpellSlotBases(
    knownClass,
    level,
    rulesVersion,
  );
  const spellSlots = {} as Dnd5eDerivedCharacterValues['spellcasting']['slots'];
  for (const slotLevel of DND5E_SPELL_SLOT_LEVELS) {
    const baseTotal = spellSlotBases[slotLevel];
    const totalWithOffset = safeAdd(
      baseTotal,
      data.spellcasting.slots[slotLevel].totalOffset,
    );
    if (totalWithOffset === null) return null;
    spellSlots[slotLevel] = {
      baseTotal,
      total: Math.max(0, totalWithOffset),
    };
  }

  const inventory = deriveDnd5eInventoryValues(data);
  if (inventory === null) return null;

  return {
    abilities,
    concentrationSave,
    customSkills,
    initiative,
    inventory,
    proficiencyBonus,
    skills,
    spellcasting: {
      attackBonus,
      preparedMaximum,
      preparedMaximumBase,
      saveDc,
      slots: spellSlots,
    },
  };
}

export function nextDnd5eSkillTraining(
  training: Dnd5eSkillTraining,
): Dnd5eSkillTraining {
  const index = DND5E_SKILL_TRAINING_STATES.indexOf(training);
  return DND5E_SKILL_TRAINING_STATES[
    (index + 1) % DND5E_SKILL_TRAINING_STATES.length
  ];
}
