import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../../../shared/gameSystems';
import {
  DND5E_5_5E_CLASSES,
  DND5E_DAMAGE_TYPES,
} from '../../../systems/dnd5e/characterData';
import {
  DND5E_SPELL_SCHOOLS,
  MAX_DND5E_SPELL_DESCRIPTION_CODE_UNITS,
  analyzeDnd5eSpellRollStep,
  applyDnd5eSpellRollStepMutations,
  createDefaultDnd5eSpellData,
  createDefaultDnd5eSpellRollStep,
  describeDnd5eSpellData,
  isDnd5eSpellData,
} from '../../../systems/dnd5e/spellData';

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

describe('D&D Spell authored data', () => {
  it('creates the exact empty Spell agreed for the Journal', () => {
    expect(createDefaultDnd5eSpellData()).toEqual({
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
    });
  });

  it('accepts only official schools, bundled unique classes, and standard damage types', () => {
    expect(DND5E_SPELL_SCHOOLS).toHaveLength(8);
    expect(DND5E_5_5E_CLASSES).toContain('Artificer');
    const spell = createDefaultDnd5eSpellData();
    spell.classes = ['Artificer', 'Wizard'];
    spell.school = 'Transmutation';
    const damage = createDefaultDnd5eSpellRollStep('damage');
    if (damage.purpose !== 'damage') throw new Error('fixture');
    damage.damageType = DND5E_DAMAGE_TYPES[0];
    spell.rollSteps = [damage];
    expect(isDnd5eSpellData(asJson(spell))).toBe(true);

    expect(isDnd5eSpellData(asJson({ ...spell, school: 'Chronurgy' }))).toBe(false);
    expect(isDnd5eSpellData(asJson({ ...spell, classes: ['Wizard', 'Wizard'] }))).toBe(false);
    expect(isDnd5eSpellData(asJson({ ...spell, classes: ['Blood Hunter'] }))).toBe(false);
    expect(isDnd5eSpellData(asJson({
      ...spell,
      rollSteps: [{ ...damage, damageType: 'untyped magic' }],
    }))).toBe(false);
  });

  it('retains an inactive material description and enforces bounded exact records', () => {
    const spell = createDefaultDnd5eSpellData();
    spell.components.material = false;
    spell.components.materialDescription = 'A diamond kept while Material is inactive.';
    expect(isDnd5eSpellData(asJson(spell))).toBe(true);
    expect(isDnd5eSpellData(asJson({ ...spell, extra: true }))).toBe(false);
    expect(isDnd5eSpellData(asJson({
      ...spell,
      description: 'x'.repeat(MAX_DND5E_SPELL_DESCRIPTION_CODE_UNITS + 1),
    }))).toBe(false);
  });

  it('requires unique UUIDs and valid Attack links for critical damage', () => {
    const spell = createDefaultDnd5eSpellData();
    const attack = createDefaultDnd5eSpellRollStep(
      'attack',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    const damage = createDefaultDnd5eSpellRollStep(
      'damage',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    );
    if (damage.purpose !== 'damage') throw new Error('fixture');
    damage.criticalSourceStepId = attack.id;
    spell.rollSteps = [attack, damage];
    expect(isDnd5eSpellData(asJson(spell))).toBe(true);
    expect(isDnd5eSpellData(asJson({
      ...spell,
      rollSteps: [attack, { ...damage, id: attack.id }],
    }))).toBe(false);
    expect(isDnd5eSpellData(asJson({
      ...spell,
      rollSteps: [damage],
    }))).toBe(false);
  });

  it('validates ordered caster and cast-level tier ranges', () => {
    const spell = createDefaultDnd5eSpellData();
    spell.level = 3;
    const damage = createDefaultDnd5eSpellRollStep('damage');
    if (damage.purpose !== 'damage') throw new Error('fixture');
    damage.terms = [{
      count: 8,
      kind: 'dice',
      scaling: 'cast-level',
      sides: 6,
      tiers: [
        { count: 8, minimum: 3 },
        { count: 9, minimum: 4 },
        { count: 14, minimum: 9 },
      ],
    }];
    spell.rollSteps = [damage];
    expect(isDnd5eSpellData(asJson(spell))).toBe(true);
    damage.terms = [{
      count: 1,
      kind: 'dice',
      scaling: 'caster-level',
      sides: 8,
      tiers: [
        { count: 1, minimum: 1 },
        { count: 4, minimum: 20 },
      ],
    }];
    expect(isDnd5eSpellData(asJson(spell))).toBe(true);
    damage.terms = [{
      count: 1,
      kind: 'dice',
      scaling: 'caster-level',
      sides: 8,
      tiers: [
        { count: 2, minimum: 5 },
        { count: 3, minimum: 5 },
      ],
    }];
    expect(isDnd5eSpellData(asJson(spell))).toBe(false);
    spell.level = 0;
    damage.terms = [{
      count: 1,
      kind: 'dice',
      scaling: 'cast-level',
      sides: 8,
      tiers: [],
    }];
    expect(isDnd5eSpellData(asJson(spell))).toBe(false);
    damage.terms = [{ kind: 'cast-level' }];
    expect(isDnd5eSpellData(asJson(spell))).toBe(false);
  });

  it('rebases mutations by UUID and lets a remote deletion win', () => {
    const step = createDefaultDnd5eSpellRollStep(
      'roll',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    const edited = { ...step, label: 'Edited' };
    expect(applyDnd5eSpellRollStepMutations([], [{
      id: step.id,
      kind: 'update',
      step: edited,
    }])).toEqual({ missingIds: [step.id], steps: [] });
    expect(applyDnd5eSpellRollStepMutations([step], [
      { id: step.id, kind: 'update', step: edited },
      { id: step.id, kind: 'delete' },
    ])).toEqual({ missingIds: [], steps: [] });
  });

  it('generates row detail and marks incomplete but structurally safe steps', () => {
    const spell = createDefaultDnd5eSpellData();
    expect(describeDnd5eSpellData(spell)).toBe('Cantrip Abjuration');
    spell.level = 1;
    spell.school = 'Evocation';
    expect(describeDnd5eSpellData(spell)).toBe('1st Level Evocation');
    spell.level = 3;
    expect(describeDnd5eSpellData(spell)).toBe('3rd Level Evocation');
    const effect = createDefaultDnd5eSpellRollStep('effect');
    expect(analyzeDnd5eSpellRollStep(effect)).toMatchObject({
      summary: 'Needs setup',
    });
  });
});
