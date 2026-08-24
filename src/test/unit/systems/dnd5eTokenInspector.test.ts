import { describe, expect, it } from 'vitest';
import {
  createDefaultDnd5eCharacterData,
  type Dnd5eCharacterData,
} from '../../../systems/dnd5e/characterData';
import {
  applyDnd5eTokenInspectorEdit,
  readDnd5eTokenInspectorFields,
  rollDnd5eTokenInspectorField,
  writeDnd5eTokenInspectorField,
} from '../../../systems/dnd5e/tokenInspector';

const settings = { defaultRulesVersion: '5.5e' } as const;

function character(): Dnd5eCharacterData {
  const data = createDefaultDnd5eCharacterData();
  data.health.currentHitPoints = '7';
  data.health.maximumHitPoints = '10';
  return data;
}

describe('D&D Token Inspector fields', () => {
  it('exposes the stable catalog in system order with dynamic resources last', () => {
    const data = character();
    data.resources = [{
      current: 2,
      id: '00000000-0000-4000-8000-000000000001',
      maximum: 3,
      name: 'Ki',
    }];

    expect(readDnd5eTokenInspectorFields(settings, data).map(({ id }) => id))
      .toEqual([
        'health',
        'temporary-hit-points',
        'armor-class',
        'speed',
        'inspiration',
        'initiative',
        'proficiency-bonus',
        'concentration-save',
        'resource:00000000-0000-4000-8000-000000000001',
      ]);
    expect(data.defaultToken.inspector.fieldIds).toEqual([
      'health',
      'armor-class',
    ]);
  });

  it('only disambiguates labels when the add menu would otherwise be ambiguous', () => {
    const data = character();
    data.resources = [
      {
        current: 1,
        id: '00000000-0000-4000-8000-000000000001',
        maximum: 2,
        name: 'Health',
      },
      {
        current: 1,
        id: '00000000-0000-4000-8000-000000000002',
        maximum: 2,
        name: 'Health',
      },
      {
        current: 1,
        id: '00000000-0000-4000-8000-000000000003',
        maximum: 2,
        name: 'Ki',
      },
    ];

    const fields = readDnd5eTokenInspectorFields(settings, data);
    expect(fields.find(({ id }) => id === 'health')?.selectionLabel)
      .toBe('Health (Character)');
    expect(fields.filter(({ label }) => label === 'Health').slice(1)
      .map(({ selectionLabel }) => selectionLabel))
      .toEqual(['Health (Resource 1)', 'Health (Resource 2)']);
    expect(fields.find(({ label }) => label === 'Ki')?.selectionLabel)
      .toBeUndefined();
  });

  it('routes rollable fields through the canonical Character statistic rolls', () => {
    const data = character();
    data.importantStats.initiativeOffset = 2;
    data.importantStats.concentrationSaveOffset = 3;
    const fields = readDnd5eTokenInspectorFields(settings, data);

    expect(fields.find(({ id }) => id === 'initiative')?.roll)
      .toEqual({ label: 'Roll Initiative' });
    expect(fields.find(({ id }) => id === 'concentration-save')?.roll)
      .toEqual({ label: 'Roll Concentration saving throw' });
    expect(rollDnd5eTokenInspectorField(settings, data, 'initiative'))
      .toMatchObject({
        category: 'Initiative',
        sections: [{ modifiers: [{ value: 2 }], notation: '1d20' }],
      });
    expect(rollDnd5eTokenInspectorField(settings, data, 'concentration-save'))
      .toMatchObject({
        category: 'Saving Throw',
        sections: [{ modifiers: [{ value: 3 }], notation: '1d20' }],
      });
    expect(rollDnd5eTokenInspectorField(settings, data, 'armor-class')).toBeNull();
  });

  it('applies absolute and relative health commands while preserving damage', () => {
    const current = applyDnd5eTokenInspectorEdit(settings, character(), {
      command: '+2',
      fieldId: 'health',
      kind: 'set-value',
      target: 'current',
    });
    expect(current?.health).toMatchObject({
      currentHitPoints: '9',
      maximumHitPoints: '10',
    });

    const maximum = applyDnd5eTokenInspectorEdit(settings, current!, {
      command: '12',
      fieldId: 'health',
      kind: 'set-value',
      target: 'maximum',
    });
    expect(maximum?.health).toMatchObject({
      currentHitPoints: '11',
      maximumHitPoints: '12',
    });
  });

  it('evaluates an arithmetic expression entered by editing the displayed value', () => {
    const data = character();
    data.health.currentHitPoints = '24';
    data.health.maximumHitPoints = '24';

    const result = applyDnd5eTokenInspectorEdit(settings, data, {
      command: '24-5',
      fieldId: 'health',
      kind: 'set-value',
      target: 'current',
    });

    expect(result?.health).toMatchObject({
      currentHitPoints: '19',
      maximumHitPoints: '24',
    });
  });

  it('changes a dynamic resource maximum without changing its current value', () => {
    const data = character();
    data.resources = [{
      current: 2,
      id: '00000000-0000-4000-8000-000000000001',
      maximum: 3,
      name: 'Ki',
    }];
    const result = applyDnd5eTokenInspectorEdit(settings, data, {
      command: '+2',
      fieldId: 'resource:00000000-0000-4000-8000-000000000001',
      kind: 'set-value',
      target: 'maximum',
    });
    expect(result?.resources[0]).toMatchObject({ current: 2, maximum: 5 });
  });

  it('rejects malformed and derived-field writes', () => {
    expect(applyDnd5eTokenInspectorEdit(settings, character(), {
      command: 'not a number',
      fieldId: 'health',
      kind: 'set-value',
      target: 'current',
    })).toBeNull();
    expect(applyDnd5eTokenInspectorEdit(settings, character(), {
      command: '99',
      fieldId: 'initiative',
      kind: 'set-value',
      target: 'value',
    })).toBeNull();
  });

  it('restores one writable field without replacing unrelated data', () => {
    const data = character();
    data.identity.ancestry = 'Elf';
    const result = writeDnd5eTokenInspectorField(
      settings,
      data,
      'armor-class',
      { kind: 'scalar', value: '18' },
    );
    expect(result?.importantStats.armorClass).toBe('18');
    expect(result?.identity.ancestry).toBe('Elf');
  });
});
