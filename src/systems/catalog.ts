import type {
  CampaignSystemState,
  JsonValue,
} from '../shared/gameSystems';
import { dnd5eSystem } from './dnd5e/definition';
import {
  createSystemState,
  type GameSystemDefinition,
  type JournalEntryTypeDefinition,
} from './types';
import { JOURNAL_ENTRY_TYPE_NOTE } from '../shared/journal';

const SYSTEMS = [dnd5eSystem] as const;

export const CORE_NOTE_GROUP_ID = 'core.notes' as const;

const CORE_JOURNAL_ENTRY_TYPES: readonly JournalEntryTypeDefinition[] = [
  {
    createDefaultData: () => ({}),
    dataVersion: 1,
    defaultName: 'New Note',
    groupId: CORE_NOTE_GROUP_ID,
    groupLabel: 'Notes',
    groupOrder: 1_000,
    id: JOURNAL_ENTRY_TYPE_NOTE,
    label: 'Note',
    validateData: (value): value is Record<string, never> =>
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0,
  },
];

export const DEFAULT_GAME_SYSTEM_ID = dnd5eSystem.id;

export function getGameSystemDefinition(
  id: string,
): GameSystemDefinition | null {
  return SYSTEMS.find((definition) => definition.id === id) ?? null;
}

export function listGameSystemDefinitions(): readonly GameSystemDefinition[] {
  return SYSTEMS;
}

export function listJournalEntryTypeDefinitions(
  system: CampaignSystemState,
): readonly JournalEntryTypeDefinition[] {
  const definition = getGameSystemDefinition(system.id);
  if (
    !definition ||
    definition.schemaVersion !== system.schemaVersion ||
    !definition.validateSettings(system.settings)
  ) {
    return CORE_JOURNAL_ENTRY_TYPES;
  }
  return [...CORE_JOURNAL_ENTRY_TYPES, ...definition.journalEntryTypes];
}

export function getJournalEntryTypeDefinition(
  system: CampaignSystemState,
  typeId: string,
): JournalEntryTypeDefinition | null {
  return listJournalEntryTypeDefinitions(system).find(({ id }) => id === typeId) ?? null;
}

export function createDefaultJournalEntryData(
  system: CampaignSystemState,
  typeId: string,
): { data: JsonValue; dataVersion: number } | null {
  const type = getJournalEntryTypeDefinition(system, typeId);
  if (!type) return null;
  const data = type.createDefaultData(system.settings);
  return type.validateData(data)
    ? { data: structuredClone(data), dataVersion: type.dataVersion }
    : null;
}

export function parseJournalEntryData(
  system: CampaignSystemState,
  typeId: string,
  dataVersion: number,
  data: unknown,
): JsonValue | null {
  const type = getJournalEntryTypeDefinition(system, typeId);
  if (
    !type ||
    dataVersion !== type.dataVersion ||
    !isJsonValue(data) ||
    !type.validateData(data)
  ) {
    return null;
  }
  return structuredClone(data);
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
