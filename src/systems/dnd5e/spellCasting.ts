import {
  chatRollDefinitionSchema,
  type ChatRollConditionalSectionDefinition,
  type ChatRollDefinition,
  type ChatRollModifierDefinition,
  type ChatRollOrdinarySectionDefinition,
  type ChatRollSectionDefinition,
} from '../../shared/chatRoll';
import type {
  Dnd5eCharacterData,
  Dnd5eDerivedCharacterValues,
} from './characterData';
import type {
  Dnd5eSpellData,
  Dnd5eSpellLevel,
  Dnd5eSpellRollStep,
  Dnd5eSpellValueTerm,
} from './spellData';

export type Dnd5eSpellCastMode =
  | { kind: 'cantrip' }
  | { kind: 'ritual' }
  | { kind: 'slot'; level: Exclude<Dnd5eSpellLevel, 0> }
  | { kind: 'without-slot' };

export interface Dnd5eSpellCastIssue {
  message: string;
  stepId: string | null;
}

export type CompiledDnd5eSpellCast =
  | { definition: ChatRollDefinition; issues: []; ok: true }
  | { issues: Dnd5eSpellCastIssue[]; ok: false };

interface ResolvedTerms {
  criticalNotation: string;
  modifiers: ChatRollModifierDefinition[];
  notation: string;
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim();
}

function titleCase(value: string): string {
  return value.replace(/(^|[-\s])\p{L}/gu, (match) => match.toLocaleUpperCase());
}

function levelLabel(level: Dnd5eSpellLevel): string {
  if (level === 0) return 'Cantrip';
  const suffix = level === 1 ? 'st' : level === 2 ? 'nd' : level === 3 ? 'rd' : 'th';
  return `${level}${suffix} Level`;
}

function castLevel(data: Dnd5eSpellData, mode: Dnd5eSpellCastMode): Dnd5eSpellLevel {
  return mode.kind === 'slot' ? mode.level : data.level;
}

function modeLabel(data: Dnd5eSpellData, mode: Dnd5eSpellCastMode): string {
  if (mode.kind === 'cantrip') return 'Cantrip';
  if (mode.kind === 'ritual') return `Ritual at ${levelLabel(data.level)}`;
  if (mode.kind === 'without-slot') return `Without a slot at ${levelLabel(data.level)}`;
  return `${levelLabel(mode.level)} slot`;
}

function validateMode(
  data: Dnd5eSpellData,
  mode: Dnd5eSpellCastMode,
): string | null {
  if (data.level === 0) {
    return mode.kind === 'cantrip' ? null : 'Cantrips must use cantrip casting.';
  }
  if (mode.kind === 'cantrip') return 'Leveled spells cannot use cantrip casting.';
  if (mode.kind === 'ritual' && !data.ritual) {
    return 'This spell is not authored as a ritual.';
  }
  if (
    mode.kind === 'slot' &&
    (mode.level < data.level || mode.level < 1 || mode.level > 9)
  ) {
    return 'Choose a supported slot at or above the spell level.';
  }
  return null;
}

function resolveDiceCount(
  term: Extract<Dnd5eSpellValueTerm, { kind: 'dice' }>,
  casterLevel: number,
  selectedCastLevel: Dnd5eSpellLevel,
): number | null {
  if (term.scaling === 'fixed') return term.count;
  const source = term.scaling === 'caster-level' ? casterLevel : selectedCastLevel;
  if (term.scaling === 'cast-level' && selectedCastLevel === 0) return null;
  let count = term.count;
  for (const tier of term.tiers) {
    if (source >= tier.minimum) count = tier.count;
  }
  return count;
}

