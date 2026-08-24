import {
  applyTokenInspectorNumericCommand,
  type TokenInspectorField,
  type TokenInspectorFieldValue,
  type TokenInspectorValueEdit,
} from '../../shared/tokenInspector';
import type { ChatRollDefinition } from '../../shared/chatRoll';
import { createDnd5eStatisticRollDefinition } from './characterActions';
import type { JsonValue } from '../../shared/gameSystems';
import {
  deriveDnd5eCharacterValues,
  formatDnd5eSignedValue,
  type Dnd5eCharacterData,
  type Dnd5eRulesVersion,
} from './characterData';
import {
  applyDnd5eTokenHealthCommand,
  formatDnd5eHealthDecimal,
  parseDnd5eHealthDecimal,
  readDnd5eTokenHealth,
  writeDnd5eTokenHealth,
} from './tokenHealth';

function readRulesVersion(settings: JsonValue): Dnd5eRulesVersion | null {
  if (
    typeof settings !== 'object' ||
    settings === null ||
    Array.isArray(settings)
  ) return null;
  const version = settings.defaultRulesVersion;
  return version === '5e' || version === '5.5e' ? version : null;
}

const STATIC_FIELD_IDS = [
  'health',
  'temporary-hit-points',
  'armor-class',
  'speed',
  'inspiration',
  'initiative',
  'proficiency-bonus',
  'concentration-save',
] as const;

function applyIntegerCommand(current: number, command: string): number | null {
  const result = applyTokenInspectorNumericCommand(String(current), command);
  if (result === null) return null;
  const value = Number(result);
  return Number.isSafeInteger(value) ? value : null;
}

function applyDecimalCommand(current: number, command: string): number | null {
  const result = applyTokenInspectorNumericCommand(
    formatDnd5eHealthDecimal(current),
    command,
  );
  return result === null ? null : parseDnd5eHealthDecimal(result);
}

function resourceId(id: string): string {
  return `resource:${id}`;
}

function readResourceId(fieldId: string): string | null {
  return fieldId.startsWith('resource:') ? fieldId.slice('resource:'.length) : null;
}

function withSelectionLabels(fields: TokenInspectorField[]): TokenInspectorField[] {
  const labelCounts = new Map<string, number>();
  for (const field of fields) {
    labelCounts.set(field.label, (labelCounts.get(field.label) ?? 0) + 1);
  }
  const resourceIndexes = new Map<string, number>();
  return fields.map((field) => {
    if ((labelCounts.get(field.label) ?? 0) < 2) return field;
    if (!field.id.startsWith('resource:')) {
      return { ...field, selectionLabel: `${field.label} (Character)` };
    }
    const index = (resourceIndexes.get(field.label) ?? 0) + 1;
    resourceIndexes.set(field.label, index);
    return { ...field, selectionLabel: `${field.label} (Resource ${index})` };
  });
}

export function readDnd5eTokenInspectorFields(
  settings: JsonValue,
  data: Dnd5eCharacterData,
): TokenInspectorField[] {
  const health = readDnd5eTokenHealth(data);
  const rulesVersion = readRulesVersion(settings);
  const derived = rulesVersion
    ? deriveDnd5eCharacterValues(data, rulesVersion)
    : null;
  const fields: TokenInspectorField[] = [
    {
      current: health?.current ?? '',
      editor: 'command',
      id: 'health',
      kind: 'resource',
      label: 'Health',
      maximum: health?.maximum ?? '',
    },
    {
      editor: 'command',
      id: 'temporary-hit-points',
      kind: 'scalar',
      label: 'Temporary HP',
      value: data.health.temporaryHitPoints,
    },
    {
      editor: 'text',
      id: 'armor-class',
      kind: 'scalar',
      label: 'Armor Class',
      value: data.importantStats.armorClass,
    },
    {
      editor: 'text',
      id: 'speed',
      kind: 'scalar',
      label: 'Speed',
      value: data.importantStats.currentSpeed,
    },
    {
      editor: 'command',
      id: 'inspiration',
      kind: 'scalar',
      label: 'Inspiration',
      value: data.importantStats.inspirationCount,
    },
    {
      editor: null,
      id: 'initiative',
      kind: 'scalar',
      label: 'Initiative',
      roll: { label: 'Roll Initiative' },
      value: derived ? formatDnd5eSignedValue(derived.initiative) : '',
    },
    {
      editor: null,
      id: 'proficiency-bonus',
      kind: 'scalar',
      label: 'Proficiency Bonus',
      value: derived ? formatDnd5eSignedValue(derived.proficiencyBonus) : '',
    },
    {
      editor: null,
      id: 'concentration-save',
      kind: 'scalar',
      label: 'Concentration Save',
      roll: { label: 'Roll Concentration saving throw' },
      value: derived ? formatDnd5eSignedValue(derived.concentrationSave) : '',
    },
    ...data.resources.map<TokenInspectorField>((resource) => ({
      current: String(resource.current),
      editor: 'command',
      id: resourceId(resource.id),
      kind: 'resource',
      label: resource.name,
      maximum: String(resource.maximum),
    })),
  ];
  return withSelectionLabels(fields);
}

