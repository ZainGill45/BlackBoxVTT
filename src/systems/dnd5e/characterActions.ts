import {
  chatRollDefinitionSchema,
  type ChatRollConditionalSectionDefinition,
  type ChatRollDefinition,
  type ChatRollModifierDefinition,
  type ChatRollOrdinarySectionDefinition,
  type ChatRollSectionDefinition,
} from '../../shared/chatRoll';
import {
  DND5E_ABILITIES,
  type Dnd5eActionStep,
  type Dnd5eActionValueTerm,
  type Dnd5eCharacterAction,
  type Dnd5eCharacterData,
  type Dnd5eDerivedCharacterValues,
} from './characterData';

export interface Dnd5eActionIssue {
  message: string;
  stepId: string | null;
}

export interface Dnd5eActionStepPreview {
  label: string;
  purpose: Dnd5eActionStep['purpose'];
  stepId: string;
  summary: string;
}

export type CompiledDnd5eAction =
  | {
      definition: ChatRollDefinition;
      issues: [];
      ok: true;
      previews: Dnd5eActionStepPreview[];
    }
  | {
      issues: Dnd5eActionIssue[];
      ok: false;
      previews: Dnd5eActionStepPreview[];
    };

interface ResolvedTerms {
  criticalNotation: string;
  modifiers: ChatRollModifierDefinition[];
  notation: string;
  summary: string;
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim();
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function titleCase(value: string): string {
  return value.length === 0
    ? value
    : `${value[0].toLocaleUpperCase()}${value.slice(1)}`;
}

function resolveDiceCount(
  term: Extract<Dnd5eActionValueTerm, { kind: 'dice' }>,
  level: number,
): number {
  let count = term.count;
  for (const tier of term.tiers) {
    if (level >= tier.minimumLevel) count = tier.count;
  }
  return count;
}

function resolveTerms(
  terms: readonly Dnd5eActionValueTerm[],
  data: Dnd5eCharacterData,
  derived: Dnd5eDerivedCharacterValues,
  allowDice: boolean,
): ResolvedTerms | null {
  if (terms.length === 0) return null;
  const level = data.identity.level ?? 1;
  if (
    terms.some((term) =>
      (term.kind === 'level' ||
        (term.kind === 'dice' && term.tiers.length > 0)) &&
      (level < 1 || level > 20),
    )
  ) {
    return null;
  }
  const dice: string[] = [];
  const criticalDice: string[] = [];
  const modifiers: ChatRollModifierDefinition[] = [];
  const summary: string[] = [];
  for (const term of terms) {
    if (term.kind === 'dice') {
      if (!allowDice) return null;
      const count = resolveDiceCount(term, level);
      dice.push(`${count}d${term.sides}`);
      criticalDice.push(`${count * 2}d${term.sides}`);
      summary.push(`${count}d${term.sides}`);
      continue;
    }
    if (term.kind === 'ability') {
      const label = titleCase(term.ability);
      const value = derived.abilities[term.ability].modifier;
      modifiers.push({ label, value });
      summary.push(`${label} ${signed(value)}`);
      continue;
    }
    if (term.kind === 'proficiency') {
      const label = term.scale === 'half'
        ? 'Half Proficiency'
        : term.scale === 'twice'
          ? 'Twice Proficiency'
          : 'Proficiency';
      const value = term.scale === 'half'
        ? Math.floor(derived.proficiencyBonus / 2)
        : term.scale === 'twice'
          ? derived.proficiencyBonus * 2
          : derived.proficiencyBonus;
      if (!Number.isSafeInteger(value)) return null;
      modifiers.push({ label, value });
      summary.push(`${label} ${signed(value)}`);
      continue;
    }
    if (term.kind === 'level') {
      modifiers.push({ label: 'Level', value: level });
      summary.push(`Level ${signed(level)}`);
      continue;
    }
    modifiers.push({ label: 'Flat Modifier', value: term.value });
    summary.push(`Flat ${signed(term.value)}`);
  }
  return {
    criticalNotation: criticalDice.length > 0 ? criticalDice.join(' + ') : '0',
    modifiers,
    notation: dice.length > 0 ? dice.join(' + ') : '0',
    summary: summary.join(' + '),
  };
}

function detailsSection(
  action: Dnd5eCharacterAction,
): ChatRollSectionDefinition | null {
  const lines = [
    ['Activation', action.activation],
    ['Range', action.range],
    ['Target', action.target],
    ['Duration', action.duration],
  ]
    .filter(([, value]) => normalize(value).length > 0)
    .map(([label, value]) => `${label}: ${normalize(value)}`);
  const description = normalize(action.description);
  if (description) lines.push(description);
  return lines.length > 0
    ? { kind: 'effect', label: 'Details', text: lines.join('\n') }
    : null;
}

function rollSection(
  step: Exclude<Dnd5eActionStep, { purpose: 'effect' | 'save' }>,
  data: Dnd5eCharacterData,
  derived: Dnd5eDerivedCharacterValues,
): { resolved: ResolvedTerms; section: ChatRollOrdinarySectionDefinition } | null {
  const resolved = step.purpose === 'attack' && step.terms.length === 0
    ? {
        criticalNotation: '0',
        modifiers: [],
        notation: '0',
        summary: '',
      }
    : resolveTerms(step.terms, data, derived, true);
  if (!resolved) return null;
  const notation = step.purpose === 'attack'
    ? resolved.notation === '0'
      ? '1d20'
      : `1d20 + ${resolved.notation}`
    : resolved.notation;
  return {
    resolved: {
      ...resolved,
      criticalNotation: step.purpose === 'attack'
        ? resolved.criticalNotation === '0'
          ? '1d20'
          : `1d20 + ${resolved.criticalNotation}`
        : resolved.criticalNotation,
      notation,
      summary: step.purpose === 'attack'
        ? `1d20${resolved.summary ? ` + ${resolved.summary}` : ''}`
        : resolved.summary,
    },
    section: {
      label: normalize(step.label),
      modifiers: resolved.modifiers,
      notation,
      typeLabel: step.purpose === 'damage'
        ? step.damageType ? titleCase(normalize(step.damageType)) : 'Damage'
        : step.purpose === 'healing'
          ? 'Healing'
          : step.purpose === 'attack'
            ? 'Attack'
            : null,
    },
  };
}

function stepIssue(step: Dnd5eActionStep, message: string): Dnd5eActionIssue {
  return { message, stepId: step.id };
}

export function compileDnd5eCharacterAction(
  action: Dnd5eCharacterAction,
  data: Dnd5eCharacterData,
  derived: Dnd5eDerivedCharacterValues,
): CompiledDnd5eAction {
  const issues: Dnd5eActionIssue[] = [];
  const previews: Dnd5eActionStepPreview[] = [];
  const sections: ChatRollSectionDefinition[] = [];
  const details = detailsSection(action);
  if (details) sections.push(details);
  const sectionByStepId = new Map(
    action.steps.map((step, index) => [step.id, index + (details ? 1 : 0)]),
  );
  if (!normalize(action.name)) {
    issues.push({ message: 'Give the Action a name.', stepId: null });
  }
  if (action.steps.length === 0) {
    issues.push({ message: 'Add at least one step.', stepId: null });
  }
  for (const step of action.steps) {
    const label = normalize(step.label);
    if (!label) {
      issues.push(stepIssue(step, 'Give this step a label.'));
      previews.push({ label: 'Unnamed Step', purpose: step.purpose, stepId: step.id, summary: 'Incomplete' });
      continue;
    }
    if (step.purpose === 'effect') {
      const text = normalize(step.text);
      if (!text) {
        issues.push(stepIssue(step, 'Describe the effect.'));
        previews.push({ label, purpose: step.purpose, stepId: step.id, summary: 'Incomplete' });
      } else {
        sections.push({ kind: 'effect', label, text });
        previews.push({ label, purpose: step.purpose, stepId: step.id, summary: text });
      }
      continue;
    }
    if (step.purpose === 'save') {
      const resolved = resolveTerms(step.dcTerms, data, derived, false);
      if (!resolved) {
        issues.push(stepIssue(step, 'Configure a resolvable save DC.'));
        previews.push({ label, purpose: step.purpose, stepId: step.id, summary: 'Incomplete' });
        continue;
      }
      const dc = resolved.modifiers.reduce((total, modifier) => total + modifier.value, 0);
      if (!Number.isSafeInteger(dc)) {
        issues.push(stepIssue(step, 'The save DC is outside the supported range.'));
        previews.push({ label, purpose: step.purpose, stepId: step.id, summary: 'Incomplete' });
        continue;
      }
      const detail = [
        normalize(step.success) ? `Success: ${normalize(step.success)}` : '',
        normalize(step.failure) ? `Failure: ${normalize(step.failure)}` : '',
      ].filter(Boolean).join('\n') || null;
      const value = `DC ${dc} ${step.ability.toLocaleUpperCase()} save`;
      sections.push({ detail, kind: 'prompt', label, value });
      previews.push({ label, purpose: step.purpose, stepId: step.id, summary: value });
      continue;
    }
    const rolled = rollSection(step, data, derived);
    if (!rolled) {
      issues.push(stepIssue(step, 'Configure at least one resolvable value term.'));
      previews.push({ label, purpose: step.purpose, stepId: step.id, summary: 'Incomplete' });
      continue;
    }
    let section: ChatRollSectionDefinition = rolled.section;
    if (
      step.purpose === 'damage' &&
      step.criticalSourceStepId !== null &&
      rolled.resolved.criticalNotation !== '0'
    ) {
      const sourceSection = sectionByStepId.get(step.criticalSourceStepId);
      const source = action.steps.find(({ id }) => id === step.criticalSourceStepId);
      if (sourceSection === undefined || source?.purpose !== 'attack') {
        issues.push(stepIssue(step, 'Choose a valid Attack for critical damage.'));
        previews.push({ label, purpose: step.purpose, stepId: step.id, summary: 'Incomplete' });
        continue;
      }
      section = {
        ...rolled.section,
        alternateNotation: rolled.resolved.criticalNotation,
        condition: 'first-d20-natural-maximum',
        kind: 'conditional-roll',
        sourceSection,
      } satisfies ChatRollConditionalSectionDefinition;
    }
    sections.push(section);
    previews.push({
      label,
      purpose: step.purpose,
      stepId: step.id,
      summary: rolled.resolved.summary,
    });
  }
  if (issues.length > 0) return { issues, ok: false, previews };
  const definition = {
    category: 'Roll',
    sections,
    title: normalize(action.name),
  } satisfies ChatRollDefinition;
  const parsed = chatRollDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    return {
      issues: [{ message: 'The compiled roll exceeds chat limits.', stepId: null }],
      ok: false,
      previews,
    };
  }
  return { definition: parsed.data, issues: [], ok: true, previews };
}

export function dnd5eActionPurposeLabel(
  purpose: Dnd5eActionStep['purpose'],
): string {
  return purpose === 'roll'
    ? 'General Roll'
    : purpose === 'save'
      ? 'Save Prompt'
      : titleCase(purpose);
}

export const DND5E_ACTION_ABILITY_OPTIONS = DND5E_ABILITIES;
