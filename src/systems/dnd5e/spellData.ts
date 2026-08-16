import type { JsonValue } from '../../shared/gameSystems';
import {
  DND5E_5_5E_CLASSES,
  DND5E_ABILITIES,
  DND5E_ACTION_STEP_PURPOSES,
  DND5E_DAMAGE_TYPES,
  type Dnd5eAbilityId,
  type Dnd5eActionStepPurpose,
  type Dnd5eCharacterClass,
  type Dnd5eDamageType,
} from './characterData';

export const MAX_DND5E_SPELL_FIELD_CODE_UNITS = 128;
export const MAX_DND5E_SPELL_DESCRIPTION_CODE_UNITS = 16_384;
export const MAX_DND5E_SPELL_ROLL_STEPS = 32;
export const MAX_DND5E_SPELL_ROLL_TERMS = 32;
export const MAX_DND5E_SPELL_SCALING_TIERS = 20;

export const DND5E_SPELL_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const DND5E_SPELL_SCHOOLS = [
  'Abjuration',
  'Conjuration',
  'Divination',
  'Enchantment',
  'Evocation',
  'Illusion',
  'Necromancy',
  'Transmutation',
] as const;
export const DND5E_SPELL_SCALING_MODES = [
  'fixed',
  'caster-level',
  'cast-level',
] as const;

export type Dnd5eSpellLevel = (typeof DND5E_SPELL_LEVELS)[number];
export type Dnd5eSpellSchool = (typeof DND5E_SPELL_SCHOOLS)[number];
export type Dnd5eSpellScalingMode = (typeof DND5E_SPELL_SCALING_MODES)[number];

export type Dnd5eSpellDiceTier = {
  count: number;
  minimum: number;
};

export type Dnd5eSpellFlatTier = {
  minimum: number;
  value: number;
};

export type Dnd5eSpellValueTerm =
  | {
      count: number;
      kind: 'dice';
      scaling: Dnd5eSpellScalingMode;
      sides: number;
      tiers: Dnd5eSpellDiceTier[];
    }
  | {
      kind: 'flat';
      scaling: Dnd5eSpellScalingMode;
      tiers: Dnd5eSpellFlatTier[];
      value: number;
    }
  | { kind: 'spellcasting-modifier' }
  | { kind: 'caster-level' }
  | { kind: 'cast-level' };

type Dnd5eSpellRollStepBase = {
  id: string;
  label: string;
};

export type Dnd5eSpellAttackStep = Dnd5eSpellRollStepBase & {
  attackBonus:
    | { kind: 'spell-attack-bonus' }
    | { kind: 'fixed'; modifier: number };
  purpose: 'attack';
};

export type Dnd5eSpellGeneralRollStep = Dnd5eSpellRollStepBase & {
  purpose: 'roll';
  terms: Dnd5eSpellValueTerm[];
};

export type Dnd5eSpellDamageStep = Dnd5eSpellRollStepBase & {
  criticalSourceStepId: string | null;
  damageType: Dnd5eDamageType | null;
  purpose: 'damage';
  terms: Dnd5eSpellValueTerm[];
};

export type Dnd5eSpellHealingStep = Dnd5eSpellRollStepBase & {
  purpose: 'healing';
  terms: Dnd5eSpellValueTerm[];
};

export type Dnd5eSpellSaveStep = Dnd5eSpellRollStepBase & {
  ability: Dnd5eAbilityId;
  dc: { kind: 'spell-save-dc' } | { dc: number; kind: 'fixed' };
  failure: string;
  purpose: 'save';
  success: string;
};

export type Dnd5eSpellRollStep =
  | Dnd5eSpellAttackStep
  | Dnd5eSpellGeneralRollStep
  | Dnd5eSpellDamageStep
  | Dnd5eSpellHealingStep
  | Dnd5eSpellSaveStep;

