import type { JsonValue } from '../../shared/gameSystems';
import type { GameSystemDefinition } from '../types';

export type Dnd5eRulesVersion = '5e' | '5.5e';

export type Dnd5eSettings = {
  defaultRulesVersion: Dnd5eRulesVersion;
};

export const DND5E_CHARACTER_ENTRY_TYPE_ID = 'dnd5e.character' as const;
export const DND5E_CHARACTER_GROUP_ID = 'dnd5e.characters' as const;

function validateSettings(value: JsonValue): value is Dnd5eSettings {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    (value.defaultRulesVersion === '5e' ||
      value.defaultRulesVersion === '5.5e')
  );
}

export const dnd5eSystem = {
  createDefaultSettings: () => ({ defaultRulesVersion: '5.5e' }),
  displayName: 'D&D 5e/5.5e',
  id: 'dnd5e',
  journalEntryTypes: [
    {
      createDefaultData: () => ({}),
      dataVersion: 1,
      defaultName: 'New Character',
      groupId: DND5E_CHARACTER_GROUP_ID,
      groupLabel: 'Characters',
      groupOrder: 0,
      id: DND5E_CHARACTER_ENTRY_TYPE_ID,
      label: 'Character',
      validateData: (value: JsonValue): value is Record<string, never> =>
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0,
    },
  ],
  schemaVersion: 1,
  validateSettings,
} satisfies GameSystemDefinition<Dnd5eSettings>;
