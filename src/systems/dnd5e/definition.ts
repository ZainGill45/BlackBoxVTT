import type { JsonValue } from '../../shared/gameSystems';
import type { GameSystemDefinition } from '../types';
import {
  createDefaultDnd5eCharacterData,
  isDnd5eCharacterData,
  type Dnd5eRulesVersion,
} from './characterData';
import {
  DND5E_CHARACTER_ENTRY_TYPE_ID,
  DND5E_CHARACTER_GROUP_ID,
} from './ids';

export {
  DND5E_CHARACTER_ENTRY_TYPE_ID,
  DND5E_CHARACTER_GROUP_ID,
} from './ids';

export type Dnd5eSettings = {
  defaultRulesVersion: Dnd5eRulesVersion;
};

export function isDnd5eSettings(value: JsonValue): value is Dnd5eSettings {
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
      createDefaultData: createDefaultDnd5eCharacterData,
      defaultName: 'New Character',
      groupId: DND5E_CHARACTER_GROUP_ID,
      groupLabel: 'Characters',
      groupOrder: 0,
      id: DND5E_CHARACTER_ENTRY_TYPE_ID,
      label: 'Character',
      validateData: isDnd5eCharacterData,
    },
  ],
  validateSettings: isDnd5eSettings,
} satisfies GameSystemDefinition<Dnd5eSettings>;
