import { describe, expect, it } from 'vitest';
import {
  createDefaultDnd5eCharacterData,
  deriveDnd5eCharacterValues,
} from '../../../systems/dnd5e/characterData';
import { createDnd5eInventoryEntryChatContent } from '../../../systems/dnd5e/characterInventoryChat';

describe('D&D 5e inventory chat formatting', () => {
  it('formats an individual item with its count and weights', () => {
    const data = createDefaultDnd5eCharacterData();
    data.inventory.entries = [{
      equipped: false,
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'item',
      name: '  Longsword  ',
      quantity: 2,
      weight: 3.5,
    }];
    const derived = deriveDnd5eCharacterValues(data, '5.5e');

    expect(createDnd5eInventoryEntryChatContent(
      data.inventory,
      derived!.inventory,
      data.inventory.entries[0].id,
    )).toBe([
      'Item: Longsword',
      'Equipped: No',
      'Count: 2',
      'Weight: 3.5 lb each',
      'Total Weight: 7 lb',
    ].join('\n'));
  });

  it('formats all container details and recursively indents its contents', () => {
    const data = createDefaultDnd5eCharacterData();
    data.inventory.entries = [{
      capacity: 12,
      collapsed: true,
      contents: [
        {
          equipped: true,
          id: '22222222-2222-4222-8222-222222222222',
          kind: 'item',
          name: 'Rations',
          quantity: 3,
          weight: 2,
        },
        {
          capacity: null,
          collapsed: false,
          contents: [{
            equipped: false,
            id: '33333333-3333-4333-8333-333333333333',
            kind: 'item',
            name: 'Gem',
            quantity: 1,
            weight: 0.25,
          }],
          contentsWeight: 'weightless',
          equipped: true,
          id: '44444444-4444-4444-8444-444444444444',
          kind: 'container',
          name: 'Pouch',
          weight: 1,
        },
      ],
      contentsWeight: 'normal',
      equipped: true,
      id: '55555555-5555-4555-8555-555555555555',
      kind: 'container',
      name: 'Backpack',
      weight: 5,
    }];
    const derived = deriveDnd5eCharacterValues(data, '5.5e');

    expect(createDnd5eInventoryEntryChatContent(
      data.inventory,
      derived!.inventory,
      data.inventory.entries[0].id,
    )).toBe([
      'Container: Backpack',
      'Equipped: Yes',
      'Weight (empty): 5 lb',
      'Contents Weight: Normal',
      'Capacity: 12 lb',
      'Used Capacity: 7.25 lb',
      'Status: Within capacity',
      'Contents:',
      '  - Item: Rations',
      '    Equipped: Yes',
      '    Count: 3',
      '    Weight: 2 lb each',
      '    Total Weight: 6 lb',
      '  - Container: Pouch',
      '    Equipped: Yes',
      '    Weight (empty): 1 lb',
      '    Contents Weight: Weightless',
      '    Capacity: Unlimited',
      '    Used Capacity: 0.25 lb',
      '    Status: Within capacity',
      '    Contents:',
      '      - Item: Gem',
      '        Equipped: No',
      '        Count: 1',
      '        Weight: 0.25 lb each',
      '        Total Weight: 0.25 lb',
    ].join('\n'));
  });
});