export type Dnd5eSpellRollStepMutation =
  | { kind: 'add'; step: Dnd5eSpellRollStep }
  | { id: string; kind: 'update'; step: Dnd5eSpellRollStep }
  | { id: string; kind: 'delete' }
  | { direction: 'down' | 'up'; id: string; kind: 'move' }
  | { kind: 'reorder'; orderedIds: readonly string[] };

export type Dnd5eSpellData = {
  castingTime: string;
  classes: Dnd5eCharacterClass[];
  components: {
    material: boolean;
    materialDescription: string;
    somatic: boolean;
    verbal: boolean;
  };
  concentration: boolean;
  description: string;
  duration: string;
  higherLevelDescription: string;
  level: Dnd5eSpellLevel;
  range: string;
  ritual: boolean;
  rollSteps: Dnd5eSpellRollStep[];
  school: Dnd5eSpellSchool;
  target: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const SPELL_KEYS = [
  'castingTime',
  'classes',
  'components',
  'concentration',
  'description',
  'duration',
  'higherLevelDescription',
  'level',
  'range',
  'ritual',
  'rollSteps',
  'school',
  'target',
] as const;
const COMPONENT_KEYS = [
  'material',
  'materialDescription',
  'somatic',
  'verbal',
] as const;

export function createDefaultDnd5eSpellData(): Dnd5eSpellData {
  return {
    castingTime: 'Action',
    classes: [],
    components: {
      material: false,
      materialDescription: '',
      somatic: false,
      verbal: false,
    },
    concentration: false,
    description: '',
    duration: 'Instantaneous',
    higherLevelDescription: '',
    level: 0,
    range: 'Self',
    ritual: false,
    rollSteps: [],
    school: 'Abjuration',
    target: 'Self',
  };
}

export function createDefaultDnd5eSpellRollStep(
  purpose: Dnd5eActionStepPurpose = 'roll',
  id: string = crypto.randomUUID(),
): Dnd5eSpellRollStep {
  const base = {
    id,
    label: purpose === 'roll'
      ? 'General Roll'
      : purpose === 'save'
        ? 'Save Prompt'
        : `${purpose[0].toUpperCase()}${purpose.slice(1)}`,
  };
  if (purpose === 'attack') {
    return {
      ...base,
      attackBonus: { kind: 'spell-attack-bonus' },
      purpose,
    };
  }
  if (purpose === 'roll') {
    return {
      ...base,
      purpose,
      terms: [createDefaultDiceTerm(20)],
    };
  }
  if (purpose === 'damage') {
    return {
      ...base,
      criticalSourceStepId: null,
      damageType: null,
      purpose,
      terms: [createDefaultDiceTerm(6)],
    };
  }
  if (purpose === 'healing') {
    return {
      ...base,
      purpose,
      terms: [createDefaultDiceTerm(6)],
    };
  }
  return {
    ...base,
    ability: 'dexterity',
    dc: { kind: 'spell-save-dc' },
    failure: '',
    purpose,
    success: '',
  };
}

export function createDefaultDnd5eSpellValueTerm(
  kind: Dnd5eSpellValueTerm['kind'] = 'flat',
): Dnd5eSpellValueTerm {
  if (kind === 'dice') return createDefaultDiceTerm(6);
  if (kind === 'flat') return { kind, scaling: 'fixed', tiers: [], value: 0 };
  return { kind };
}

function createDefaultDiceTerm(sides: number): Extract<Dnd5eSpellValueTerm, { kind: 'dice' }> {
  return { count: 1, kind: 'dice', scaling: 'fixed', sides, tiers: [] };
}

export function describeDnd5eSpellData(data: Dnd5eSpellData): string {
  if (data.level === 0) return `Cantrip ${data.school}`;
  const suffix = data.level === 1
    ? 'st'
    : data.level === 2
      ? 'nd'
      : data.level === 3
        ? 'rd'
        : 'th';
  return `${data.level}${suffix} Level ${data.school}`;
}

export function isDnd5eSpellData(value: JsonValue): value is Dnd5eSpellData {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, SPELL_KEYS) ||
    !isBoundedString(value.castingTime) ||
    !isBoundedString(value.duration) ||
    !isBoundedString(value.range) ||
    !isBoundedString(value.target) ||
    !isBoundedDescription(value.description) ||
    !isBoundedDescription(value.higherLevelDescription) ||
    typeof value.level !== 'number' ||
    !DND5E_SPELL_LEVELS.includes(value.level as Dnd5eSpellLevel) ||
    typeof value.school !== 'string' ||
    !DND5E_SPELL_SCHOOLS.includes(value.school as Dnd5eSpellSchool) ||
    typeof value.concentration !== 'boolean' ||
    typeof value.ritual !== 'boolean' ||
    !Array.isArray(value.classes) ||
    value.classes.length > DND5E_5_5E_CLASSES.length ||
    !value.classes.every((item) =>
      typeof item === 'string' &&
      DND5E_5_5E_CLASSES.includes(item as Dnd5eCharacterClass)
    ) ||
    new Set(value.classes).size !== value.classes.length ||
    !isRecord(value.components) ||
    !hasExactKeys(value.components, COMPONENT_KEYS) ||
    typeof value.components.material !== 'boolean' ||
    typeof value.components.somatic !== 'boolean' ||
    typeof value.components.verbal !== 'boolean' ||
    !isBoundedDescription(value.components.materialDescription) ||
    !Array.isArray(value.rollSteps) ||
    value.rollSteps.length > MAX_DND5E_SPELL_ROLL_STEPS ||
    !value.rollSteps.every((step) =>
      isDnd5eSpellRollStep(step, value.level as Dnd5eSpellLevel)
    )
  ) {
    return false;
  }

  const ids = new Set<string>();
  const attackIds = new Set<string>();
  for (const step of value.rollSteps as Dnd5eSpellRollStep[]) {
    if (ids.has(step.id)) return false;
    ids.add(step.id);
    if (step.purpose === 'attack') attackIds.add(step.id);
  }
  return !(value.rollSteps as Dnd5eSpellRollStep[]).some(
    (step) => step.purpose === 'damage' &&
      step.criticalSourceStepId !== null &&
      !attackIds.has(step.criticalSourceStepId),
  );
}

