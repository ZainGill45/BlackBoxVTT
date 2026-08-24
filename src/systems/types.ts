import type { CampaignSystemState, JsonValue } from '../shared/gameSystems';
import type { JournalAccessLevel } from '../shared/journal';
import type { ChatRollDefinition } from '../shared/chatRoll';
import type {
  TokenInspectorField,
  TokenInspectorFieldValue,
  TokenInspectorValueEdit,
} from '../shared/tokenInspector';

export type JournalEntryDefaultToken = {
  imageAssetId: string | null;
  inspector: {
    fieldIds: string[];
  };
  size: {
    height: number;
    width: number;
  };
  type: 'linked' | 'template';
};

/** System-owned fields and mutations projected through the core Token Inspector. */
export interface JournalEntryTokenInspectorDefinition<
  TSettings extends JsonValue = JsonValue,
  TData extends JsonValue = JsonValue,
> {
  applyEdit(
    settings: TSettings,
    data: TData,
    edit: TokenInspectorValueEdit,
  ): TData | null;
  readFields(settings: TSettings, data: TData): TokenInspectorField[];
  rollField(
    settings: TSettings,
    data: TData,
    fieldId: string,
  ): ChatRollDefinition | null;
  writeField(
    settings: TSettings,
    data: TData,
    fieldId: string,
    value: TokenInspectorFieldValue,
  ): TData | null;
}

export interface JournalEntryTokenHealthValue {
  currentHundredths: number;
  maximumHundredths: number;
}

/** System-owned health behavior used by the otherwise rules-neutral token core. */
export interface JournalEntryTokenHealthDefinition<
  TData extends JsonValue = JsonValue,
> {
  applyCommand(data: TData, command: string): TData | null;
  materialize(
    data: TData,
    roll: (notation: string) => number,
  ): TData | null;
  read(data: TData): JournalEntryTokenHealthValue | null;
  write(data: TData, value: JournalEntryTokenHealthValue): TData | null;
}

/**
 * Optional system-owned bridge between a rules record and core scene tokens.
 * Core can preserve a source reference and synchronize its visual projection
 * without learning what a Character (or any other system record) is.
 */
export interface JournalEntryTokenDefinition<
  TSettings extends JsonValue = JsonValue,
  TData extends JsonValue = JsonValue,
> {
  health?: JournalEntryTokenHealthDefinition<TData>;
  inspector?: JournalEntryTokenInspectorDefinition<TSettings, TData>;
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
  prepareDataForSave?(
    value: JsonValue,
    roll: (notation: string) => number,
  ): TData | null;
  token?: JournalEntryTokenDefinition<TSettings, TData>;
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
