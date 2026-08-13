import type { CampaignSystemState, JsonValue } from '../shared/gameSystems';
import type { JournalAccessLevel } from '../shared/journal';

export interface JournalEntryTypeDefinition<
  TSettings extends JsonValue = JsonValue,
  TData extends JsonValue = JsonValue,
> {
  createDefaultData(settings: TSettings): TData;
  defaultAccess: JournalAccessLevel;
  defaultName: string;
  describeData?(data: TData): string | null;
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
  validateSettings(value: JsonValue): value is TSettings;
}

export function createSystemState(
  definition: GameSystemDefinition,
): CampaignSystemState {
  return {
    id: definition.id,
    settings: structuredClone(definition.createDefaultSettings()),
  };
}