function isDnd5eSpellRollStep(
  value: JsonValue,
  spellLevel: Dnd5eSpellLevel,
): value is Dnd5eSpellRollStep {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !UUID_PATTERN.test(value.id) ||
    !isBoundedString(value.label) ||
    typeof value.purpose !== 'string' ||
    !DND5E_ACTION_STEP_PURPOSES.includes(value.purpose as Dnd5eActionStepPurpose)
  ) {
    return false;
  }

  if (value.purpose === 'attack') {
    return hasExactKeys(value, ['attackBonus', 'id', 'label', 'purpose']) &&
      isAttackBonus(value.attackBonus);
  }
  if (value.purpose === 'save') {
    return hasExactKeys(value, ['ability', 'dc', 'failure', 'id', 'label', 'purpose', 'success']) &&
      typeof value.ability === 'string' &&
      DND5E_ABILITIES.includes(value.ability as Dnd5eAbilityId) &&
      isSaveDc(value.dc) &&
      isBoundedDescription(value.failure) &&
      isBoundedDescription(value.success);
  }
  if (value.purpose === 'damage') {
    return hasExactKeys(value, [
      'criticalSourceStepId', 'damageType', 'id', 'label', 'purpose', 'terms',
    ]) &&
      (value.criticalSourceStepId === null ||
        (typeof value.criticalSourceStepId === 'string' && UUID_PATTERN.test(value.criticalSourceStepId))) &&
      (value.damageType === null ||
        (typeof value.damageType === 'string' && DND5E_DAMAGE_TYPES.includes(value.damageType as Dnd5eDamageType))) &&
      isTerms(value.terms, spellLevel);
  }
  return hasExactKeys(value, ['id', 'label', 'purpose', 'terms']) &&
    isTerms(value.terms, spellLevel);
}

