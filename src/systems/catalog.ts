import type {
  CampaignSystemState,
  JsonValue,
} from '../shared/gameSystems';
import { dnd5eSystem } from './dnd5e/definition';
import {
  createSystemState,
  type GameSystemDefinition,
} from './types';

const SYSTEMS = [dnd5eSystem] as const;

export const DEFAULT_GAME_SYSTEM_ID = dnd5eSystem.id;

export function getGameSystemDefinition(
  id: string,
): GameSystemDefinition | null {
  return SYSTEMS.find((definition) => definition.id === id) ?? null;
}

export function listGameSystemDefinitions(): readonly GameSystemDefinition[] {
  return SYSTEMS;
}

export function createDefaultCampaignSystemState(
  id: string = DEFAULT_GAME_SYSTEM_ID,
): CampaignSystemState | null {
  const definition = getGameSystemDefinition(id);
  return definition ? createSystemState(definition) : null;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(value).every(isJsonValue)
  );
}

export function parseCampaignSystemState(
  value: unknown,
): CampaignSystemState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<CampaignSystemState>;
  if (
    typeof candidate.id !== 'string' ||
    !Number.isInteger(candidate.schemaVersion) ||
    (candidate.schemaVersion ?? 0) < 1 ||
    !isJsonValue(candidate.settings)
  ) {
    return null;
  }
  const definition = getGameSystemDefinition(candidate.id);
  if (
    !definition ||
    definition.schemaVersion !== candidate.schemaVersion ||
    !definition.validateSettings(candidate.settings)
  ) {
    return null;
  }
  return {
    id: definition.id,
    schemaVersion: definition.schemaVersion,
    settings: structuredClone(candidate.settings),
  };
}