function resolveTerms(
  terms: readonly Dnd5eSpellValueTerm[],
  character: Dnd5eCharacterData,
  derived: Dnd5eDerivedCharacterValues,
  selectedCastLevel: Dnd5eSpellLevel,
): ResolvedTerms | null {
  if (terms.length === 0) return null;
  const casterLevel = character.identity.level ?? 1;
  if (casterLevel < 1 || casterLevel > 20) return null;
  const dice: string[] = [];
  const criticalDice: string[] = [];
  const modifiers: ChatRollModifierDefinition[] = [];
  for (const term of terms) {
    if (term.kind === 'dice') {
      const count = resolveDiceCount(term, casterLevel, selectedCastLevel);
      if (count === null) return null;
      dice.push(`${count}d${term.sides}`);
      criticalDice.push(`${count * 2}d${term.sides}`);
      continue;
    }
    if (term.kind === 'flat') {
      modifiers.push({ label: 'Flat Modifier', value: term.value });
      continue;
    }
    if (term.kind === 'caster-level') {
      modifiers.push({ label: 'Caster Level', value: casterLevel });
      continue;
    }
    if (term.kind === 'cast-level') {
      if (selectedCastLevel === 0) return null;
      modifiers.push({ label: 'Cast Level', value: selectedCastLevel });
      continue;
    }
    const ability = character.spellcasting.ability;
    if (ability === null) return null;
    modifiers.push({
      label: 'Spellcasting Modifier',
      value: derived.abilities[ability].modifier,
    });
  }
  return {
    criticalNotation: criticalDice.length > 0 ? criticalDice.join(' + ') : '0',
    modifiers,
    notation: dice.length > 0 ? dice.join(' + ') : '0',
  };
}

function detailsSection(
  data: Dnd5eSpellData,
  mode: Dnd5eSpellCastMode,
): ChatRollSectionDefinition {
  const components = [
    data.components.verbal ? 'V' : '',
    data.components.somatic ? 'S' : '',
    data.components.material ? 'M' : '',
  ].filter(Boolean).join(', ') || 'None';
  const lines = [
    `Cast: ${modeLabel(data, mode)}`,
    `Level: ${levelLabel(data.level)}`,
    `School: ${data.school}`,
    `Casting Time: ${normalize(data.castingTime) || '—'}`,
    `Range: ${normalize(data.range) || '—'}`,
    `Target: ${normalize(data.target) || '—'}`,
    `Duration: ${normalize(data.duration) || '—'}`,
    `Components: ${components}`,
    data.classes.length > 0 ? `Classes: ${data.classes.join(', ')}` : '',
    data.concentration ? 'Concentration' : '',
    data.ritual ? 'Ritual-capable' : '',
    data.components.material && normalize(data.components.materialDescription)
      ? `Material: ${normalize(data.components.materialDescription)}`
      : '',
    normalize(data.description),
    normalize(data.higherLevelDescription)
      ? `Higher-Level Casting: ${normalize(data.higherLevelDescription)}`
      : '',
  ].filter(Boolean);
  return { kind: 'effect', label: 'Spell Details', text: normalize(lines.join('\n')) };
}

function ordinarySection(
  step: Exclude<Dnd5eSpellRollStep, { purpose: 'attack' | 'effect' | 'save' }>,
  character: Dnd5eCharacterData,
  derived: Dnd5eDerivedCharacterValues,
  selectedCastLevel: Dnd5eSpellLevel,
): { criticalNotation: string; section: ChatRollOrdinarySectionDefinition } | null {
  const resolved = resolveTerms(step.terms, character, derived, selectedCastLevel);
  if (!resolved) return null;
  return {
    criticalNotation: resolved.criticalNotation,
    section: {
      label: normalize(step.label),
      modifiers: resolved.modifiers,
      notation: resolved.notation,
      typeLabel: step.purpose === 'damage'
        ? step.damageType ? titleCase(step.damageType) : 'Damage'
        : step.purpose === 'healing'
          ? 'Healing'
          : null,
    },
  };
}

function issue(step: Dnd5eSpellRollStep, message: string): Dnd5eSpellCastIssue {
  return { message, stepId: step.id };
}