function isAttackBonus(value: JsonValue | undefined): value is Dnd5eSpellAttackStep['attackBonus'] {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'spell-attack-bonus') {
    return hasExactKeys(value, ['kind']);
  }
  return value.kind === 'fixed' &&
    hasExactKeys(value, ['kind', 'modifier']) &&
    isSafeInteger(value.modifier);
}

function isSaveDc(value: JsonValue | undefined): value is Dnd5eSpellSaveStep['dc'] {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'spell-save-dc') return hasExactKeys(value, ['kind']);
  return value.kind === 'fixed' &&
    hasExactKeys(value, ['dc', 'kind']) &&
    isSafeInteger(value.dc) && value.dc >= 0;
}

function isTerms(
  value: JsonValue | undefined,
  spellLevel: Dnd5eSpellLevel,
): value is Dnd5eSpellValueTerm[] {
  return Array.isArray(value) &&
    value.length <= MAX_DND5E_SPELL_ROLL_TERMS &&
    value.every((term) => isTerm(term, spellLevel));
}

function isTerm(value: JsonValue, spellLevel: Dnd5eSpellLevel): value is Dnd5eSpellValueTerm {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'cast-level') {
    return spellLevel > 0 && hasExactKeys(value, ['kind']);
  }
  if (
    value.kind === 'spellcasting-modifier' ||
    value.kind === 'caster-level'
  ) {
    return hasExactKeys(value, ['kind']);
  }
  if (value.kind === 'flat') {
    return hasExactKeys(value, ['kind', 'scaling', 'tiers', 'value']) &&
      isSafeInteger(value.value) &&
      hasValidScalingTiers(value, spellLevel, (tier) =>
        hasExactKeys(tier, ['minimum', 'value']) && isSafeInteger(tier.value)
      );
  }
  if (
    value.kind !== 'dice' ||
    !hasExactKeys(value, ['count', 'kind', 'scaling', 'sides', 'tiers']) ||
    !isSafeInteger(value.count) || value.count < 1 || value.count > 1_000 ||
    !isSafeInteger(value.sides) || value.sides < 2
  ) {
    return false;
  }
  return hasValidScalingTiers(value, spellLevel, (tier) =>
    hasExactKeys(tier, ['count', 'minimum']) &&
    isSafeInteger(tier.count) && tier.count >= 1 && tier.count <= 1_000
  );
}

function hasValidScalingTiers(
  value: Record<string, JsonValue>,
  spellLevel: Dnd5eSpellLevel,
  isTierValueValid: (tier: Record<string, JsonValue>) => boolean,
): boolean {
  if (
    typeof value.scaling !== 'string' ||
    !DND5E_SPELL_SCALING_MODES.includes(value.scaling as Dnd5eSpellScalingMode) ||
    !Array.isArray(value.tiers) ||
    value.tiers.length > MAX_DND5E_SPELL_SCALING_TIERS
  ) {
    return false;
  }
  if (value.scaling === 'fixed') return value.tiers.length === 0;
  if (value.scaling === 'cast-level' && spellLevel === 0) return false;

  let previous = 0;
  const minimum = value.scaling === 'caster-level' ? 1 : spellLevel;
  const maximum = value.scaling === 'caster-level' ? 20 : 9;
  return value.tiers.every((tier) => {
    if (
      !isRecord(tier) ||
      !isTierValueValid(tier) ||
      !isSafeInteger(tier.minimum) || tier.minimum < minimum || tier.minimum > maximum ||
      tier.minimum <= previous
    ) {
      return false;
    }
    previous = tier.minimum;
    return true;
  });
}