export function rollDnd5eTokenInspectorField(
  settings: JsonValue,
  data: Dnd5eCharacterData,
  fieldId: string,
): ChatRollDefinition | null {
  const rulesVersion = readRulesVersion(settings);
  const derived = rulesVersion
    ? deriveDnd5eCharacterValues(data, rulesVersion)
    : null;
  if (!derived) return null;
  if (fieldId === 'initiative') {
    return createDnd5eStatisticRollDefinition(derived, 'initiative');
  }
  if (fieldId === 'concentration-save') {
    return createDnd5eStatisticRollDefinition(derived, 'concentration');
  }
  return null;
}

export function applyDnd5eTokenInspectorEdit(
  _settings: JsonValue,
  data: Dnd5eCharacterData,
  edit: TokenInspectorValueEdit,
): Dnd5eCharacterData | null {
  if (edit.fieldId === 'health') {
    if (edit.target !== 'current' && edit.target !== 'maximum') return null;
    const health = readDnd5eTokenHealth(data);
    if (!health) return null;
    const currentValue = formatDnd5eHealthDecimal(
      edit.target === 'current'
        ? health.currentHundredths
        : health.maximumHundredths,
    );
    const next = applyTokenInspectorNumericCommand(currentValue, edit.command);
    if (next === null) return null;
    return applyDnd5eTokenHealthCommand(
      data,
      `${edit.target}=${next}`,
    );
  }

  const result = structuredClone(data);
  if (edit.fieldId === 'temporary-hit-points') {
    if (edit.target !== 'value') return null;
    const current = parseDnd5eHealthDecimal(data.health.temporaryHitPoints);
    const next = current === null ? null : applyDecimalCommand(current, edit.command);
    if (next === null) return null;
    result.health.temporaryHitPoints = formatDnd5eHealthDecimal(next);
    return result;
  }
  if (edit.fieldId === 'armor-class' || edit.fieldId === 'speed') {
    if (edit.target !== 'value') return null;
    if (edit.fieldId === 'armor-class') {
      result.importantStats.armorClass = edit.command;
    } else {
      result.importantStats.currentSpeed = edit.command;
    }
    return result;
  }
  if (edit.fieldId === 'inspiration') {
    if (edit.target !== 'value') return null;
    const current = Number(data.importantStats.inspirationCount.trim());
    if (!Number.isSafeInteger(current)) return null;
    const next = applyIntegerCommand(current, edit.command);
    if (next === null) return null;
    result.importantStats.inspirationCount = String(next);
    return result;
  }
  if ((STATIC_FIELD_IDS as readonly string[]).includes(edit.fieldId)) return null;

  const id = readResourceId(edit.fieldId);
  if (id === null || (edit.target !== 'current' && edit.target !== 'maximum')) {
    return null;
  }
  const resource = result.resources.find((candidate) => candidate.id === id);
  if (!resource) return null;
  const next = applyIntegerCommand(resource[edit.target], edit.command);
  if (next === null) return null;
  resource[edit.target] = next;
  return result;
}

export function writeDnd5eTokenInspectorField(
  _settings: JsonValue,
  data: Dnd5eCharacterData,
  fieldId: string,
  value: TokenInspectorFieldValue,
): Dnd5eCharacterData | null {
  if (fieldId === 'health') {
    if (value.kind !== 'resource') return null;
    const currentHundredths = parseDnd5eHealthDecimal(value.current);
    const maximumHundredths = parseDnd5eHealthDecimal(value.maximum);
    if (currentHundredths === null || maximumHundredths === null) return null;
    return writeDnd5eTokenHealth(data, { currentHundredths, maximumHundredths });
  }
  if (value.kind !== 'scalar' && !fieldId.startsWith('resource:')) return null;
  const result = structuredClone(data);
  if (fieldId === 'temporary-hit-points' && value.kind === 'scalar') {
    if (parseDnd5eHealthDecimal(value.value) === null) return null;
    result.health.temporaryHitPoints = value.value;
    return result;
  }
  if (fieldId === 'armor-class' && value.kind === 'scalar') {
    result.importantStats.armorClass = value.value;
    return result;
  }
  if (fieldId === 'speed' && value.kind === 'scalar') {
    result.importantStats.currentSpeed = value.value;
    return result;
  }
  if (fieldId === 'inspiration' && value.kind === 'scalar') {
    if (!Number.isSafeInteger(Number(value.value.trim()))) return null;
    result.importantStats.inspirationCount = value.value;
    return result;
  }
  if (value.kind !== 'resource') return null;
  const id = readResourceId(fieldId);
  const resource = result.resources.find((candidate) => candidate.id === id);
  const current = Number(value.current);
  const maximum = Number(value.maximum);
  if (!resource || !Number.isSafeInteger(current) || !Number.isSafeInteger(maximum)) {
    return null;
  }
  resource.current = current;
  resource.maximum = maximum;
  return result;
}
