import { describe, expect, it } from 'vitest';
import {
  applyDnd5eCharacterActionMutations,
  applyDnd5eCharacterCustomSkillMutations,
  applyDnd5eCharacterInventoryMutations,
  applyDnd5eCharacterFeatureMutations,
  applyDnd5eCharacterResourceMutations,
  applyDnd5eCharacterSpellMutations,
  calculateDnd5eOffsetForTotal,
  calculateDnd5eSkillValues,
  createDefaultDnd5eCharacterData,
  createDefaultDnd5eActionStep,
  createDefaultDnd5eCharacterAction,
  defaultDnd5eSpellcastingAbilityForClass,
  deriveDnd5eCharacterValues,
  DND5E_ABILITIES,
  DND5E_ACTION_STEP_PURPOSES,
  DND5E_SKILLS,
  DND5E_SPELL_SLOT_LEVELS,
  formatDnd5eSignedValue,
  isDnd5eCharacterData,
  MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS,
  MAX_DND5E_CHARACTER_CUSTOM_SKILLS,
  MAX_DND5E_CHARACTER_FIELD_CODE_UNITS,
  MAX_DND5E_CHARACTER_FEATURES,
  MAX_DND5E_CHARACTER_INVENTORY_DEPTH,
  MAX_DND5E_CHARACTER_INVENTORY_ENTRIES,
  MAX_DND5E_CHARACTER_RESOURCES,
  MAX_DND5E_CHARACTER_SPELLS,
  nextDnd5eSkillTraining,
  parseDnd5eNonnegativeWeight,
  parseDnd5eSafeInteger,
  type Dnd5eAbilityId,
  type Dnd5eActionDamageStep,
  type Dnd5eCharacterInventoryContainer,
  type Dnd5eCharacterInventoryEntry,
  type Dnd5eCharacterCustomSkill,
} from '../../../systems/dnd5e/characterData';

function inventoryUuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function inventoryItem(
  index: number,
  overrides: Partial<Extract<Dnd5eCharacterInventoryEntry, { kind: 'item' }>> = {},
): Extract<Dnd5eCharacterInventoryEntry, { kind: 'item' }> {
  return {
    equipped: true,
    id: inventoryUuid(index),
    kind: 'item',
    name: `Item ${index}`,
    quantity: 1,
    weight: 0,
    ...overrides,
  };
}

function inventoryContainer(
  index: number,
  overrides: Partial<Dnd5eCharacterInventoryContainer> = {},
): Dnd5eCharacterInventoryContainer {
  return {
    capacity: null,
    collapsed: false,
    contents: [],
    contentsWeight: 'normal',
    equipped: true,
    id: inventoryUuid(index),
    kind: 'container',
    name: `Container ${index}`,
    weight: 0,
    ...overrides,
  };
}