export function applyDnd5eSpellRollStepMutations(
  steps: readonly Dnd5eSpellRollStep[],
  mutations: readonly Dnd5eSpellRollStepMutation[],
): { missingIds: string[]; steps: Dnd5eSpellRollStep[] } {
  let next = structuredClone(steps) as Dnd5eSpellRollStep[];
  const missingIds = new Set<string>();
  for (const mutation of mutations) {
    if (mutation.kind === 'add') {
      if (!next.some(({ id }) => id === mutation.step.id)) {
        next.push(structuredClone(mutation.step));
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
        next[index] = { ...structuredClone(mutation.step), id: mutation.id };
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
      if (target >= 0 && target < next.length) {
        [next[index], next[target]] = [next[target], next[index]];
      }
      continue;
    }
    const desired = mutation.orderedIds.filter((id, index, ids) =>
      ids.indexOf(id) === index && next.some((step) => step.id === id),
    );
    const desiredSet = new Set(desired);
    let desiredIndex = 0;
    next = next.map((step) => {
      if (!desiredSet.has(step.id)) return step;
      const desiredId = desired[desiredIndex++];
      return next.find(({ id }) => id === desiredId)!;
    });
  }
  const attackIds = new Set(
    next.filter((step) => step.purpose === 'attack').map(({ id }) => id),
  );
  next = next.map((step) =>
    step.purpose === 'damage' &&
    step.criticalSourceStepId !== null &&
    !attackIds.has(step.criticalSourceStepId)
      ? { ...step, criticalSourceStepId: null }
      : step,
  );
  return { missingIds: [...missingIds], steps: next };
}

export function analyzeDnd5eSpellRollStep(step: Dnd5eSpellRollStep): {
  issues: string[];
  summary: string;
} {
  const issues: string[] = [];
  if (step.label.trim().length === 0) issues.push('A label is required.');
  let summary = '';
  if (step.purpose === 'attack') {
    summary = step.attackBonus.kind === 'spell-attack-bonus'
      ? 'd20 + Spell Attack Bonus'
      : `d20 ${formatSigned(step.attackBonus.modifier)}`;
  } else if (step.purpose === 'save') {
    const dc = step.dc.kind === 'spell-save-dc' ? 'Spell Save DC' : `DC ${step.dc.dc}`;
    summary = `${dc} ${capitalize(step.ability)} Save`;
  } else {
    summary = step.terms.map(describeTerm).join(' + ');
    if (step.terms.length === 0) issues.push('At least one value term is required.');
    if (step.terms.some((term) =>
      term.kind === 'dice' && term.scaling !== 'fixed' && term.tiers.length === 0
    )) {
      issues.push('Scaled dice require at least one tier.');
    }
    if (step.terms.some((term) =>
      term.kind === 'flat' && term.scaling !== 'fixed' && term.tiers.length === 0
    )) {
      issues.push('Scaled flat values require at least one tier.');
    }
    if (step.purpose === 'damage' && step.damageType) {
      summary = `${summary} ${step.damageType}`.trim();
    }
  }
  return { issues, summary: issues.length > 0 ? 'Needs setup' : summary };
}

function describeTerm(term: Dnd5eSpellValueTerm): string {
  if (term.kind === 'dice') {
    const base = `${term.count}d${term.sides}`;
    return term.scaling === 'fixed'
      ? base
      : `${base} (${term.scaling === 'caster-level' ? 'Caster Level' : 'Cast Level'} tiers)`;
  }
  if (term.kind === 'flat') {
    const base = String(term.value);
    return term.scaling === 'fixed'
      ? base
      : `${base} (${term.scaling === 'caster-level' ? 'Caster Level' : 'Cast Level'} tiers)`;
  }
  if (term.kind === 'spellcasting-modifier') return 'Spellcasting Modifier';
  if (term.kind === 'caster-level') return 'Caster Level';
  return 'Cast Level';
}

function formatSigned(value: number): string {
  return value >= 0 ? `+ ${value}` : `- ${Math.abs(value)}`;
}

function capitalize(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, JsonValue>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function isBoundedString(value: JsonValue | undefined): value is string {
  return typeof value === 'string' && value.length <= MAX_DND5E_SPELL_FIELD_CODE_UNITS;
}

function isBoundedDescription(value: JsonValue | undefined): value is string {
  return typeof value === 'string' && value.length <= MAX_DND5E_SPELL_DESCRIPTION_CODE_UNITS;
}

function isSafeInteger(value: JsonValue | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}
