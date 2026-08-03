import type { CampaignSystemState, JsonValue } from '../shared/gameSystems';

export interface GameSystemDefinition<TSettings extends JsonValue = JsonValue> {
  createDefaultSettings(): TSettings;
  displayName: string;
  id: string;
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
