import type { CampaignSystemState, JsonValue } from '../shared/gameSystems';

export interface JournalEntryTypeDefinition<
  TSettings extends JsonValue = JsonValue,
  TData extends JsonValue = JsonValue,
> {
  createDefaultData(settings: TSettings): TData;
  dataVersion: number;
  defaultName: string;
  groupId: string;
  groupLabel: string;
  groupOrder: number;
  id: string;
  label: string;
  validateData(value: JsonValue): value is TData;
}

export interface GameSystemDefinition<TSettings extends JsonValue = JsonValue> {
  createDefaultSettings(): TSettings;
  displayName: string;
  id: string;
  journalEntryTypes: readonly JournalEntryTypeDefinition<TSettings>[];
  schemaVersion: number;
  validateSettings(value: JsonValue): value is TSettings;
}

export function createSystemState(
  definition: GameSystemDefinition,
): CampaignSystemState {
  return {
    id: definition.id,
    schemaVersion: definition.schemaVersion,
    settings: structuredClone(definition.createDefaultSettings()),
  };
}
