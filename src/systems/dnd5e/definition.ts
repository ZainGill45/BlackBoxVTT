import type { JsonValue } from '../../shared/gameSystems';
import type { GameSystemDefinition } from '../types';

export type Dnd5eRulesVersion = '5e' | '5.5e';

export type Dnd5eSettings = {
  defaultRulesVersion: Dnd5eRulesVersion;
};

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
  schemaVersion: 1,
  validateSettings,
} satisfies GameSystemDefinition<Dnd5eSettings>;