describe('D&D Character data', () => {
  it('offers only executable authored roll-step purposes', () => {
    expect(DND5E_ACTION_STEP_PURPOSES).toEqual([
      'attack',
      'roll',
      'damage',
      'healing',
      'save',
    ]);
  });

  it('validates exact Action shapes while allowing incomplete drafts', () => {
    const data = createDefaultDnd5eCharacterData();
    const action = createDefaultDnd5eCharacterAction(
      '10000000-0000-4000-8000-000000000001',
    );
    action.name = '';
    action.steps = [];
    data.actions = [action];
    expect(isDnd5eCharacterData(data)).toBe(true);

    expect(isDnd5eCharacterData({
      ...data,
      actions: [{ ...action, unexpected: true }],
    })).toBe(false);

    expect(isDnd5eCharacterData({
      ...data,
      actions: [{
        ...action,
        steps: [{
          id: '20000000-0000-4000-8000-000000000001',
          label: 'Legacy Effect',
          purpose: 'effect',
          text: 'No longer part of the authored roll model.',
        }],
      }],
    })).toBe(false);
  });

  it('requires unique Action and step IDs, ordered tiers, and valid critical links', () => {
    const data = createDefaultDnd5eCharacterData();
    const action = createDefaultDnd5eCharacterAction(
      '10000000-0000-4000-8000-000000000001',
    );
    const attack = createDefaultDnd5eActionStep(
      'attack',
      '20000000-0000-4000-8000-000000000001',
    );
    const damage = createDefaultDnd5eActionStep(
      'damage',
      '20000000-0000-4000-8000-000000000002',
    ) as Dnd5eActionDamageStep;
    damage.criticalSourceStepId = attack.id;
    damage.terms = [{
      count: 1,
      kind: 'dice',
      sides: 7,
      tiers: [
        { count: 2, minimumLevel: 5 },
        { count: 3, minimumLevel: 11 },
      ],
    }];
    action.steps = [attack, damage];
    data.actions = [action];
    expect(isDnd5eCharacterData(data)).toBe(true);

    const badLink = structuredClone(data);
    (badLink.actions[0].steps[1] as Dnd5eActionDamageStep).criticalSourceStepId =
      '30000000-0000-4000-8000-000000000001';
    expect(isDnd5eCharacterData(badLink)).toBe(false);

    const badTiers = structuredClone(data);
    (badTiers.actions[0].steps[1] as Dnd5eActionDamageStep).terms = [{
      count: 1,
      kind: 'dice',
      sides: 7,
      tiers: [
        { count: 3, minimumLevel: 11 },
        { count: 2, minimumLevel: 5 },
      ],
    }];
    expect(isDnd5eCharacterData(badTiers)).toBe(false);

    const duplicate = structuredClone(data);
    duplicate.actions.push({ ...structuredClone(action), name: 'Duplicate' });
    expect(isDnd5eCharacterData(duplicate)).toBe(false);
  });

  it('applies ordered Action mutations and repairs links when an Attack is removed', () => {
    const first = createDefaultDnd5eCharacterAction(
      '10000000-0000-4000-8000-000000000001',
    );
    const second = createDefaultDnd5eCharacterAction(
      '10000000-0000-4000-8000-000000000002',
    );
    const attack = createDefaultDnd5eActionStep(
      'attack',
      '20000000-0000-4000-8000-000000000001',
    );
    const damage = createDefaultDnd5eActionStep(
      'damage',
      '20000000-0000-4000-8000-000000000002',
    ) as Dnd5eActionDamageStep;
    damage.criticalSourceStepId = attack.id;
    first.steps = [attack, damage];

    const result = applyDnd5eCharacterActionMutations([first, second], [
      { direction: 'up', id: second.id, kind: 'move' },
      {
        changes: { steps: [damage] },
        id: first.id,
        kind: 'update',
      },
      { kind: 'reorder', orderedIds: [first.id, second.id] },
    ]);
    expect(result.missingIds).toEqual([]);
    expect(result.actions.map(({ id }) => id)).toEqual([first.id, second.id]);
    expect((result.actions[0].steps[0] as Dnd5eActionDamageStep).criticalSourceStepId)
      .toBeNull();
  });

  it('converts step purposes by preserving identity and resetting mechanics', () => {
    const id = '20000000-0000-4000-8000-000000000001';
    const original = createDefaultDnd5eActionStep('roll', id);
    const converted = createDefaultDnd5eActionStep('save', original.id);
    expect(converted).toMatchObject({
      ability: 'dexterity',
      dcTerms: [{ kind: 'flat', value: 10 }],
      id,
      purpose: 'save',
    });
    expect(converted).not.toHaveProperty('terms');
  });
  it('defines the canonical skill order, ability mapping, and untrained defaults', () => {
    expect(DND5E_SKILLS).toEqual([
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
    ]);
    expect(createDefaultDnd5eCharacterData().skills).toEqual(Object.fromEntries(
      DND5E_SKILLS.map(({ id }) => [id, {
        bonusOffset: 0,
        passiveOffset: 0,
        training: 'untrained',
      }]),
    ));
  });

  it('creates a blank level-one calculation source with numeric zero offsets', () => {
    const data = createDefaultDnd5eCharacterData();
    expect(data.identity.level).toBeNull();
    expect(data.abilities.strength).toEqual({
      modifierOffset: 0,
      savingThrowOffset: 0,
      score: 10,
    });
    expect(data.importantStats).toEqual({
      armorClass: '10',
      concentrationSaveOffset: 0,
      currentSpeed: '30',
      initiativeOffset: 0,
      inspirationCount: '0',
      proficiencyBonusOffset: 0,
    });
    expect(data.features).toEqual([]);
    expect(data.customSkills).toEqual([]);
    expect(data.inventory).toEqual({
      currency: { copper: 0, gold: 0, platinum: 0, silver: 0 },
      entries: [],
      variantEncumbrance: false,
    });
    expect(data.resources).toEqual([]);
    expect(deriveDnd5eCharacterValues(data, '5.5e')).toMatchObject({
      concentrationSave: 0,
      initiative: 0,
      proficiencyBonus: 2,
    });
    expect(isDnd5eCharacterData(data)).toBe(true);
  });

  it('validates the exact bounded recursive Inventory contract', () => {
    const valid = createDefaultDnd5eCharacterData();
    valid.inventory.entries = [inventoryContainer(1, {
      capacity: 0,
      collapsed: true,
      contents: [inventoryItem(2, { quantity: 0, weight: 0.01 })],
      contentsWeight: 'weightless',
      equipped: false,
      weight: 3.25,
    })];
    valid.inventory.currency = { copper: 1, gold: 2, platinum: 3, silver: 4 };
    expect(isDnd5eCharacterData(valid)).toBe(true);

    const invalidInventories = [
      { ...valid.inventory, currency: { ...valid.inventory.currency, copper: -1 } },
      { ...valid.inventory, currency: { ...valid.inventory.currency, silver: 1.5 } },
      { ...valid.inventory, currency: { ...valid.inventory.currency, electrum: 1 } },
      { ...valid.inventory, entries: [{ ...inventoryItem(3), extra: true }] },
      { ...valid.inventory, entries: [{ ...inventoryItem(3), weight: -1 }] },
      { ...valid.inventory, entries: [{ ...inventoryItem(3), weight: 0.001 }] },
      { ...valid.inventory, entries: [{ ...inventoryItem(3), quantity: -1 }] },
      { ...valid.inventory, entries: [{ ...inventoryItem(3), quantity: 1.5 }] },
      {
        ...valid.inventory,
        entries: [{
          equipped: true,
          id: inventoryUuid(3),
          kind: 'item',
          name: 'Item without quantity',
          weight: 0,
        }],
      },
      { ...valid.inventory, entries: [inventoryContainer(3, { capacity: -1 })] },
      { ...valid.inventory, entries: [inventoryContainer(3, { capacity: 0.5 })] },
      { ...valid.inventory, entries: [inventoryContainer(3, {
        contentsWeight: 'reduced' as 'normal',
      })] },
      { ...valid.inventory, entries: [inventoryContainer(3, {
        contents: [inventoryItem(4, { equipped: false })],
      })] },
      { ...valid.inventory, entries: [inventoryItem(3), inventoryItem(3)] },
      { ...valid.inventory, entries: [inventoryItem(3, { name: 'x'.repeat(129) })] },
      { ...valid.inventory, variantEncumbrance: 1 },
    ];
    for (const inventory of invalidInventories) {
      expect(isDnd5eCharacterData({ ...valid, inventory })).toBe(false);
    }

    const tooMany = createDefaultDnd5eCharacterData();
    tooMany.inventory.entries = Array.from(
      { length: MAX_DND5E_CHARACTER_INVENTORY_ENTRIES + 1 },
      (_, index) => inventoryItem(index),
    );
    expect(isDnd5eCharacterData(tooMany)).toBe(false);

    let tooDeep: Dnd5eCharacterInventoryEntry = inventoryItem(100);
    for (let depth = 0; depth < MAX_DND5E_CHARACTER_INVENTORY_DEPTH; depth += 1) {
      tooDeep = inventoryContainer(101 + depth, { contents: [tooDeep] });
    }
    const excessiveDepth = createDefaultDnd5eCharacterData();
    excessiveDepth.inventory.entries = [tooDeep];
    expect(isDnd5eCharacterData(excessiveDepth)).toBe(false);
  });

  it('derives exact carried weight, weightless contents, coins, and physical capacity usage', () => {
    const data = createDefaultDnd5eCharacterData();
    data.inventory.currency.copper = 25;
    data.inventory.currency.silver = 25;
    data.inventory.entries = [
      inventoryItem(1, { equipped: false, weight: 100 }),
      inventoryContainer(2, {
        capacity: 56,
        contents: [
          inventoryItem(3, { weight: 3 }),
          inventoryContainer(4, {
            capacity: 50,
            contents: [inventoryItem(5, { weight: 50 })],
            contentsWeight: 'weightless',
            weight: 4,
          }),
        ],
        weight: 2,
      }),
      inventoryContainer(6, {
        contents: [inventoryItem(7, { quantity: 2, weight: 100 })],
        contentsWeight: 'weightless',
        weight: 1,
      }),
      inventoryContainer(8, {
        capacity: 0,
        contents: [inventoryItem(9, { weight: 1 })],
        equipped: false,
        weight: 20,
      }),
    ];

    expect(deriveDnd5eCharacterValues(data, '5.5e')?.inventory).toEqual({
      carryingCapacityHundredths: 15_000,
      containers: {
        [inventoryUuid(2)]: {
          capacityHundredths: 5_600,
          overCapacity: true,
          usedWeightHundredths: 5_700,
        },
        [inventoryUuid(4)]: {
          capacityHundredths: 5_000,
          overCapacity: false,
          usedWeightHundredths: 5_000,
        },
        [inventoryUuid(6)]: {
          capacityHundredths: null,
          overCapacity: false,
          usedWeightHundredths: 20_000,
        },
        [inventoryUuid(8)]: {
          capacityHundredths: 0,
          overCapacity: true,
          usedWeightHundredths: 100,
        },
      },
      currentWeightHundredths: 1_100,
      encumberedAtHundredths: null,
      heavilyEncumberedAtHundredths: null,
      status: 'normal',
    });
  });

  it('multiplies hundredth-pound item weight by whole-number quantity', () => {
    const data = createDefaultDnd5eCharacterData();
    data.inventory.entries = [
      inventoryItem(1, { quantity: 3, weight: 0.25 }),
      inventoryContainer(2, {
        contents: [inventoryItem(3, { quantity: 2, weight: 0.1 })],
        weight: 1.5,
      }),
      inventoryItem(4, { quantity: 0, weight: 99.99 }),
    ];

    expect(deriveDnd5eCharacterValues(data, '5.5e')?.inventory).toMatchObject({
      containers: {
        [inventoryUuid(2)]: {
          usedWeightHundredths: 20,
        },
      },
      currentWeightHundredths: 245,
    });
  });

  it('scales thresholds by normalized Size and starts each tier only above its boundary', () => {
    const data = createDefaultDnd5eCharacterData();
    data.inventory.variantEncumbrance = true;
    data.inventory.entries = [inventoryItem(1, { weight: 50 })];

    expect(deriveDnd5eCharacterValues(data, '5.5e')?.inventory).toMatchObject({
      carryingCapacityHundredths: 15_000,
      currentWeightHundredths: 5_000,
      encumberedAtHundredths: 5_000,
      heavilyEncumberedAtHundredths: 10_000,
      status: 'normal',
    });
    data.inventory.currency.copper = 1;
    expect(deriveDnd5eCharacterValues(data, '5.5e')?.inventory.status).toBe('encumbered');
    data.inventory.entries[0].weight = 100;
    data.inventory.currency.copper = 0;
    expect(deriveDnd5eCharacterValues(data, '5.5e')?.inventory.status).toBe('encumbered');
    data.inventory.currency.copper = 1;
    expect(deriveDnd5eCharacterValues(data, '5.5e')?.inventory.status)
      .toBe('heavily-encumbered');
    data.inventory.entries[0].weight = 150;
    data.inventory.currency.copper = 0;
    expect(deriveDnd5eCharacterValues(data, '5.5e')?.inventory.status)
      .toBe('heavily-encumbered');
    data.inventory.currency.copper = 1;
    expect(deriveDnd5eCharacterValues(data, '5.5e')?.inventory.status)
      .toBe('over-capacity');

    data.inventory.entries = [];
    data.inventory.currency.copper = 0;
    const capacities = new Map([
      [' tiny ', 7_500],
      ['SMALL', 15_000],
      ['Medium', 15_000],
      ['Large', 30_000],
      ['Huge', 60_000],
      ['Gargantuan', 120_000],
      ['', 15_000],
      ['homebrew', 15_000],
    ]);
    for (const [size, carryingCapacityHundredths] of capacities) {
      data.appearance.size = size;
      expect(deriveDnd5eCharacterValues(data, '5.5e')?.inventory)
        .toMatchObject({ carryingCapacityHundredths });
    }
  });

  it('applies Inventory subtree mutations and replay-safe cross-tree placements', () => {
    const nested = inventoryItem(2, { weight: 2 });
    const inner = inventoryContainer(3);
    const first = inventoryContainer(1, { contents: [nested, inner] });
    const loose = inventoryItem(4, { equipped: false });
    const last = inventoryItem(5);
    const data = createDefaultDnd5eCharacterData();
    data.inventory.entries = [first, loose, last];

    const placed = applyDnd5eCharacterInventoryMutations(data.inventory, [
      { denomination: 'gold', kind: 'set-currency', value: 50 },
      { kind: 'set-variant-encumbrance', value: true },
      { beforeId: nested.id, id: loose.id, kind: 'place', parentId: first.id },
      {
        changes: { equipped: false, name: 'Packed', quantity: 4, weight: 0.25 },
        id: loose.id,
        kind: 'update',
      },
      { direction: 'down', id: loose.id, kind: 'move' },
      { beforeId: '99999999-9999-4999-8999-999999999999', id: nested.id, kind: 'place', parentId: null },
    ]);
    expect(placed).toMatchObject({ invalid: false, missingIds: [] });
    expect(placed.inventory.currency.gold).toBe(50);
    expect(placed.inventory.variantEncumbrance).toBe(true);
    expect(placed.inventory.entries.map(({ id }) => id)).toEqual([
      first.id,
      last.id,
      nested.id,
    ]);
    const packed = (placed.inventory.entries[0] as Dnd5eCharacterInventoryContainer)
      .contents[0];
    expect(packed).toMatchObject({
      equipped: true,
      id: loose.id,
      name: 'Packed',
      quantity: 4,
      weight: 0.25,
    });

    const deleted = applyDnd5eCharacterInventoryMutations(placed.inventory, [
      { id: first.id, kind: 'delete' },
    ]);
    expect(deleted.inventory.entries.map(({ id }) => id)).toEqual([last.id, nested.id]);

    const missing = applyDnd5eCharacterInventoryMutations(deleted.inventory, [
      { changes: { name: 'Remote edit' }, id: inner.id, kind: 'update' },
      { beforeId: null, id: nested.id, kind: 'place', parentId: inner.id },
    ]);
    expect(missing.missingIds).toEqual([inner.id]);
    expect(missing.inventory.entries).toEqual(deleted.inventory.entries);
  });

  it('rejects Inventory cycles, invalid changes, and placements beyond eight levels', () => {
    const child = inventoryContainer(2);
    const root = inventoryContainer(1, { contents: [child] });
    const data = createDefaultDnd5eCharacterData();
    data.inventory.entries = [root, inventoryItem(20)];

    const cycle = applyDnd5eCharacterInventoryMutations(data.inventory, [{
      beforeId: null,
      id: root.id,
      kind: 'place',
      parentId: child.id,
    }]);
    expect(cycle.invalid).toBe(true);
    expect(cycle.inventory).toEqual(data.inventory);

    const negative = applyDnd5eCharacterInventoryMutations(data.inventory, [{
      changes: { weight: -1 },
      id: root.id,
      kind: 'update',
    }]);
    expect(negative.invalid).toBe(true);
    expect(negative.inventory).toEqual(data.inventory);

    let deepest = inventoryContainer(100 + MAX_DND5E_CHARACTER_INVENTORY_DEPTH - 1);
    const deepestId = deepest.id;
    for (let depth = MAX_DND5E_CHARACTER_INVENTORY_DEPTH - 2; depth >= 0; depth -= 1) {
      deepest = inventoryContainer(100 + depth, { contents: [deepest] });
    }
    const deepData = createDefaultDnd5eCharacterData();
    const moving = inventoryItem(200);
    deepData.inventory.entries = [deepest, moving];
    expect(isDnd5eCharacterData(deepData)).toBe(true);
    const tooDeep = applyDnd5eCharacterInventoryMutations(deepData.inventory, [{
      beforeId: null,
      id: moving.id,
      kind: 'place',
      parentId: deepestId,
    }]);
    expect(tooDeep.invalid).toBe(true);
    expect(tooDeep.inventory).toEqual(deepData.inventory);
  });

  it('validates exact, bounded, uniquely identified Feature records and all types', () => {
    const valid = createDefaultDnd5eCharacterData();
    valid.features = ['unknown', 'feature', 'trait', 'proficiency'].map(
      (type, index) => ({
        description: index === 0
          ? 'x'.repeat(MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS)
          : '',
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        name: '',
        source: '',
        sourceType: '',
        type: type as 'unknown' | 'feature' | 'trait' | 'proficiency',
      }),
    );
    expect(isDnd5eCharacterData(valid)).toBe(true);
    expect(isDnd5eCharacterData({
      ...valid,
      features: [{ ...valid.features[0], type: 'spell' }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      features: [{ ...valid.features[0], id: 'not-a-uuid' }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      features: [{ ...valid.features[0], name: 'x'.repeat(129) }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      features: [{ ...valid.features[0], description: 'x'.repeat(
        MAX_DND5E_CHARACTER_DESCRIPTION_CODE_UNITS + 1,
      ) }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      features: [valid.features[0], { ...valid.features[0] }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      features: [{ ...valid.features[0], extra: '' }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      features: Array.from(
        { length: MAX_DND5E_CHARACTER_FEATURES + 1 },
        (_, index) => ({
          description: '',
          id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          name: 'Feature',
          source: '',
          sourceType: '',
          type: 'feature',
        }),
      ),
    })).toBe(false);
  });

  it('applies Feature edits and reorders by stable id while preserving remote slots', () => {
    const makeFeature = (id: string, name: string) => ({
      description: '',
      id,
      name,
      source: '',
      sourceType: '',
      type: 'unknown' as const,
    });
    const first = makeFeature('11111111-1111-4111-8111-111111111111', 'First');
    const remote = makeFeature('22222222-2222-4222-8222-222222222222', 'Remote');
    const second = makeFeature('33333333-3333-4333-8333-333333333333', 'Second');
    const applied = applyDnd5eCharacterFeatureMutations(
      [first, remote, second],
      [
        {
          changes: { description: 'Changed', type: 'trait' },
          id: first.id,
          kind: 'update',
        },
        { kind: 'reorder', orderedIds: [second.id, first.id] },
      ],
    );
    expect(applied).toEqual({
      features: [
        second,
        remote,
        { ...first, description: 'Changed', type: 'trait' },
      ],
      missingIds: [],
    });
    expect(applyDnd5eCharacterFeatureMutations(applied.features, [
      { direction: 'up', id: '44444444-4444-4444-8444-444444444444', kind: 'move' },
    ])).toMatchObject({
      features: applied.features,
      missingIds: ['44444444-4444-4444-8444-444444444444'],
    });
  });

  it('validates exact fields, safe integer inputs, derived arithmetic, and death-save bounds', () => {
    const valid = createDefaultDnd5eCharacterData();
    expect(isDnd5eCharacterData({
      ...valid,
      abilities: {
        ...valid.abilities,
        strength: { ...valid.abilities.strength, score: '12' },
      },
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      abilities: {
        ...valid.abilities,
        strength: { ...valid.abilities.strength, modifierOffset: Number.MAX_SAFE_INTEGER },
      },
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      skills: { ...valid.skills, athletics: 'proficient' },
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      skills: {
        ...valid.skills,
        athletics: { ...valid.skills.athletics, bonusOffset: Number.MAX_SAFE_INTEGER },
      },
    })).toBe(false);
    expect(isDnd5eCharacterData({ ...valid, extra: true })).toBe(false);
  });

  it('validates bounded, uniquely identified signed Resource counters', () => {
    const valid = createDefaultDnd5eCharacterData();
    valid.resources = [{
      current: -3,
      id: '11111111-1111-4111-8111-111111111111',
      maximum: -10,
      name: '',
    }];
    expect(isDnd5eCharacterData(valid)).toBe(true);
    expect(isDnd5eCharacterData({
      ...valid,
      resources: [{ ...valid.resources[0], id: 'not-a-uuid' }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      resources: [valid.resources[0], { ...valid.resources[0] }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      resources: [{ ...valid.resources[0], current: Number.MAX_SAFE_INTEGER + 1 }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      resources: Array.from(
        { length: MAX_DND5E_CHARACTER_RESOURCES + 1 },
        (_, index) => ({
          current: 0,
          id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          maximum: 0,
          name: 'Resource',
        }),
      ),
    })).toBe(false);
  });

  it('validates exact, bounded Custom Skills with every ability and unique IDs', () => {
    const valid = createDefaultDnd5eCharacterData();
    const abilities = [
      'strength',
      'dexterity',
      'constitution',
      'intelligence',
      'wisdom',
      'charisma',
      'none',
    ] as const;
    valid.customSkills = abilities.map((ability, index) => ({
      ability,
      bonusOffset: index - 3,
      id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      name: index < 2 ? '' : 'Repeated Name',
      passiveOffset: 3 - index,
      training: index % 3 === 0
        ? 'untrained'
        : index % 3 === 1
          ? 'proficient'
          : 'expertise',
    }));
    expect(isDnd5eCharacterData(valid)).toBe(true);

    expect(isDnd5eCharacterData({
      ...valid,
      customSkills: [{ ...valid.customSkills[0], extra: true }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      customSkills: [{ ...valid.customSkills[0], ability: 'luck' }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      customSkills: [{ ...valid.customSkills[0], training: 'mastery' }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      customSkills: [{ ...valid.customSkills[0], id: 'not-a-uuid' }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      customSkills: [{
        ...valid.customSkills[0],
        name: 'x'.repeat(MAX_DND5E_CHARACTER_FIELD_CODE_UNITS + 1),
      }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      customSkills: [valid.customSkills[0], { ...valid.customSkills[0] }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      customSkills: [{
        ...valid.customSkills[0],
        passiveOffset: Number.MAX_SAFE_INTEGER + 1,
      }],
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      customSkills: Array.from(
        { length: MAX_DND5E_CHARACTER_CUSTOM_SKILLS + 1 },
        (_, index) => ({
          ability: 'none',
          bonusOffset: 0,
          id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          name: '',
          passiveOffset: 0,
          training: 'untrained',
        }),
      ),
    })).toBe(false);
  });

  it('applies Custom Skill edits and reorders by stable ID while preserving remote slots', () => {
    const skill = (
      id: string,
      name: string,
    ): Dnd5eCharacterCustomSkill => ({
      ability: 'none',
      bonusOffset: 0,
      id,
      name,
      passiveOffset: 0,
      training: 'untrained',
    });
    const first = skill('11111111-1111-4111-8111-111111111111', 'First');
    const remote = skill('22222222-2222-4222-8222-222222222222', 'Remote');
    const second = skill('33333333-3333-4333-8333-333333333333', 'Second');
    const added = skill('44444444-4444-4444-8444-444444444444', 'Added');
    expect(applyDnd5eCharacterCustomSkillMutations(
      [first, remote, second],
      [{ direction: 'down', id: first.id, kind: 'move' }],
    ).skills).toEqual([remote, first, second]);
    const applied = applyDnd5eCharacterCustomSkillMutations(
      [first, remote, second],
      [
        { changes: { ability: 'wisdom', name: '' }, id: first.id, kind: 'update' },
        { kind: 'reorder', orderedIds: [second.id, first.id] },
        { kind: 'add', skill: added },
        { id: remote.id, kind: 'delete' },
      ],
    );
    expect(applied).toEqual({
      missingIds: [],
      skills: [
        second,
        { ...first, ability: 'wisdom', name: '' },
        added,
      ],
    });
    expect(applyDnd5eCharacterCustomSkillMutations(applied.skills, [
      { direction: 'up', id: remote.id, kind: 'move' },
    ])).toMatchObject({ missingIds: [remote.id], skills: applied.skills });
  });

  it('applies Resource edits and reorders by stable id while preserving remote slots', () => {
    const first = {
      current: 1,
      id: '11111111-1111-4111-8111-111111111111',
      maximum: 2,
      name: 'First',
    };
    const remote = {
      current: 3,
      id: '22222222-2222-4222-8222-222222222222',
      maximum: 4,
      name: 'Remote',
    };
    const second = {
      current: 5,
      id: '33333333-3333-4333-8333-333333333333',
      maximum: 6,
      name: 'Second',
    };
    const applied = applyDnd5eCharacterResourceMutations(
      [first, remote, second],
      [
        { changes: { current: -7, name: 'Changed' }, id: first.id, kind: 'update' },
        { kind: 'reorder', orderedIds: [second.id, first.id] },
      ],
    );
    expect(applied.missingIds).toEqual([]);
    expect(applied.resources).toEqual([
      { ...second },
      remote,
      { ...first, current: -7, name: 'Changed' },
    ]);
    expect(applyDnd5eCharacterResourceMutations(applied.resources, [
      { direction: 'up', id: '44444444-4444-4444-8444-444444444444', kind: 'move' },
    ])).toMatchObject({
      missingIds: ['44444444-4444-4444-8444-444444444444'],
      resources: applied.resources,
    });
  });

  it('derives and propagates ability, save, proficiency, skill, initiative, and concentration offsets', () => {
    const data = createDefaultDnd5eCharacterData();
    data.identity.className = 'Fighter';
    data.identity.level = 5;
    data.abilities.strength.score = 12;
    data.abilities.strength.modifierOffset = 2;
    data.abilities.strength.savingThrowOffset = -1;
    data.abilities.dexterity.score = 12;
    data.abilities.dexterity.modifierOffset = 1;
    data.abilities.constitution.score = 14;
    data.abilities.constitution.savingThrowOffset = 2;
    data.importantStats.proficiencyBonusOffset = 1;
    data.importantStats.initiativeOffset = -1;
    data.importantStats.concentrationSaveOffset = 3;
    data.skills.athletics = {
      bonusOffset: 2,
      passiveOffset: -1,
      training: 'expertise',
    };

    const derived = deriveDnd5eCharacterValues(data, '5.5e');
    expect(derived).not.toBeNull();
    expect(derived).toMatchObject({
      abilities: {
        constitution: { modifier: 2, savingThrow: 8 },
        dexterity: { modifier: 2, savingThrow: 2 },
        strength: { modifier: 3, savingThrow: 6 },
      },
      concentrationSave: 11,
      initiative: 1,
      proficiencyBonus: 4,
      skills: {
        athletics: { bonus: 13, passive: 22 },
      },
    });
  });

  it('derives Custom Skills from every ability, NON, training, and independent offsets', () => {
    const data = createDefaultDnd5eCharacterData();
    data.identity.level = 5;
    data.abilities.strength.score = 16;
    data.abilities.dexterity.score = 14;
    data.abilities.constitution.score = 12;
    data.abilities.intelligence.score = 10;
    data.abilities.wisdom.score = 8;
    data.abilities.charisma.score = 6;
    const abilities = [
      'strength',
      'dexterity',
      'constitution',
      'intelligence',
      'wisdom',
      'charisma',
      'none',
    ] as const;
    data.customSkills = abilities.map((ability, index) => ({
      ability,
      bonusOffset: 1,
      id: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      name: ability,
      passiveOffset: -2,
      training: index === 6 ? 'expertise' : 'proficient',
    }));

    const derived = deriveDnd5eCharacterValues(data, '5.5e')!;
    expect(Object.values(derived.customSkills)).toEqual([
      { bonus: 7, passive: 15 },
      { bonus: 6, passive: 14 },
      { bonus: 5, passive: 13 },
      { bonus: 4, passive: 12 },
      { bonus: 3, passive: 11 },
      { bonus: 2, passive: 10 },
      { bonus: 7, passive: 15 },
    ]);

    data.customSkills[0].bonusOffset = Number.MAX_SAFE_INTEGER;
    expect(deriveDnd5eCharacterValues(data, '5.5e')).toBeNull();
  });

  it('uses the official proficiency tiers, blank-level default, and no base outside levels 1-20', () => {
    const data = createDefaultDnd5eCharacterData();
    const expected = new Map<number | null, number>([
      [null, 2], [1, 2], [4, 2], [5, 3], [8, 3], [9, 4], [12, 4],
      [13, 5], [16, 5], [17, 6], [20, 6], [0, 0], [21, 0], [-3, 0],
    ]);
    for (const [level, proficiencyBonus] of expected) {
      data.identity.level = level;
      expect(deriveDnd5eCharacterValues(data, '5e')?.proficiencyBonus)
        .toBe(proficiencyBonus);
      expect(deriveDnd5eCharacterValues(data, '5.5e')?.proficiencyBonus)
        .toBe(proficiencyBonus);
    }
  });

  it('uses the selected class as the only saving-throw proficiency source', () => {
    const proficiencies: Record<string, readonly Dnd5eAbilityId[]> = {
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
    };
    const data = createDefaultDnd5eCharacterData();
    for (const [className, proficientAbilities] of Object.entries(proficiencies)) {
      data.identity.className = className;
      const derived = deriveDnd5eCharacterValues(data, '5.5e')!;
      for (const ability of DND5E_ABILITIES) {
        expect(derived.abilities[ability].savingThrow).toBe(
          proficientAbilities.includes(ability) ? 2 : 0,
        );
      }
    }
    data.identity.className = '';
    expect(Object.values(deriveDnd5eCharacterValues(data, '5.5e')!.abilities)
      .every(({ savingThrow }) => savingThrow === 0)).toBe(true);
  });

  it('supports signed homebrew ability scores and rejects derived overflow', () => {
    const data = createDefaultDnd5eCharacterData();
    data.abilities.strength.score = -1;
    expect(deriveDnd5eCharacterValues(data, '5.5e')?.abilities.strength.modifier).toBe(-6);
    data.abilities.strength.score = Number.MIN_SAFE_INTEGER;
    expect(deriveDnd5eCharacterValues(data, '5.5e')).not.toBeNull();
    data.abilities.strength.modifierOffset = Number.MIN_SAFE_INTEGER;
    expect(deriveDnd5eCharacterValues(data, '5.5e')).toBeNull();
  });

  it('calculates signed skill totals and passive scores for every training tier', () => {
    expect(calculateDnd5eSkillValues(3, 2, {
      bonusOffset: 0,
      passiveOffset: 0,
      training: 'untrained',
    })).toEqual({
      bonus: 3,
      passive: 13,
    });
    expect(calculateDnd5eSkillValues(3, 2, {
      bonusOffset: 0,
      passiveOffset: 0,
      training: 'proficient',
    })).toEqual({
      bonus: 5,
      passive: 15,
    });
    expect(calculateDnd5eSkillValues(-2, 2, {
      bonusOffset: -1,
      passiveOffset: 3,
      training: 'expertise',
    })).toEqual({
      bonus: 1,
      passive: 14,
    });
    expect(calculateDnd5eSkillValues(Number.MAX_SAFE_INTEGER, 2, {
      bonusOffset: 0,
      passiveOffset: 0,
      training: 'proficient',
    })).toBeNull();
  });

  it('maps classes to their default spellcasting abilities without subclass inference', () => {
    expect(defaultDnd5eSpellcastingAbilityForClass('Artificer')).toBe('intelligence');
    expect(defaultDnd5eSpellcastingAbilityForClass('Wizard')).toBe('intelligence');
    expect(defaultDnd5eSpellcastingAbilityForClass('Cleric')).toBe('wisdom');
    expect(defaultDnd5eSpellcastingAbilityForClass('Druid')).toBe('wisdom');
    expect(defaultDnd5eSpellcastingAbilityForClass('Ranger')).toBe('wisdom');
    expect(defaultDnd5eSpellcastingAbilityForClass('Bard')).toBe('charisma');
    expect(defaultDnd5eSpellcastingAbilityForClass('Paladin')).toBe('charisma');
    expect(defaultDnd5eSpellcastingAbilityForClass('Sorcerer')).toBe('charisma');
    expect(defaultDnd5eSpellcastingAbilityForClass('Warlock')).toBe('charisma');
    for (const className of ['Barbarian', 'Fighter', 'Monk', 'Rogue', '', 'Homebrew']) {
      expect(defaultDnd5eSpellcastingAbilityForClass(className)).toBeNull();
    }
  });

  it('derives independently editable spell attacks, save DC, and prepared limits', () => {
    const data = createDefaultDnd5eCharacterData();
    data.identity.className = 'Wizard';
    data.identity.level = 5;
    data.abilities.intelligence.score = 16;
    data.spellcasting.ability = 'intelligence';
    expect(deriveDnd5eCharacterValues(data, '5e')?.spellcasting).toMatchObject({
      attackBonus: 6,
      preparedMaximum: 8,
      preparedMaximumBase: 8,
      saveDc: 14,
    });

    data.spellcasting.attackBonusOffset = 2;
    data.spellcasting.saveDcOffset = -1;
    data.spellcasting.preparedMaximumOffset = -20;
    expect(deriveDnd5eCharacterValues(data, '5e')?.spellcasting).toMatchObject({
      attackBonus: 8,
      preparedMaximum: 0,
      preparedMaximumBase: 8,
      saveDc: 13,
    });

    data.spellcasting.ability = null;
    expect(deriveDnd5eCharacterValues(data, '5e')?.spellcasting).toMatchObject({
      attackBonus: null,
      preparedMaximum: 0,
      preparedMaximumBase: 0,
      saveDc: null,
    });
  });

  it('uses the class and rules-version prepared-spell progressions', () => {
    const data = createDefaultDnd5eCharacterData();
    const prepared = (
      className: string,
      level: number | null,
      rulesVersion: '5e' | '5.5e',
      ability: Dnd5eAbilityId | null = defaultDnd5eSpellcastingAbilityForClass(className),
    ) => {
      data.identity.className = className;
      data.identity.level = level;
      data.spellcasting.ability = ability;
      if (ability) data.abilities[ability].score = 16;
      return deriveDnd5eCharacterValues(data, rulesVersion)?.spellcasting
        .preparedMaximumBase;
    };

    expect(prepared('Bard', 5, '5e')).toBe(8);
    expect(prepared('Ranger', 1, '5e')).toBe(0);
    expect(prepared('Ranger', 5, '5e')).toBe(4);
    expect(prepared('Paladin', 1, '5e')).toBe(0);
    expect(prepared('Paladin', 5, '5e')).toBe(5);
    expect(prepared('Artificer', 5, '5e')).toBe(5);
    expect(prepared('Wizard', 5, '5e')).toBe(8);
    expect(prepared('Sorcerer', 2, '5.5e')).toBe(4);
    expect(prepared('Paladin', 17, '5.5e')).toBe(14);
    expect(prepared('Wizard', 16, '5.5e')).toBe(21);
    expect(prepared('Artificer', 5, '5.5e')).toBe(5);
    expect(prepared('Fighter', 20, '5.5e')).toBe(0);
    expect(prepared('Wizard', null, '5.5e')).toBe(0);
  });

  it('derives every full-caster, half-caster, Artificer, and Pact Magic slot row', () => {
    const fullCasterRows = [
      [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3],
      [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1],
      [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1],
      [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1],
      [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
      [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
      [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
    ];
    const halfCasterRows = [
      [], [2], [3], [3], [4, 2], [4, 2], [4, 3], [4, 3],
      [4, 3, 2], [4, 3, 2], [4, 3, 3], [4, 3, 3],
      [4, 3, 3, 1], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 2],
      [4, 3, 3, 3, 1], [4, 3, 3, 3, 1],
      [4, 3, 3, 3, 2], [4, 3, 3, 3, 2],
    ];
    const startingHalfCasterRows = [[2], ...halfCasterRows.slice(1)];
    const pactMagicRows = [
      [1, 1], [1, 2], [2, 2], [2, 2], [3, 2], [3, 2],
      [4, 2], [4, 2], [5, 2], [5, 2], [5, 3], [5, 3],
      [5, 3], [5, 3], [5, 3], [5, 3], [5, 4], [5, 4], [5, 4], [5, 4],
    ].map(([slotLevel, count]) => {
      const totals = Array<number>(9).fill(0);
      totals[slotLevel - 1] = count;
      return totals;
    });
    const pad = (row: readonly number[]) => [
      ...row,
      ...Array<number>(9 - row.length).fill(0),
    ];
    const bases = (
      className: string,
      level: number | null,
      rulesVersion: '5e' | '5.5e',
    ) => {
      const data = createDefaultDnd5eCharacterData();
      data.identity.className = className;
      data.identity.level = level;
      const slots = deriveDnd5eCharacterValues(data, rulesVersion)?.spellcasting.slots;
      return DND5E_SPELL_SLOT_LEVELS.map((slotLevel) => slots?.[slotLevel].baseTotal);
    };

    for (let index = 0; index < 20; index += 1) {
      const level = index + 1;
      expect(bases('Wizard', level, '5e')).toEqual(pad(fullCasterRows[index]));
      expect(bases('Bard', level, '5.5e')).toEqual(pad(fullCasterRows[index]));
      expect(bases('Ranger', level, '5e')).toEqual(pad(halfCasterRows[index]));
      expect(bases('Paladin', level, '5.5e'))
        .toEqual(pad(startingHalfCasterRows[index]));
      expect(bases('Artificer', level, '5e'))
        .toEqual(pad(startingHalfCasterRows[index]));
      expect(bases('Artificer', level, '5.5e'))
        .toEqual(pad(startingHalfCasterRows[index]));
      expect(bases('Warlock', level, '5e')).toEqual(pactMagicRows[index]);
      expect(bases('Warlock', level, '5.5e')).toEqual(pactMagicRows[index]);
    }
    expect(bases('Fighter', 20, '5e')).toEqual(Array<number>(9).fill(0));
    expect(bases('Wizard', null, '5.5e')).toEqual(Array<number>(9).fill(0));
  });

  it('applies slot total offsets without constraining current or hidden values', () => {
    const data = createDefaultDnd5eCharacterData();
    data.identity.className = 'Wizard';
    data.identity.level = 1;
    data.spellcasting.slots['1'].current = 8;
    data.spellcasting.slots['1'].totalOffset = -5;
    data.spellcasting.slots['9'].current = 3;
    data.spellcasting.slots['9'].totalOffset = 4;

    expect(isDnd5eCharacterData(data)).toBe(true);
    expect(deriveDnd5eCharacterValues(data, '5e')?.spellcasting.slots).toMatchObject({
      '1': { baseTotal: 2, total: 0 },
      '9': { baseTotal: 0, total: 4 },
    });
    expect(data.spellcasting.slots['1'].current).toBe(8);
    expect(data.spellcasting.slots['9'].current).toBe(3);

    data.spellcasting.slots['1'].totalOffset = Number.MAX_SAFE_INTEGER;
    expect(deriveDnd5eCharacterValues(data, '5e')).toBeNull();
  });

  it('validates the exact canonical spellcasting shape', () => {
    const valid = createDefaultDnd5eCharacterData();
    expect(isDnd5eCharacterData(valid)).toBe(true);
    const withoutSpellcasting = { ...valid } as Partial<typeof valid>;
    delete withoutSpellcasting.spellcasting;
    expect(isDnd5eCharacterData(withoutSpellcasting)).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      spellcasting: { ...valid.spellcasting, ability: 'luck' },
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      spellcasting: { ...valid.spellcasting, preparedCurrent: -1 },
    })).toBe(false);
    expect(Object.keys(valid.spellcasting.slots)).toEqual(DND5E_SPELL_SLOT_LEVELS);
    expect(Object.values(valid.spellcasting.slots)).toEqual(
      DND5E_SPELL_SLOT_LEVELS.map(() => ({ current: 0, totalOffset: 0 })),
    );
    expect(isDnd5eCharacterData({
      ...valid,
      spellcasting: {
        ...valid.spellcasting,
        slots: { ...valid.spellcasting.slots, '1': { current: -1, totalOffset: 0 } },
      },
    })).toBe(false);
    const missingSlot = structuredClone(valid);
    delete (missingSlot.spellcasting.slots as Partial<
      typeof missingSlot.spellcasting.slots
    >)['9'];
    expect(isDnd5eCharacterData(missingSlot)).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      spellcasting: { ...valid.spellcasting, extra: true },
    })).toBe(false);
  });

  it('validates unique bounded spell references and preparation states', () => {
    const valid = createDefaultDnd5eCharacterData();
    valid.spellcasting.spells = [
      { entryId: inventoryUuid(1), preparation: 'unprepared' },
      { entryId: inventoryUuid(2), preparation: 'prepared' },
      { entryId: inventoryUuid(3), preparation: 'always-prepared' },
    ];
    expect(isDnd5eCharacterData(valid)).toBe(true);

    const duplicate = structuredClone(valid);
    duplicate.spellcasting.spells[2].entryId = inventoryUuid(2);
    expect(isDnd5eCharacterData(duplicate)).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      spellcasting: {
        ...valid.spellcasting,
        spells: [{ entryId: 'not-a-uuid', preparation: 'prepared' }],
      },
    })).toBe(false);
    expect(isDnd5eCharacterData({
      ...valid,
      spellcasting: {
        ...valid.spellcasting,
        spells: [{ entryId: inventoryUuid(1), preparation: 'sometimes' }],
      },
    })).toBe(false);

    const atLimit = createDefaultDnd5eCharacterData();
    atLimit.spellcasting.spells = Array.from(
      { length: MAX_DND5E_CHARACTER_SPELLS },
      (_, index) => ({
        entryId: inventoryUuid(index),
        preparation: 'unprepared' as const,
      }),
    );
    expect(isDnd5eCharacterData(atLimit)).toBe(true);
    atLimit.spellcasting.spells.push({
      entryId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      preparation: 'unprepared',
    });
    expect(isDnd5eCharacterData(atLimit)).toBe(false);
  });

  it('rebases attaching, ordering, preparation, and removal spell mutations', () => {
    const first = inventoryUuid(1);
    const second = inventoryUuid(2);
    const third = inventoryUuid(3);
    const fourth = inventoryUuid(4);
    const result = applyDnd5eCharacterSpellMutations(
      [
        { entryId: first, preparation: 'unprepared' },
        { entryId: second, preparation: 'prepared' },
        { entryId: third, preparation: 'always-prepared' },
      ],
      [
        { kind: 'add', spell: { entryId: fourth, preparation: 'unprepared' } },
        { kind: 'add', spell: { entryId: first, preparation: 'prepared' } },
        {
          kind: 'reorder',
          orderedEntryIds: [
            third,
            'ffffffff-ffff-4fff-8fff-ffffffffffff',
            third,
            first,
          ],
        },
        { entryId: first, kind: 'set-preparation', preparation: 'always-prepared' },
        { entryId: second, kind: 'remove' },
        {
          entryId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          kind: 'set-preparation',
          preparation: 'prepared',
        },
      ],
    );

    expect(result).toEqual({
      missingIds: ['ffffffff-ffff-4fff-8fff-ffffffffffff'],
      spells: [
        { entryId: third, preparation: 'always-prepared' },
        { entryId: first, preparation: 'always-prepared' },
        { entryId: fourth, preparation: 'unprepared' },
      ],
    });
  });

  it('parses, formats, and rebases directly edited totals', () => {
    expect(parseDnd5eSafeInteger(' +12 ')).toBe(12);
    expect(parseDnd5eSafeInteger('12.5')).toBeNull();
    expect(parseDnd5eSafeInteger('9007199254740992')).toBeNull();
    expect(parseDnd5eNonnegativeWeight(' 12.34 ')).toBe(12.34);
    expect(parseDnd5eNonnegativeWeight('0.5')).toBe(0.5);
    expect(parseDnd5eNonnegativeWeight('1.234')).toBeNull();
    expect(parseDnd5eNonnegativeWeight('-1')).toBeNull();
    expect(formatDnd5eSignedValue(3)).toBe('+3');
    expect(formatDnd5eSignedValue(0)).toBe('0');
    expect(calculateDnd5eOffsetForTotal(5, 2, 8)).toBe(5);
    expect(calculateDnd5eOffsetForTotal(5, 2, 3)).toBe(0);
  });

  it('cycles through untrained, proficient, and expertise', () => {
    expect(nextDnd5eSkillTraining('untrained')).toBe('proficient');
    expect(nextDnd5eSkillTraining('proficient')).toBe('expertise');
    expect(nextDnd5eSkillTraining('expertise')).toBe('untrained');
  });
});
