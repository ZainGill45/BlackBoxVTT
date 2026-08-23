import type { CampaignSystemState, JsonValue } from '../shared/gameSystems';
import type { JournalAccessLevel } from '../shared/journal';

export type JournalEntryDefaultToken = {
  imageAssetId: string | null;
  size: {
    height: number;
    width: number;
  };
  type: 'linked' | 'template';
};

/**
 * Optional system-owned bridge between a rules record and core scene tokens.
 * Core can preserve a source reference and synchronize its visual projection
 * without learning what a Character (or any other system record) is.
 */
export interface JournalEntryTokenDefinition<
  TData extends JsonValue = JsonValue,
> {
  readDefaultToken(data: TData): JournalEntryDefaultToken;
  writeDefaultToken(
    data: TData,
    token: JournalEntryDefaultToken,
  ): TData;
}

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
  token?: JournalEntryTokenDefinition<TData>;
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
