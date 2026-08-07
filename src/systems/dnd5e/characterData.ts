import type { JsonValue } from '../../shared/gameSystems';

export const MAX_DND5E_CHARACTER_FIELD_CODE_UNITS = 128;
export const MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS = 16_384;
export const MAX_DND5E_CHARACTER_FEATURES = 128;
export const MAX_DND5E_CHARACTER_RESOURCES = 128;

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

export type Dnd5eAbilityId = (typeof DND5E_ABILITIES)[number];
export type Dnd5eCharacterClass = (typeof DND5E_5_5E_CLASSES)[number];
export type Dnd5eRulesVersion = '5e' | '5.5e';

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

export interface Dnd5eSkillValues {
  bonus: number;
  display: string;
  passive: number;
}

export interface Dnd5eDerivedAbilityValues {
  modifier: number;
  savingThrow: number;
}

export interface Dnd5eDerivedCharacterValues {
  abilities: Record<Dnd5eAbilityId, Dnd5eDerivedAbilityValues>;
  concentrationSave: number;
  initiative: number;
  proficiencyBonus: number;
  skills: Record<Dnd5eSkillId, Dnd5eSkillValues>;
}

export type Dnd5eCharacterData = {
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
  health: {
    currentHitDice: string;
    currentHitPoints: string;
    deathSaveFailures: string;
    deathSaveSuccesses: string;
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
  features: Dnd5eCharacterFeature[];
  resources: Dnd5eCharacterResource[];
  skills: Record<Dnd5eSkillId, Dnd5eSkillTraining>;
};

const ABILITY_KEYS = [
  'modifierOffset',
  'savingThrowOffset',
  'score',
] as const;
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
  'deathSaveFailures',
  'deathSaveSuccesses',
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
const FEATURE_KEYS = [
  'description',
  'id',
  'name',
  'source',
  'sourceType',
  'type',
] as const;
const RESOURCE_KEYS = ['current', 'id', 'maximum', 'name'] as const;

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
    DND5E_SKILLS.map(({ id }) => [id, 'untrained']),
  ) as Dnd5eCharacterData['skills'];
}

function defaultHealth(): Dnd5eCharacterData['health'] {
  return {
    currentHitDice: '1',
    currentHitPoints: '1',
    deathSaveFailures: '0',
    deathSaveSuccesses: '0',
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

export function createDefaultDnd5eCharacterData(): Dnd5eCharacterData {
  return {
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
    features: [],
    resources: [],
    skills: defaultSkills(),
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
): value is Record<Dnd5eSkillId, Dnd5eSkillTraining> {
  if (!isRecord(value)) return false;
  const expectedKeys = DND5E_SKILLS.map(({ id }) => id);
  return hasExactKeys(value, expectedKeys) &&
    expectedKeys.every((key) =>
      typeof value[key] === 'string' &&
      DND5E_SKILL_TRAINING_STATES.includes(value[key] as Dnd5eSkillTraining),
    );
}

function hasExactHealthFields(
  value: JsonValue,
): value is Dnd5eCharacterData['health'] {
  return hasExactStringFields(value, HEALTH_KEYS) &&
    ['0', '1', '2', '3'].includes(value.deathSaveFailures) &&
    ['0', '1', '2', '3'].includes(value.deathSaveSuccesses);
}

export function isDnd5eCharacterData(
  value: JsonValue,
): value is Dnd5eCharacterData {
  if (!isRecord(value) || !hasExactKeys(value, [
    'abilities',
    'appearance',
    'features',
    'health',
    'identity',
    'importantStats',
    'resources',
    'skills',
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
    !hasExactSkillFields(value.skills)
  ) {
    return false;
  }
  return deriveDnd5eCharacterValues(value as Dnd5eCharacterData, '5.5e') !== null;
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

export function parseDnd5eSafeInteger(value: string): number | null {
  const normalized = value.trim();
  if (!/^[+-]?\d+$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
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
  training: Dnd5eSkillTraining,
): Dnd5eSkillValues | null {
  const multiplier = training === 'expertise' ? 2 : training === 'proficient' ? 1 : 0;
  const trainingBonus = safeMultiply(proficiencyBonus, multiplier);
  if (trainingBonus === null) return null;
  const bonus = safeAdd(abilityModifier, trainingBonus);
  if (bonus === null) return null;
  const passive = safeAdd(10, bonus);
  return passive === null
    ? null
    : { bonus, display: `${formatDnd5eSignedValue(bonus)} / ${passive}`, passive };
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

  return {
    abilities,
    concentrationSave,
    initiative,
    proficiencyBonus,
    skills,
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