export function compileDnd5eSpellCast(
  name: string,
  data: Dnd5eSpellData,
  character: Dnd5eCharacterData,
  derived: Dnd5eDerivedCharacterValues,
  mode: Dnd5eSpellCastMode,
): CompiledDnd5eSpellCast {
  const issues: Dnd5eSpellCastIssue[] = [];
  const title = normalize(name);
  if (!title) issues.push({ message: 'The spell needs a name.', stepId: null });
  const modeProblem = validateMode(data, mode);
  if (modeProblem) issues.push({ message: modeProblem, stepId: null });
  const selectedCastLevel = castLevel(data, mode);
  const sections: ChatRollSectionDefinition[] = [detailsSection(data, mode)];
  const sectionByStepId = new Map(
    data.rollSteps.map((step, index) => [step.id, index + 1]),
  );

  for (const step of data.rollSteps) {
    const label = normalize(step.label);
    if (!label) {
      issues.push(issue(step, 'Give this spell step a label.'));
      continue;
    }
    if (step.purpose === 'effect') {
      const text = normalize(step.text);
      if (!text) issues.push(issue(step, 'Describe this spell effect.'));
      else sections.push({ kind: 'effect', label, text });
      continue;
    }
    if (step.purpose === 'save') {
      const dc = step.dc.kind === 'fixed' ? step.dc.dc : derived.spellcasting.saveDc;
      if (dc === null) {
        issues.push(issue(step, 'Set a spellcasting ability or use a fixed save DC.'));
        continue;
      }
      const detail = [
        normalize(step.success) ? `Success: ${normalize(step.success)}` : '',
        normalize(step.failure) ? `Failure: ${normalize(step.failure)}` : '',
      ].filter(Boolean).join('\n') || null;
      sections.push({
        detail,
        kind: 'prompt',
        label,
        value: `DC ${dc} ${titleCase(step.ability)} Save`,
      });
      continue;
    }
    if (step.purpose === 'attack') {
      const bonus = step.attackBonus.kind === 'fixed'
        ? step.attackBonus.modifier
        : derived.spellcasting.attackBonus;
      if (bonus === null) {
        issues.push(issue(step, 'Set a spellcasting ability or use a fixed attack bonus.'));
        continue;
      }
      sections.push({
        label,
        modifiers: [{ label: 'Spell Attack Bonus', value: bonus }],
        notation: '1d20',
        typeLabel: 'Attack',
      });
      continue;
    }
    const resolved = ordinarySection(
      step,
      character,
      derived,
      selectedCastLevel,
    );
    if (!resolved) {
      issues.push(issue(step, 'Configure at least one resolvable value term.'));
      continue;
    }
    let section: ChatRollSectionDefinition = resolved.section;
    if (
      step.purpose === 'damage' &&
      step.criticalSourceStepId !== null &&
      resolved.criticalNotation !== '0'
    ) {
      const sourceSection = sectionByStepId.get(step.criticalSourceStepId);
      const source = data.rollSteps.find(({ id }) => id === step.criticalSourceStepId);
      if (sourceSection === undefined || source?.purpose !== 'attack') {
        issues.push(issue(step, 'Choose a valid Attack for critical damage.'));
        continue;
      }
      section = {
        ...resolved.section,
        alternateNotation: resolved.criticalNotation,
        condition: 'first-d20-natural-maximum',
        kind: 'conditional-roll',
        sourceSection,
      } satisfies ChatRollConditionalSectionDefinition;
    }
    sections.push(section);
  }

  if (issues.length > 0) return { issues, ok: false };
  const definition = {
    category: 'Spell',
    sections,
    title,
  } satisfies ChatRollDefinition;
  const parsed = chatRollDefinitionSchema.safeParse(definition);
  return parsed.success
    ? { definition: parsed.data, issues: [], ok: true }
    : {
        issues: [{ message: 'The compiled spell cast exceeds chat limits.', stepId: null }],
        ok: false,
      };
}
